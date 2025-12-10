// server/index.js
import http from "http";
import { parse } from "url";
import { promises as fs } from "fs";

const PORT = process.env.PORT || 4000;

// Kalıcı veri dosyası (JSON)
const DATA_FILE = new URL("./trials.json", import.meta.url);
// İlaç kataloğu (GTIN + İlaç adı) için kalıcı JSON
const PRODUCTS_FILE = new URL("./products.json", import.meta.url);


// Basit in-memory veriler
let defaultDays = 14; // deneme süresi gün
// trials: Map<stakeholderId, {
//   partnerId?: string,
//   stakeholderName?: string,
//   devices: Map<deviceId, {
//     createdAt?: string,
//     expiresAt: string | null,
//     extensionRequested?: boolean
//   }>
// }>
const trials = new Map();

// Bir stakeholder için trial kaydı al / yoksa oluştur + partner/name güncelle
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

// Yardımcı
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

/* ============ KALICI JSON KATMANI ============ */

// Bellekteki trials + defaultDays → JSON olarak diske yaz
async function saveToDisk() {
  try {
    const serialized = {
      defaultDays,
      trials: Array.from(trials.entries()).map(([stakeholderId, rec]) => ({
        stakeholderId,
        partnerId: rec.partnerId || "",
        stakeholderName: rec.stakeholderName || "",
        devices: Array.from(rec.devices.entries()).map(
          ([deviceId, info]) => ({
            deviceId,
            createdAt: info.createdAt || null,
            expiresAt: info.expiresAt || null,
            extensionRequested: !!info.extensionRequested,
          })
        ),
      })),
    };

    await fs.writeFile(
      DATA_FILE,
      JSON.stringify(serialized, null, 2),
      "utf8"
    );
  } catch (e) {
    console.error("saveToDisk hata:", e);
  }
}

// Uygulama açılırken trials.json varsa oku ve Map'leri yeniden kur
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
          stakeholderName: t.stakeholderName
            ? String(t.stakeholderName)
            : "",
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
    // Dosya yoksa veya bozuksa sessizce geç (ilk çalıştırma vs.)
    console.warn("loadFromDisk uyarı (ilk çalıştırma olabilir):", e.message);
  }
}

/* ============ ROTALAR ============ */

const server = http.createServer(async (req, res) => {
  const { pathname, query } = parse(req.url, true);

  // CORS preflight (OPTIONS) yanıtı
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // Sağlık kontrol
  if (req.method === "GET" && pathname === "/api/health") {
    return send(res, 200, { ok: true, now: new Date().toISOString() });
  }

  // ================== TRIAL API'LERİ ==================

  // Settings'te stakeholder seçildiğinde trial kayıt / başlat
  // Body: { stakeholderId, partnerId?, deviceId, stakeholderName? }
  if (req.method === "POST" && pathname === "/api/trial/register") {
    const { stakeholderId, partnerId, deviceId, stakeholderName } =
      await readBody(req);

    if (!stakeholderId || !deviceId) {
      return send(res, 400, {
        ok: false,
        error: "stakeholderId ve deviceId gerekli",
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const rec = getOrCreateTrialRecord(
      stakeholderId,
      partnerId,
      stakeholderName
    );

    let info = rec.devices.get(deviceId);

    // Eğer bu cihaz için hâlihazırda gelecekte biten bir trial varsa, süresini kısaltma
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

    // Yeni trial başlat (veya süresi bitmiş olanı güncelle)
    const expiresAt = addDays(nowIso, defaultDays);

    // createdAt: ilk kayıtta now, sonrakilerde eski değer korunur
    const createdAt = info?.createdAt || nowIso;

    info = {
      ...(info || {}),
      createdAt,
      expiresAt,
      extensionRequested: false,
    };
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

  // Receive / Stock Count'a girmeden önce trial durumu
  // Query: ?stakeholderId=...&deviceId=...
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

  // Settings'ten "İlave deneme süresi iste"
  // NOT: Burada sadece extensionRequested=true işaretlenir,
  // asıl tarih değişikliği admin endpoint'lerinden yapılır.
  if (req.method === "POST" && pathname === "/api/trial/extend-request") {
    const { stakeholderId, deviceId } = await readBody(req);

    if (!stakeholderId || !deviceId) {
      return send(res, 400, {
        ok: false,
        error: "stakeholderId ve deviceId gerekli",
      });
    }

    const rec = getOrCreateTrialRecord(stakeholderId);
    const nowIso = new Date().toISOString();
    let info =
      rec.devices.get(deviceId) || {
        createdAt: nowIso,
        expiresAt: null,
        extensionRequested: false,
      };

    if (!info.createdAt) {
      info.createdAt = nowIso;
    }

    info = {
      ...info,
      extensionRequested: true,
    };
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

  // Admin: belirli bir cihaz için trial'ı hemen kapat (expire'i düne çek)
  // Body: { stakeholderId, deviceId }
  if (req.method === "POST" && pathname === "/api/admin/trial-close") {
    const { stakeholderId, deviceId } = await readBody(req);

    if (!stakeholderId || !deviceId) {
      return send(res, 400, {
        ok: false,
        error: "stakeholderId ve deviceId gerekli",
      });
    }

    const rec = trials.get(stakeholderId);
    if (!rec) {
      // Kayıt yoksa sessizce ok dönelim (test için)
      return send(res, 200, {
        ok: true,
        status: "no_record",
        stakeholderId,
        deviceId,
        expiresAt: null,
      });
    }

    const info = rec.devices.get(deviceId);
    if (!info) {
      return send(res, 200, {
        ok: true,
        status: "no_device_record",
        stakeholderId,
        deviceId,
        expiresAt: null,
      });
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const exp = yesterday.toISOString();

    info.expiresAt = exp;
    info.extensionRequested = false;
    // createdAt aynen korunuyor
    rec.devices.set(deviceId, info);

    await saveToDisk();

    return send(res, 200, {
      ok: true,
      status: "closed",
      stakeholderId,
      deviceId,
      expiresAt: exp,
    });
  }

  // Admin listesi (web-only ekran için)
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
            daysSinceCreated = Math.floor(
              diffMs / (24 * 60 * 60 * 1000)
            );
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

  // Admin default deneme süresi güncelle
  if (req.method === "POST" && pathname === "/api/admin/default-expiry") {
    const { days } = await readBody(req);
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) {
      return send(res, 400, {
        ok: false,
        error: "days pozitif sayı olmalı",
      });
    }
    defaultDays = n;

    await saveToDisk();

    return send(res, 200, { ok: true, defaultDays });
  }

  // Admin: tek bir kayda +N gün ekle
  // Body: { stakeholderId, deviceId, days }
  if (req.method === "POST" && pathname === "/api/admin/trial/extend") {
    const { stakeholderId, deviceId, days } = await readBody(req);

    if (!stakeholderId || !deviceId) {
      return send(res, 400, {
        ok: false,
        error: "stakeholderId ve deviceId gerekli",
      });
    }

    const n = Number(days ?? 7);
    if (!Number.isFinite(n) || n <= 0) {
      return send(res, 400, {
        ok: false,
        error: "days pozitif sayı olmalı",
      });
    }

    const rec = getOrCreateTrialRecord(stakeholderId);
    const now = new Date();
    const nowIso = now.toISOString();
    let info =
      rec.devices.get(deviceId) || {
        createdAt: nowIso,
        expiresAt: null,
        extensionRequested: false,
      };

    if (!info.createdAt) {
      info.createdAt = nowIso;
    }

    const cur = info.expiresAt ? new Date(info.expiresAt) : null;
    const baseDate =
      cur && !isNaN(cur.getTime()) && cur > now
        ? cur.toISOString()
        : nowIso;

    const newExp = addDays(baseDate, n);

    info = {
      ...info,
      expiresAt: newExp,
      extensionRequested: false, // talep karşılandı
    };
    rec.devices.set(deviceId, info);

    await saveToDisk();

    return send(res, 200, {
      ok: true,
      stakeholderId,
      deviceId,
      createdAt: info.createdAt,
      expiresAt: newExp,
    });
  }

  // Admin: trial kapat (bugünden bir gün öncesine çek)
  // Body: { stakeholderId, deviceId }
  if (req.method === "POST" && pathname === "/api/admin/trial/close") {
    const { stakeholderId, deviceId } = await readBody(req);

    if (!stakeholderId || !deviceId) {
      return send(res, 400, {
        ok: false,
        error: "stakeholderId ve deviceId gerekli",
      });
    }

    const rec = getOrCreateTrialRecord(stakeholderId);
    const now = new Date();
    const nowIso = now.toISOString();
    let info =
      rec.devices.get(deviceId) || {
        createdAt: nowIso,
        expiresAt: null,
        extensionRequested: false,
      };

    if (!info.createdAt) {
      info.createdAt = nowIso;
    }

    const closedAt = addDays(nowIso, -1); // dünden başlat

    info = {
      ...info,
      expiresAt: closedAt,
      extensionRequested: false,
    };
    rec.devices.set(deviceId, info);

    await saveToDisk();

    return send(res, 200, {
      ok: true,
      stakeholderId,
      deviceId,
      createdAt: info.createdAt,
      expiresAt: closedAt,
    });
  }


  // Admin: İlaç listesi (GTIN + İlaç adı) yükleme
  // Body: { items: [ { gtin: string, brand_name: string }, ... ] }
      if (req.method === "POST" && pathname === "/api/admin/products") {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];

    const cleaned = [];
    const stripQuotes = (s) => {
      s = String(s || "").trim();
      if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
        s = s.slice(1, -1);
      }
      return s;
    };

    for (const row of items) {
      const gtin = stripQuotes(row.gtin);
      const brandName = stripQuotes(row.brand_name);
      if (!gtin || !brandName) continue;
      cleaned.push({ gtin, brand_name: brandName });
    }

    if (!cleaned.length) {
      return send(res, 400, {
        ok: false,
        error: "Geçerli ürün bulunamadı (gtin + brand_name zorunlu).",
      });
    }

    const payload = {
      updatedAt: new Date().toISOString(),
      items: cleaned,
    };

    await fs.writeFile(
      PRODUCTS_FILE,
      JSON.stringify(payload, null, 2),
      "utf8"
    );

    return send(res, 200, {
      ok: true,
      count: cleaned.length,
    });
  }




  // ================== 404 ==================
  send(res, 404, { ok: false, error: "Not found" });
});

/* Başlangıçta JSON'dan yükle + sonra listen */
(async () => {
  await loadFromDisk();
  server.listen(PORT, () => {
    console.log(`Mini backend çalışıyor → http://localhost:${PORT}`);
  });
})().catch((err) => {
  console.error("Başlangıçta loadFromDisk hatası:", err);
  server.listen(PORT, () => {
    console.log(
      `Mini backend (loadFromDisk HATALI ama yine de ayakta) → http://localhost:${PORT}`
    );
  });
});
