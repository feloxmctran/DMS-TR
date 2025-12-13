// server/index.js
import http from "http";
import { parse } from "url";
import { promises as fs } from "fs";

const PORT = process.env.PORT || 4000;

// Kalıcı veri dosyası (JSON)
const DATA_FILE = new URL("./trials.json", import.meta.url);
// Ürün kataloğu (GTIN + İlaç adı) için kalıcı JSON
const PRODUCTS_FILE = new URL("./products.json", import.meta.url);

// Basit in-memory veriler
let defaultDays = 14; // deneme süresi gün
const trials = new Map();

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

// ===================== trials helpers =====================
function getOrCreateTrialRecord(stakeholderId, partnerId, stakeholderName) {
  let rec = trials.get(stakeholderId);
  if (!rec) {
    rec = {
      devices: new Map(),
      partnerId: partnerId || "",
      stakeholderName: stakeholderName || "",
    };
    trials.set(stakeholderId, rec);
  } else {
    if (partnerId) rec.partnerId = partnerId;
    if (stakeholderName) rec.stakeholderName = stakeholderName;
  }
  return rec;
}

// ===================== disk layer =====================
async function saveToDisk() {
  try {
    const serialized = {
      defaultDays,
      trials: Array.from(trials.entries()).map(([stakeholderId, rec]) => ({
        stakeholderId,
        partnerId: rec.partnerId || "",
        stakeholderName: rec.stakeholderName || "",
        devices: Array.from(rec.devices.entries()).map(([deviceId, info]) => ({
          deviceId,
          createdAt: info.createdAt || null,
          expiresAt: info.expiresAt || null,
          extensionRequested: !!info.extensionRequested,
        })),
      })),
    };

    await fs.writeFile(DATA_FILE, JSON.stringify(serialized, null, 2), "utf8");
  } catch (e) {
    console.error("saveToDisk hata:", e);
  }
}

async function loadFromDisk() {
  try {
    const txt = await fs.readFile(DATA_FILE, "utf8");
    if (!txt) return;

    const data = JSON.parse(txt);

    if (typeof data.defaultDays === "number" && data.defaultDays > 0) {
      defaultDays = data.defaultDays;
    }

    trials.clear();

    if (Array.isArray(data.trials)) {
      for (const t of data.trials) {
        const stakeholderId = String(t.stakeholderId ?? "");
        if (!stakeholderId) continue;

        const rec = {
          partnerId: t.partnerId ? String(t.partnerId) : "",
          stakeholderName: t.stakeholderName ? String(t.stakeholderName) : "",
          devices: new Map(),
        };

        const devs = Array.isArray(t.devices) ? t.devices : [];
        for (const d of devs) {
          const deviceId = String(d.deviceId ?? "");
          if (!deviceId) continue;

          rec.devices.set(deviceId, {
            createdAt: d.createdAt || null,
            expiresAt: d.expiresAt || null,
            extensionRequested: !!d.extensionRequested,
          });
        }

        trials.set(stakeholderId, rec);
      }
    }

    console.log(
      `trials.json yüklendi → ${trials.size} stakeholder, defaultDays=${defaultDays}`
    );
  } catch (e) {
    console.warn("loadFromDisk uyarı (ilk çalıştırma olabilir):", e.message);
  }
}

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
      return send(res, 400, { ok: false, error: "stakeholderId ve deviceId gerekli" });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const rec = getOrCreateTrialRecord(stakeholderId, partnerId, stakeholderName);

    let info = rec.devices.get(deviceId);

    if (info && info.expiresAt) {
      const existingExp = new Date(info.expiresAt);
      if (!isNaN(existingExp.getTime()) && existingExp > now) {
        return send(res, 200, {
          ok: true,
          status: "exists",
          stakeholderId,
          deviceId,
          createdAt: info.createdAt || null,
          expiresAt: info.expiresAt,
          partnerId: rec.partnerId || "",
          stakeholderName: rec.stakeholderName || "",
        });
      }
    }

    const expiresAt = addDays(nowIso, defaultDays);
    const createdAt = info?.createdAt || nowIso;

    info = { ...(info || {}), createdAt, expiresAt, extensionRequested: false };
    rec.devices.set(deviceId, info);

    await saveToDisk();

    return send(res, 200, {
      ok: true,
      status: "created",
      stakeholderId,
      deviceId,
      createdAt,
      expiresAt,
      partnerId: rec.partnerId || "",
      stakeholderName: rec.stakeholderName || "",
    });
  }

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

    const rec = trials.get(stakeholderId);
    const info = rec?.devices?.get(deviceId);

    if (!info || !info.expiresAt) {
      return send(res, 200, {
        ok: true,
        allowed: false,
        reason: "no_trial",
        stakeholderId,
        deviceId,
        createdAt: info?.createdAt || null,
        expiresAt: null,
      });
    }

    const now = new Date();
    const exp = new Date(info.expiresAt);

    if (isNaN(exp.getTime())) {
      return send(res, 200, {
        ok: true,
        allowed: false,
        reason: "no_trial",
        stakeholderId,
        deviceId,
        createdAt: info.createdAt || null,
        expiresAt: null,
      });
    }

    if (exp > now) {
      return send(res, 200, {
        ok: true,
        allowed: true,
        reason: "ok",
        stakeholderId,
        deviceId,
        createdAt: info.createdAt || null,
        expiresAt: info.expiresAt,
      });
    }

    return send(res, 200, {
      ok: true,
      allowed: false,
      reason: "trial_expired",
      stakeholderId,
      deviceId,
      createdAt: info.createdAt || null,
      expiresAt: info.expiresAt,
    });
  }

  if (req.method === "POST" && pathname === "/api/trial/extend-request") {
    const { stakeholderId, deviceId } = await readBody(req);

    if (!stakeholderId || !deviceId) {
      return send(res, 400, { ok: false, error: "stakeholderId ve deviceId gerekli" });
    }

    const rec = getOrCreateTrialRecord(stakeholderId);
    const nowIso = new Date().toISOString();
    let info = rec.devices.get(deviceId) || {
      createdAt: nowIso,
      expiresAt: null,
      extensionRequested: false,
    };

    if (!info.createdAt) info.createdAt = nowIso;

    info = { ...info, extensionRequested: true };
    rec.devices.set(deviceId, info);

    await saveToDisk();

    return send(res, 200, {
      ok: true,
      stakeholderId,
      deviceId,
      extensionRequested: true,
    });
  }

  // ================== ADMIN API'LERİ ==================

  // Admin listesi
  if (req.method === "GET" && pathname === "/api/admin/trials") {
    const list = [];
    for (const [sid, entry] of trials.entries()) {
      for (const [dev, info] of entry.devices.entries()) {
        const createdAt = info.createdAt || null;
        let daysSinceCreated = null;

        if (createdAt) {
          const cd = new Date(createdAt);
          if (!isNaN(cd.getTime())) {
            const diffMs = Date.now() - cd.getTime();
            daysSinceCreated = Math.floor(diffMs / (24 * 60 * 60 * 1000));
          }
        }

        list.push({
          stakeholderId: sid,
          deviceId: dev,
          createdAt,
          daysSinceCreated,
          expiresAt: info.expiresAt || null,
          partnerId: entry.partnerId || "",
          stakeholderName: entry.stakeholderName || "",
          extensionRequested: !!info.extensionRequested,
        });
      }
    }
    return send(res, 200, { ok: true, defaultDays, list });
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
  await loadFromDisk();
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
