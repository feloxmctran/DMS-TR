// server/index.js
import http from "http";
import { parse } from "url";
import { promises as fs } from "fs";

import path from "path";
import { fileURLToPath } from "url";

import pg from "pg";
const { Pool } = pg;

// Postgres (Neon/Render)
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.PGHOST || "localhost",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "",
      database: process.env.PGDATABASE || "dms_tr",
    });

const PORT = process.env.PORT || 4000;

// ✅ Trial süresi artık 7 gün (env ile override edebilirsin)
let defaultDays = Number(process.env.DEFAULT_TRIAL_DAYS || 7);

// Offline grace gün (ileride FE tarafında kullanılacak; şimdilik status’a ekliyoruz)
const OFFLINE_GRACE_DAYS = Number(process.env.OFFLINE_GRACE_DAYS || 7);

// Ürün kataloğu (GTIN + İlaç adı) için kalıcı JSON
const PRODUCTS_FILE = new URL("./products.json", import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bridge download dosyası
const BRIDGE_ZIP_PATH = path.join(__dirname, "downloads", "DMS-Bridge.zip");

// Products in-memory
let productsData = {
  lastChangeId: 0,
  updatedAt: null,
  items: [],
};

// ===================== yardımcılar =====================
function send(res, code, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
  res.end(body);
}

async function readBody(req) {
  return await new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function addDays(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function stripQuotes(s) {
  s = String(s || "").trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

function normalizeGtin(gtin) {
  let g = stripQuotes(gtin);
  if (!g) return "";
  g = g.replace(/\D/g, "");
  if (g.length === 14 && g.startsWith("0")) g = g.slice(1);
  return g;
}

function nextChangeId() {
  return (typeof productsData.lastChangeId === "number" ? productsData.lastChangeId : 0) + 1;
}

// Admin koruması: ADMIN_SECRET set edilirse zorunlu; set değilse serbest (mevcut akış bozulmasın)
function requireAdmin(req, res) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return true;
  const h = req.headers["x-admin-secret"];
  if (String(h || "") !== String(secret)) {
    send(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

// ===================== devices + licensing db helpers =====================

// device row oku
async function dbGetDevice(deviceId) {
  const q = `
    select
      device_id,
      pharmacy_name,
      created_at,
      trial_started_at,
      trial_expires_at,
      last_verified_at,
      active_until
    from devices
    where device_id = $1
    limit 1
  `;
  const r = await pool.query(q, [String(deviceId)]);
  return r.rows[0] || null;
}

// Settings’te "Kaydet" anında çağrılır:
// - Eğer trial hiç başlamadıysa başlatır (7 gün)
// - Eğer başlamışsa trial'ı resetlemez, sadece isim/last_seen günceller
async function dbRegisterDeviceOnSave({ deviceId, pharmacyName, trialDays }) {
  const q = `
    insert into devices (
      device_id, pharmacy_name,
      trial_started_at, trial_expires_at,
      last_verified_at, active_until,
      created_at, updated_at
    )
    values (
      $1, $2,
      now(), now() + ($3 || ' days')::interval,
      now(), now() + ($3 || ' days')::interval,
      now(), now()
    )
    on conflict (device_id)
    do update set
      pharmacy_name = excluded.pharmacy_name,
      trial_started_at = coalesce(devices.trial_started_at, now()),
      trial_expires_at = coalesce(devices.trial_expires_at, now() + ($3 || ' days')::interval),
      last_verified_at = now(),
      active_until = greatest(
        coalesce(devices.active_until, to_timestamp(0)),
        coalesce(devices.trial_expires_at, now() + ($3 || ' days')::interval)
      ),
      updated_at = now()
    returning device_id, pharmacy_name, trial_started_at, trial_expires_at, active_until, last_verified_at
  `;
  const r = await pool.query(q, [String(deviceId), pharmacyName || "", String(trialDays)]);
  return r.rows[0] || null;
}

// sadece eczane adı güncelle (trial yoksa başlatır)
async function dbSetPharmacyName({ deviceId, pharmacyName, trialDays }) {
  const q = `
    insert into devices (
      device_id, pharmacy_name,
      trial_started_at, trial_expires_at,
      last_verified_at, active_until,
      created_at, updated_at
    )
    values (
      $1, $2,
      now(), now() + ($3 || ' days')::interval,
      now(), now() + ($3 || ' days')::interval,
      now(), now()
    )
    on conflict (device_id)
    do update set
      pharmacy_name = excluded.pharmacy_name,
      trial_started_at = coalesce(devices.trial_started_at, now()),
      trial_expires_at = coalesce(devices.trial_expires_at, now() + ($3 || ' days')::interval),
      last_verified_at = now(),
      active_until = greatest(
        coalesce(devices.active_until, to_timestamp(0)),
        coalesce(devices.trial_expires_at, now() + ($3 || ' days')::interval)
      ),
      updated_at = now()
    returning device_id, pharmacy_name
  `;
  const r = await pool.query(q, [String(deviceId), pharmacyName || "", String(trialDays)]);
  return r.rows[0] || null;
}

// device.active_until’u güncelle (trial vs lisans max)
async function dbRecomputeActiveUntil(deviceId) {
  const q = `
    with al as (
      select dl.expires_at
      from device_licenses dl
      where dl.device_id = $1
        and dl.revoked_at is null
      order by dl.expires_at desc
      limit 1
    )
    update devices d
    set active_until = greatest(
          coalesce(d.trial_expires_at, to_timestamp(0)),
          coalesce((select expires_at from al), to_timestamp(0))
        ),
        last_verified_at = now(),
        updated_at = now()
    where d.device_id = $1
    returning device_id, trial_expires_at, active_until, last_verified_at
  `;
  const r = await pool.query(q, [String(deviceId)]);
  return r.rows[0] || null;
}

// "Anahtar iste" kaydı
async function dbCreateKeyRequest(deviceId) {
  const dev = await dbGetDevice(deviceId);
  const pharmacyName = dev?.pharmacy_name || "";

  const q = `
    insert into key_requests (device_id, pharmacy_name, status, created_at)
    values ($1, $2, 'open', now())
    returning id, device_id, pharmacy_name, status, created_at
  `;
  const r = await pool.query(q, [String(deviceId), String(pharmacyName)]);
  return r.rows[0] || null;
}

// Lisans aktivasyonu: code tek cihaz + süre kullanım anından başlar
async function dbActivateLicense({ deviceId, code }) {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const cleanCode = String(code || "").trim();
    if (!cleanCode) {
      await client.query("rollback");
      return { ok: false, error: "invalid_key" };
    }

    // key'i kilitleyerek oku
    const kq = `
      select id, code, duration_days, key_expires_at, used_at, used_device_id, note
      from license_keys
      where code = $1
      for update
    `;
    const kr = await client.query(kq, [cleanCode]);
    const key = kr.rows[0];

    if (!key) {
      await client.query("rollback");
      return { ok: false, error: "invalid_key" };
    }

    if (key.key_expires_at && new Date(key.key_expires_at).getTime() < Date.now()) {
      await client.query("rollback");
      return { ok: false, error: "key_expired" };
    }

    if (key.used_at || key.used_device_id) {
      await client.query("rollback");
      return { ok: false, error: "key_already_used" };
    }

    // device yoksa oluştur (normalde register önce gelir)
    await client.query(
      `
      insert into devices (device_id, pharmacy_name, created_at, updated_at, last_verified_at)
      values ($1, '', now(), now(), now())
      on conflict (device_id) do update set last_verified_at = now(), updated_at = now()
      `,
      [String(deviceId)]
    );

    const durationDays = Number(key.duration_days || 0);
    if (!durationDays || durationDays <= 0) {
      await client.query("rollback");
      return { ok: false, error: "invalid_key_duration" };
    }

    const activatedAt = new Date();
    const expiresAt = new Date(activatedAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // key'i kullanıldı işaretle
    await client.query(
      `
      update license_keys
      set used_at = now(),
          used_device_id = $2,
          updated_at = now()
      where id = $1
      `,
      [key.id, String(deviceId)]
    );

    // device_licenses'a yaz
    await client.query(
      `
      insert into device_licenses (device_id, license_key_id, activated_at, expires_at)
      values ($1, $2, now(), $3::timestamptz)
      `,
      [String(deviceId), key.id, expiresAt.toISOString()]
    );

    // active_until'u güncelle (trial ile max)
    await client.query(
      `
      update devices
      set active_until = greatest(coalesce(trial_expires_at, to_timestamp(0)), $2::timestamptz),
          last_verified_at = now(),
          updated_at = now()
      where device_id = $1
      `,
      [String(deviceId), expiresAt.toISOString()]
    );

    await client.query("commit");
    return { ok: true, expiresAt: expiresAt.toISOString() };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// Admin trials listesi (eski shape'i bozmayalım)
async function dbListTrialsCompat(limit = 500) {
  const q = `
    select
      d.device_id,
      d.pharmacy_name,
      d.trial_started_at,
      d.trial_expires_at,
      d.active_until,
      exists(
        select 1 from key_requests kr
        where kr.device_id = d.device_id and kr.status = 'open'
      ) as extension_requested
    from devices d
    order by d.trial_started_at desc nulls last
    limit $1
  `;
  const r = await pool.query(q, [Number(limit)]);
  return r.rows || [];
}

// Admin: key üret
function generateLicenseCode(len = 10) {
  // Kolay okunur: I/O/0/1 karışmasın diye bazılarını çıkarıyoruz
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function dbGenerateLicenseKeys({ count, durationDays, note, keyExpiresAtIso, codeLen = 10 }) {
  const n = Math.max(1, Math.min(Number(count || 1), 500)); // 1..500
  const d = Number(durationDays || 7);
  if (!d || d <= 0) throw new Error("durationDays_invalid");

  const created = [];
  for (let i = 0; i < n; i++) {
    // uniq için birkaç deneme
    let code = "";
    for (let t = 0; t < 5; t++) {
      code = generateLicenseCode(codeLen);
      try {
        const q = `
          insert into license_keys (code, duration_days, key_expires_at, note, created_at, updated_at)
          values ($1, $2, $3::timestamptz, $4, now(), now())
          returning id, code, duration_days, key_expires_at, note, created_at
        `;
        const r = await pool.query(q, [
          code,
          d,
          keyExpiresAtIso ? String(keyExpiresAtIso) : null,
          note || "",
        ]);
        created.push(r.rows[0]);
        break;
      } catch (e) {
        // unique collision -> tekrar dene
        if (String(e?.code) === "23505") continue;
        throw e;
      }
    }
  }
  return created;
}

async function dbListLicenseKeys({ q, limit = 200 }) {
  const text = String(q || "").trim();
  const lim = Math.max(1, Math.min(Number(limit || 200), 1000));

  const sql = `
    select
      id, code, duration_days, key_expires_at,
      used_at, used_device_id, note,
      created_at
    from license_keys
    where ($1 = '' or code ilike '%'||$1||'%' or note ilike '%'||$1||'%')
    order by created_at desc
    limit $2
  `;
  const r = await pool.query(sql, [text, lim]);
  return r.rows || [];
}

async function dbListKeyRequests({ status = "open", limit = 200 }) {
  const st = String(status || "open");
  const lim = Math.max(1, Math.min(Number(limit || 200), 1000));
  const sql = `
    select id, device_id, pharmacy_name, status, note, created_at, handled_at
    from key_requests
    where ($1 = '' or status = $1)
    order by created_at desc
    limit $2
  `;
  const r = await pool.query(sql, [st === "all" ? "" : st, lim]);
  return r.rows || [];
}

// ===================== disk layer =====================
async function loadProductsFromDisk() {
  try {
    const txt = await fs.readFile(PRODUCTS_FILE, "utf8");
    if (!txt) return;

    const data = JSON.parse(txt);
    const items = Array.isArray(data.items) ? data.items : [];

    productsData = {
      lastChangeId: typeof data.lastChangeId === "number" ? data.lastChangeId : 0,
      updatedAt: data.updatedAt ? String(data.updatedAt) : null,
      items,
    };

    console.log(
      `products load → source=${PRODUCTS_FILE.href} items=${productsData.items.length} lastChangeId=${productsData.lastChangeId}`
    );
  } catch (e) {
    console.warn("loadProductsFromDisk uyarı (products.json yok olabilir):", e.message);
  }
}

async function saveProductsToDisk() {
  try {
    await fs.writeFile(PRODUCTS_FILE, JSON.stringify(productsData, null, 2), "utf8");
  } catch (e) {
    console.error("saveProductsToDisk hata:", e);
  }
}

// ===================== server =====================
const server = http.createServer(async (req, res) => {
  const { pathname, query } = parse(req.url, true);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-secret",
    });
    return res.end();
  }

  // health
  if (req.method === "GET" && pathname === "/api/health") {
    return send(res, 200, { ok: true, now: new Date().toISOString() });
  }

  // ✅ Telefon SYNC buradan çekecek
  if (req.method === "GET" && pathname === "/initial_products.json") {
    return send(
      res,
      200,
      {
        lastChangeId: productsData.lastChangeId || 0,
        updatedAt: productsData.updatedAt || null,
        items: Array.isArray(productsData.items) ? productsData.items : [],
      },
      { "Cache-Control": "no-store" }
    );
  }

  // ✅ Bridge indir (tek link)
  if (req.method === "GET" && pathname === "/downloads/bridge") {
    try {
      const buf = await fs.readFile(BRIDGE_ZIP_PATH);

      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="DMS-Bridge.zip"',
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      return res.end(buf);
    } catch (e) {
      console.error("Bridge.zip okunamadı:", e?.message || e);
      return send(res, 404, { ok: false, error: "bridge_not_found" });
    }
  }

  // ================== TRIAL API'LERİ ==================

  // Settings’te "Kaydet" anı -> trial başlat / isim yaz
  if (req.method === "POST" && pathname === "/api/trial/register") {
    const { stakeholderId, partnerId, deviceId, stakeholderName } = await readBody(req);

    if (!stakeholderId || !deviceId) {
      return send(res, 400, { ok: false, error: "stakeholderId ve deviceId gerekli" });
    }

    try {
      const now = new Date();
      const name = String(stakeholderName || "").trim();

      // Trial reset yok: cihaz varsa güncelle, yoksa oluştur + trial başlat
      const saved = await dbRegisterDeviceOnSave({
        deviceId,
        pharmacyName: name,
        trialDays: defaultDays,
      });

      // active_until hesaplamasını kesinleştir
      await dbRecomputeActiveUntil(deviceId);

      const dev = await dbGetDevice(deviceId);

      return send(res, 200, {
        ok: true,
        status: "ok",
        stakeholderId,
        deviceId,
        createdAt: dev?.trial_started_at ? new Date(dev.trial_started_at).toISOString() : now.toISOString(),
        expiresAt: dev?.trial_expires_at ? new Date(dev.trial_expires_at).toISOString() : addDays(now.toISOString(), defaultDays),
        activeUntil: dev?.active_until ? new Date(dev.active_until).toISOString() : null,
        partnerId: partnerId || "",
        stakeholderName: dev?.pharmacy_name || name || "",
        offlineGraceDays: OFFLINE_GRACE_DAYS,
        lastVerifiedAt: dev?.last_verified_at ? new Date(dev.last_verified_at).toISOString() : null,
      });
    } catch (e) {
      console.error("trial/register db hata:", e);
      return send(res, 500, { ok: false, error: "db_error" });
    }
  }

  // Trial/Lisans durumu (tek otorite: devices.active_until)
  if (req.method === "GET" && pathname === "/api/trial/status") {
    const stakeholderId = query.stakeholderId?.toString();
    const deviceId = query.deviceId?.toString();

    if (!stakeholderId || !deviceId) {
      return send(res, 400, {
        ok: false,
        allowed: false,
        reason: "missing_params",
        error: "stakeholderId ve deviceId gerekli",
        expiresAt: null,
      });
    }

    try {
      // recompute + touch
      await dbRecomputeActiveUntil(deviceId);

      const dev = await dbGetDevice(deviceId);

      if (!dev) {
        return send(res, 200, {
          ok: true,
          allowed: false,
          reason: "not_registered",
          stakeholderId,
          deviceId,
          createdAt: null,
          expiresAt: null,
          activeUntil: null,
          offlineGraceDays: OFFLINE_GRACE_DAYS,
        });
      }

      const activeUntilIso = dev.active_until ? new Date(dev.active_until).toISOString() : null;
      const trialExpiresIso = dev.trial_expires_at ? new Date(dev.trial_expires_at).toISOString() : null;
      const trialStartedIso = dev.trial_started_at ? new Date(dev.trial_started_at).toISOString() : null;

      const now = Date.now();
      const au = dev.active_until ? new Date(dev.active_until).getTime() : 0;
      const allowed = au && au > now;

      return send(res, 200, {
        ok: true,
        allowed,
        reason: allowed ? "active" : "expired",
        stakeholderId,
        deviceId,
        createdAt: trialStartedIso,
        expiresAt: trialExpiresIso,          // (eski client alanı) trial expires
        activeUntil: activeUntilIso,         // yeni: gerçek aktiflik bitişi (trial veya lisans max)
        stakeholderName: dev.pharmacy_name || "",
        offlineGraceDays: OFFLINE_GRACE_DAYS,
        lastVerifiedAt: dev.last_verified_at ? new Date(dev.last_verified_at).toISOString() : null,
      });
    } catch (e) {
      console.error("trial/status db hata:", e);
      return send(res, 500, { ok: false, allowed: false, error: "db_error" });
    }
  }

  // "Anahtar iste" (eski extend-request endpoint’i korunuyor)
  if (req.method === "POST" && pathname === "/api/trial/extend-request") {
    const { stakeholderId, deviceId } = await readBody(req);

    if (!stakeholderId || !deviceId) {
      return send(res, 400, { ok: false, error: "stakeholderId ve deviceId gerekli" });
    }

    try {
      const r = await dbCreateKeyRequest(deviceId);
      return send(res, 200, {
        ok: true,
        stakeholderId,
        deviceId,
        extensionRequested: true,
        requestId: r?.id || null,
      });
    } catch (e) {
      console.error("trial/extend-request db hata:", e);
      return send(res, 500, { ok: false, error: "db_error" });
    }
  }

  // Eczane adı kaydet (trial yoksa başlatır)
  if (req.method === "POST" && pathname === "/api/trial/name") {
    const { deviceId, name } = await readBody(req);

    if (!deviceId) {
      return send(res, 400, { ok: false, error: "deviceId gerekli" });
    }

    try {
      const row = await dbSetPharmacyName({
        deviceId,
        pharmacyName: String(name || "").trim(),
        trialDays: defaultDays,
      });
      // recompute active_until
      await dbRecomputeActiveUntil(deviceId);
      return send(res, 200, { ok: true, deviceId: row?.device_id, name: row?.pharmacy_name || "" });
    } catch (e) {
      console.error("trial/name db hata:", e);
      return send(res, 500, { ok: false, error: "db_error" });
    }
  }

  // ================== LICENSE API ==================

  // Settings’te key girip "Kaydet" -> lisansı aktifleştir
  if (req.method === "POST" && pathname === "/api/license/activate") {
    const { deviceId, code } = await readBody(req);

    if (!deviceId || !code) {
      return send(res, 400, { ok: false, error: "deviceId ve code gerekli" });
    }

    try {
      const out = await dbActivateLicense({ deviceId, code });
      if (!out.ok) return send(res, 200, out);

      await dbRecomputeActiveUntil(deviceId);
      const dev = await dbGetDevice(deviceId);

      return send(res, 200, {
        ok: true,
        expiresAt: out.expiresAt,
        activeUntil: dev?.active_until ? new Date(dev.active_until).toISOString() : out.expiresAt,
        offlineGraceDays: OFFLINE_GRACE_DAYS,
        lastVerifiedAt: dev?.last_verified_at ? new Date(dev.last_verified_at).toISOString() : null,
      });
    } catch (e) {
      console.error("license/activate db hata:", e);
      return send(res, 500, { ok: false, error: "db_error" });
    }
  }

  // ================== ADMIN API'LERİ ==================

  // Admin listesi (trial ekranı bozulmasın)
  if (req.method === "GET" && pathname === "/api/admin/trials") {
    if (!requireAdmin(req, res)) return;

    try {
      const rows = await dbListTrialsCompat();

      const list = rows.map((r) => {
        const createdAtIso = r.trial_started_at ? new Date(r.trial_started_at).toISOString() : null;

        let daysSinceCreated = null;
        if (createdAtIso) {
          const cd = new Date(createdAtIso);
          if (!isNaN(cd.getTime())) {
            const diffMs = Date.now() - cd.getTime();
            daysSinceCreated = Math.floor(diffMs / (24 * 60 * 60 * 1000));
          }
        }

        return {
          stakeholderId: "", // eski client alanı dursun
          deviceId: r.device_id,
          createdAt: createdAtIso,
          daysSinceCreated,
          expiresAt: r.trial_expires_at ? new Date(r.trial_expires_at).toISOString() : null, // trial expires
          activeUntil: r.active_until ? new Date(r.active_until).toISOString() : null,       // gerçek active_until
          partnerId: "",
          stakeholderName: r.pharmacy_name || "",
          extensionRequested: !!r.extension_requested, // open key request varsa true
        };
      });

      return send(res, 200, { ok: true, defaultDays, list, offlineGraceDays: OFFLINE_GRACE_DAYS });
    } catch (e) {
      console.error("admin/trials db hata:", e);
      return send(res, 500, { ok: false, error: "db_error" });
    }
  }

  // Admin: key üret (count + durationDays + note + keyExpiresAt)
  // Body örnek: { count: 10, durationDays: 7, note: "Müşteri X", keyExpiresAt: "2026-01-31T00:00:00.000Z", codeLen: 10 }
  if (req.method === "POST" && pathname === "/api/admin/license-keys/generate") {
    if (!requireAdmin(req, res)) return;

    const body = await readBody(req);
    const count = Number(body.count || 1);
    const durationDays = Number(body.durationDays || body.days || 7);
    const note = String(body.note || "");
    const keyExpiresAt = body.keyExpiresAt ? String(body.keyExpiresAt) : null;
    const codeLen = Number(body.codeLen || 10);

    try {
      const created = await dbGenerateLicenseKeys({
        count,
        durationDays,
        note,
        keyExpiresAtIso: keyExpiresAt,
        codeLen: Math.max(8, Math.min(codeLen, 16)),
      });

      return send(res, 200, { ok: true, count: created.length, keys: created });
    } catch (e) {
      console.error("admin/license-keys/generate db hata:", e);
      return send(res, 500, { ok: false, error: "db_error" });
    }
  }

  // Admin: key listesi (q=code/not araması)
  if (req.method === "GET" && pathname === "/api/admin/license-keys") {
    if (!requireAdmin(req, res)) return;

    try {
      const q = query.q?.toString() || "";
      const limit = Number(query.limit || 200);
      const rows = await dbListLicenseKeys({ q, limit });
      return send(res, 200, { ok: true, list: rows });
    } catch (e) {
      console.error("admin/license-keys db hata:", e);
      return send(res, 500, { ok: false, error: "db_error" });
    }
  }

  // Admin: key istekleri listesi (status=open/handled/closed/all)
  if (req.method === "GET" && pathname === "/api/admin/key-requests") {
    if (!requireAdmin(req, res)) return;

    try {
      const status = query.status?.toString() || "open";
      const limit = Number(query.limit || 200);
      const rows = await dbListKeyRequests({ status, limit });
      return send(res, 200, { ok: true, list: rows });
    } catch (e) {
      console.error("admin/key-requests db hata:", e);
      return send(res, 500, { ok: false, error: "db_error" });
    }
  }

  // ================== PRODUCTS ADMIN (mevcut) ==================

  // Admin: ürün listesini TOPLU replace — lastChangeId artsın
  if (req.method === "POST" && pathname === "/api/admin/products") {
    // (isteğe bağlı admin koruma)
    if (!requireAdmin(req, res)) return;

    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];

    const cleaned = [];
    for (const row of items) {
      const gtin = normalizeGtin(row.gtin);
      const brandName = stripQuotes(row.brand_name || row.brandName || row.name);
      if (!gtin || !brandName) continue;
      cleaned.push({ gtin, brand_name: brandName });
    }

    if (!cleaned.length) {
      return send(res, 400, {
        ok: false,
        error: "Geçerli ürün bulunamadı (gtin + brand_name zorunlu).",
      });
    }

    productsData = {
      lastChangeId: nextChangeId(),
      updatedAt: new Date().toISOString(),
      items: cleaned,
    };

    await saveProductsToDisk();

    return send(res, 200, {
      ok: true,
      mode: "replace",
      count: cleaned.length,
      lastChangeId: productsData.lastChangeId,
      updatedAt: productsData.updatedAt,
    });
  }

  // Admin: TEK ÜRÜN EKLE / GÜNCELLE
  if (req.method === "POST" && pathname === "/api/admin/products/add") {
    // (isteğe bağlı admin koruma)
    if (!requireAdmin(req, res)) return;

    const body = await readBody(req);

    const gtin = normalizeGtin(body.gtin);
    const brandName = stripQuotes(body.brand_name || body.brandName || body.name);

    if (!gtin || !brandName) {
      return send(res, 400, { ok: false, error: "gtin ve brand_name zorunlu" });
    }

    const list = Array.isArray(productsData.items) ? productsData.items : [];
    const idx = list.findIndex((x) => normalizeGtin(x.gtin) === gtin);

    let action = "added";
    if (idx >= 0) {
      list[idx] = { gtin, brand_name: brandName };
      action = "updated";
    } else {
      list.push({ gtin, brand_name: brandName });
    }

    productsData = {
      lastChangeId: nextChangeId(),
      updatedAt: new Date().toISOString(),
      items: list,
    };

    await saveProductsToDisk();

    return send(res, 200, {
      ok: true,
      action,
      gtin,
      brand_name: brandName,
      total: productsData.items.length,
      lastChangeId: productsData.lastChangeId,
      updatedAt: productsData.updatedAt,
    });
  }

  // 404
  send(res, 404, { ok: false, error: "Not found" });
});

// boot
(async () => {
  await loadProductsFromDisk();
  server.listen(PORT, () => {
    console.log(`Mini backend çalışıyor → http://localhost:${PORT}`);
  });
})().catch((err) => {
  console.error("Başlangıçta load hatası:", err);
  server.listen(PORT, () => {
    console.log(`Mini backend (load HATALI ama yine de ayakta) → http://localhost:${PORT}`);
  });
});
