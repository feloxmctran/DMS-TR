// server/index.js
import http from "http";
import { parse } from "url";
import { promises as fs } from "fs";

import pg from "pg";
const { Pool } = pg;

// LOCAL Postgres (şimdilik)
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
let defaultDays = Number(process.env.DEFAULT_TRIAL_DAYS || 14); // deneme süresi gün


// Ürün kataloğu (GTIN + İlaç adı) için kalıcı JSON
const PRODUCTS_FILE = new URL("./products.json", import.meta.url);


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
  // sadece rakam tut
  g = g.replace(/\D/g, "");
  // 14 hane ve başı 0 ise 13'e indir
  if (g.length === 14 && g.startsWith("0")) g = g.slice(1);
  // 13/14 dışı ise yine de döndür (bazı kaynaklar farklı yazabilir), ama en az 8-14 arası mantıklı
  return g;
}

function nextChangeId() {
  return (typeof productsData.lastChangeId === "number" ? productsData.lastChangeId : 0) + 1;
}

// ===================== trials db helpers =====================
async function dbGetTrialDevice(deviceId) {
  const q = `
    select device_id, name, started_at, expires_at, extended_days, last_seen_at, notes
    from trial_devices
    where device_id = $1
    limit 1
  `;
  const r = await pool.query(q, [String(deviceId)]);
  return r.rows[0] || null;
}

async function dbUpsertTrialDevice({ deviceId, expiresAtIso, name }) {

  const q = `
    insert into trial_devices (device_id, name, started_at, expires_at, extended_days, last_seen_at, updated_at)
values ($1, $2, now(), $3::timestamptz, 0, now(), now())
    on conflict (device_id)
    do update set
  name = excluded.name,
  expires_at = excluded.expires_at,
  last_seen_at = now(),
  updated_at = now()
    returning device_id, started_at, expires_at, extended_days
  `;
  const r = await pool.query(q, [String(deviceId), name || null, String(expiresAtIso)]);

  return r.rows[0];
}

async function dbSetExtensionRequested(deviceId, requested = true) {
  const note = requested ? "EXTENSION_REQUESTED" : null;

  const q = `
    insert into trial_devices (device_id, started_at, expires_at, extended_days, last_seen_at, notes, updated_at)
    values ($1, now(), now(), 0, now(), $2, now())
    on conflict (device_id)
    do update set
      notes = $2,
      last_seen_at = now(),
      updated_at = now()
    returning device_id, notes
  `;

  const r = await pool.query(q, [String(deviceId), note]);
  return r.rows[0] || null;
}

async function dbListTrials() {
  const q = `
    select device_id, name, started_at, expires_at, notes
from trial_devices
    order by started_at desc
    limit 500
  `;
  const r = await pool.query(q);
  return r.rows || [];
}

async function dbSetTrialName(deviceId, name) {
  const q = `
    insert into trial_devices (device_id, name, started_at, expires_at, extended_days, last_seen_at, updated_at)
    values ($1, $2, now(), now(), 0, now(), now())
    on conflict (device_id)
    do update set
      name = excluded.name,
      updated_at = now()
    returning device_id, name
  `;
  const r = await pool.query(q, [String(deviceId), name || null]);
  return r.rows[0] || null;
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
    console.warn(
      "loadProductsFromDisk uyarı (products.json yok olabilir):",
      e.message
    );
  }
}

async function saveProductsToDisk() {
  try {
    await fs.writeFile(
      PRODUCTS_FILE,
      JSON.stringify(productsData, null, 2),
      "utf8"
    );
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
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // health
  if (req.method === "GET" && pathname === "/api/health") {
    return send(res, 200, { ok: true, now: new Date().toISOString() });
  }

  // ✅ Telefon SYNC buradan çekecek
  if (req.method === "GET" && pathname === "/initial_products.json") {
    return send(res, 200, {
      lastChangeId: productsData.lastChangeId || 0,
      updatedAt: productsData.updatedAt || null,
      items: Array.isArray(productsData.items) ? productsData.items : [],
    }, { "Cache-Control": "no-store" });
  }

  // ================== TRIAL API'LERİ ==================
    if (req.method === "POST" && pathname === "/api/trial/register") {
    const { stakeholderId, partnerId, deviceId, stakeholderName } =
      await readBody(req);

    if (!stakeholderId || !deviceId) {
      return send(res, 400, {
        ok: false,
        error: "stakeholderId ve deviceId gerekli",
      });
    }

    try {
      const now = new Date();

      // varsa ve süresi dolmadıysa "exists"
      const existing = await dbGetTrialDevice(deviceId);
      if (existing?.expires_at) {
        const exp = new Date(existing.expires_at);
        if (!isNaN(exp.getTime()) && exp > now) {
          // name geldiyse kayıtlı name'i güncelle (trial aktifken de)
if (stakeholderName) {
  await dbUpsertTrialDevice({
    deviceId,
    expiresAtIso: new Date(existing.expires_at).toISOString(),
    name: stakeholderName || null,
  });
}

          return send(res, 200, {
            ok: true,
            status: "exists",
            stakeholderId,
            deviceId,
            createdAt: existing.started_at
              ? new Date(existing.started_at).toISOString()
              : null,
            expiresAt: new Date(existing.expires_at).toISOString(),
            partnerId: partnerId || "",
            stakeholderName: stakeholderName || "",
          });
        }
      }

      // yoksa / süresi dolduysa: yeni expiry yaz
      const expiresAt = addDays(now.toISOString(), defaultDays);

      const saved = await dbUpsertTrialDevice({
  deviceId,
  expiresAtIso: expiresAt,
  name: stakeholderName || null,
});



      return send(res, 200, {
        ok: true,
        status: "created",
        stakeholderId,
        deviceId,
        createdAt: saved?.started_at
          ? new Date(saved.started_at).toISOString()
          : now.toISOString(),
        expiresAt: saved?.expires_at
          ? new Date(saved.expires_at).toISOString()
          : expiresAt,
        partnerId: partnerId || "",
        stakeholderName: stakeholderName || "",
      });
    } catch (e) {
      console.error("trial/register db hata:", e);
      return send(res, 500, { ok: false, error: "db_error" });
    }
  }


  if (req.method === "GET" && pathname === "/api/trial/status") {
  const stakeholderId = query.stakeholderId?.toString(); // şimdilik client aynı kalsın
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
    const row = await dbGetTrialDevice(deviceId);

    if (!row || !row.expires_at) {
      return send(res, 200, {
        ok: true,
        allowed: false,
        reason: "no_trial",
        stakeholderId,
        deviceId,
        createdAt: row?.started_at ? new Date(row.started_at).toISOString() : null,
        expiresAt: null,
      });
    }

    const now = new Date();
    const exp = new Date(row.expires_at);

    if (isNaN(exp.getTime())) {
      return send(res, 200, {
        ok: true,
        allowed: false,
        reason: "no_trial",
        stakeholderId,
        deviceId,
        createdAt: row.started_at ? new Date(row.started_at).toISOString() : null,
        expiresAt: null,
      });
    }

    // last_seen_at güncelle (best-effort)
    pool.query(
      "update trial_devices set last_seen_at = now(), updated_at = now() where device_id = $1",
      [String(deviceId)]
    ).catch(() => {});

    if (exp > now) {
      return send(res, 200, {
        ok: true,
        allowed: true,
        reason: "ok",
        stakeholderId,
        deviceId,
        createdAt: row.started_at ? new Date(row.started_at).toISOString() : null,
        expiresAt: new Date(row.expires_at).toISOString(),
      });
    }

    return send(res, 200, {
      ok: true,
      allowed: false,
      reason: "trial_expired",
      stakeholderId,
      deviceId,
      createdAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      expiresAt: new Date(row.expires_at).toISOString(),
    });
  } catch (e) {
    console.error("trial/status db hata:", e);
    return send(res, 500, { ok: false, allowed: false, error: "db_error" });
  }
}


    if (req.method === "POST" && pathname === "/api/trial/extend-request") {
    const { stakeholderId, deviceId } = await readBody(req);

    if (!stakeholderId || !deviceId) {
      return send(res, 400, {
        ok: false,
        error: "stakeholderId ve deviceId gerekli",
      });
    }

    try {
      await dbSetExtensionRequested(deviceId, true);

      return send(res, 200, {
        ok: true,
        stakeholderId,
        deviceId,
        extensionRequested: true,
      });
    } catch (e) {
      console.error("trial/extend-request db hata:", e);
      return send(res, 500, { ok: false, error: "db_error" });
    }
  }

  if (req.method === "POST" && pathname === "/api/trial/name") {
  const { deviceId, name } = await readBody(req);

  if (!deviceId) {
    return send(res, 400, { ok: false, error: "deviceId gerekli" });
  }

  try {
    const row = await dbSetTrialName(deviceId, String(name || "").trim());
    return send(res, 200, { ok: true, deviceId: row?.device_id, name: row?.name || "" });
  } catch (e) {
    console.error("trial/name db hata:", e);
    return send(res, 500, { ok: false, error: "db_error" });
  }
}


  // ================== ADMIN API'LERİ ==================

  // Admin listesi
  if (req.method === "GET" && pathname === "/api/admin/trials") {
  try {
    const rows = await dbListTrials();

    const list = rows.map((r) => {
      const createdAtIso = r.started_at ? new Date(r.started_at).toISOString() : null;

      let daysSinceCreated = null;
      if (createdAtIso) {
        const cd = new Date(createdAtIso);
        if (!isNaN(cd.getTime())) {
          const diffMs = Date.now() - cd.getTime();
          daysSinceCreated = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        }
      }

      return {
        stakeholderId: "", // DB şemasında yok; client bozulmasın diye alanı koruyoruz
        deviceId: r.device_id,
        createdAt: createdAtIso,
        daysSinceCreated,
        expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        partnerId: "", // DB şemasında yok
        stakeholderName: r.name || "",
        extensionRequested: String(r.notes || "") === "EXTENSION_REQUESTED",
      };
    });

    return send(res, 200, { ok: true, defaultDays, list });
  } catch (e) {
    console.error("admin/trials db hata:", e);
    return send(res, 500, { ok: false, error: "db_error" });
  }
}


  // Admin: ürün listesini TOPLU replace (mevcut endpoint) — lastChangeId artsın
  if (req.method === "POST" && pathname === "/api/admin/products") {
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

  // ✅ Admin: TEK ÜRÜN EKLE / GÜNCELLE  (yeni)
  // Body: { gtin, brand_name }
  if (req.method === "POST" && pathname === "/api/admin/products/add") {
    const body = await readBody(req);

    const gtin = normalizeGtin(body.gtin);
    const brandName = stripQuotes(body.brand_name || body.brandName || body.name);

    if (!gtin || !brandName) {
      return send(res, 400, {
        ok: false,
        error: "gtin ve brand_name zorunlu",
      });
    }

    const list = Array.isArray(productsData.items) ? productsData.items : [];
    const idx = list.findIndex((x) => normalizeGtin(x.gtin) === gtin);

    let action = "added";
    if (idx >= 0) {
      // güncelle
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
