// App.tsx — DataMatrix Scanner (admin ayrıldı, anahtar/gizleme alanları kaldırıldı)
// Not: Admin sayfası artık ./pages/AdminStakeholders içinde, yalnız web'de erişilir.

import React, { useEffect, useState } from "react";

import "./i18n";
import { useTranslation } from "react-i18next";

import { Preferences } from "@capacitor/preferences";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

import AdminGate from "./pages/AdminGate";
import FastPage from "./pages/FastPage";
import EasyPage from "./pages/EasyPage";
import EasyFinalPage from "./pages/EasyFinalPage";

import { FastStockScanner } from "./plugins/fastStockScanner";
import type { ProductRow } from "./plugins/fastStockScanner";

/* ============== SABİTLER ============== */
const K = {
  stakeholderId: "ndb_my_stakeholder_id",
  trialExpiry: "ndb_trial_expiry_ms",
};

const isNative = () => Capacitor.isNativePlatform();

/* ============== yardımcılar ============== */
const prefGet = async (key: string) =>
  (await Preferences.get({ key })).value || "";
const prefSet = async (key: string, value?: string) =>
  Preferences.set({ key, value: value ?? "" });

function csvSafe(v: any) {
  const s = String(v ?? "");
  return s.replace(/\r?\n/g, " ").replace(/[\u2013\u2014]/g, "-");
}


export type StockScanStatus = "sellable" | "nonsellable" | "error";

export type StockScanLog = {
  brand: string;
  gtin: string;
  lot: string;
  sn?: string;
  raw: string;
  t: string; // ISO datetime
  status: StockScanStatus;
  title: string;
  description: string;
  note?: string;
};

/** Cihaz kimliği */
async function getDeviceId(): Promise<string> {
  const KEY = "device_id";
  const cur = await prefGet(KEY);
  if (cur) return cur;
  const uuid =
    (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)) + Date.now();
  await prefSet(KEY, uuid);
  return uuid;
}

/** Trial API tabanı — web’de localhost, native’de PC’nin IP’si */
const TRIAL_API_BASE = "https://dms-tr.onrender.com";


const FAST_PRODUCTS_URL = `${TRIAL_API_BASE}/initial_products.json`;


/** FAST ürün kataloğu için Preferences anahtarları */
const FAST_PRODUCTS_INITIALIZED_KEY = "fast_products_initialized_v2";
const FAST_PRODUCTS_LAST_CHANGE_ID_KEY = "fast_products_last_change_id";

async function ensureFastProductsInitialized() {
  try {
    if (!isNative()) return;

    const { value } = await Preferences.get({
      key: FAST_PRODUCTS_INITIALIZED_KEY,
    });
    if (value === "1") return;

    const res = await fetch(FAST_PRODUCTS_URL);

    if (!res.ok) {
      console.error("initial_products.json okunamadı:", res.status);
      return;
    }

    const data = await res.json();
    const items = (data.items || []).map((it: any) => ({
  gtin: String(it.gtin || ""),
  // her iki formatı da destekle
  brand_name: String(it.brand_name || it.name || ""),
})) as ProductRow[];


    if (!items.length) {
      console.warn("initial_products.json içinde ürün bulunamadı.");
      return;
    }

    const result = await FastStockScanner.importInitialProducts({ items });

    console.log(
      "FAST initial products import tamamlandı. Kayıt sayısı:",
      result?.count ?? items.length
    );

    if (typeof (data as any).lastChangeId === "number") {
      await Preferences.set({
        key: FAST_PRODUCTS_LAST_CHANGE_ID_KEY,
        value: String((data as any).lastChangeId),
      });
    }

    await Preferences.set({
      key: FAST_PRODUCTS_INITIALIZED_KEY,
      value: "1",
    });
  } catch (err) {
    console.error("FAST ürün kataloğu initial import hatası:", err);
  }
}

/** HTTP helper */
async function httpGet(url: string, headers: Record<string, string> = {}) {
  if (isNative()) {
    const r = await CapacitorHttp.get({ url, headers });
    return typeof r.data === "string" ? JSON.parse(r.data || "{}") : r.data || {};
  } else {
    const r = await fetch(url, { headers });
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }
}
async function httpPost(
  url: string,
  data: any,
  headers: Record<string, string> = {}
) {
  if (isNative()) {
    const r = await CapacitorHttp.post({
      url,
      data,
      headers: { "Content-Type": "application/json", ...headers },
    });
    return typeof r.data === "string" ? JSON.parse(r.data || "{}") : r.data || {};
  } else {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }
}

/** Trial uçları */
async function trialRegister(stakeholderId: string, partnerId: string) {
  const deviceId = await getDeviceId();
  return httpPost(`${TRIAL_API_BASE}/api/trial/register`, {
    stakeholderId,
    partnerId,
    deviceId,
  });
}
async function trialStatus(stakeholderId: string) {
  const deviceId = await getDeviceId();
  const q = new URLSearchParams({ stakeholderId, deviceId }).toString();
  return httpGet(`${TRIAL_API_BASE}/api/trial/status?${q}`);
}
async function trialExtendRequest(stakeholderId: string) {
  const deviceId = await getDeviceId();
  return httpPost(`${TRIAL_API_BASE}/api/trial/extend-request`, {
    stakeholderId,
    deviceId,
  });
}

/* ============== STİL ============== */
const UI: {
  page: React.CSSProperties;
  logoWrap: React.CSSProperties;
  logoBadge: React.CSSProperties;
  logoText: React.CSSProperties;
  grid4: React.CSSProperties;
  bigBtn: React.CSSProperties;
  card: React.CSSProperties;
  input: React.CSSProperties;
} = {
  page: {
  padding: "44px 12px 16px",
    fontFamily: "system-ui",
    background: "#fff",
    color: "#0f172a",
    minHeight: "100vh",
    width: "100%",
    margin: 0,
    boxSizing: "border-box",
    overflowX: "hidden",
  },
  logoWrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  logoBadge: {
    fontWeight: 900,
    fontSize: 16,
    letterSpacing: 1,
    padding: "8px 14px",
    borderRadius: 999,
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    boxShadow: "0 4px 12px rgba(15,23,42,.18)",
  },
  logoText: {
    fontWeight: 700,
    fontSize: 17,
    color: "#111827",
    opacity: 0.75,
  },
  grid4: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
    marginTop: 16,
    width: "100%",
    boxSizing: "border-box",
  },
  bigBtn: {
    padding: "18px 26px",
    borderRadius: 18,
    border: "none",
    boxShadow: "0 4px 10px rgba(0,0,0,0.18)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    fontWeight: 700,
    fontSize: 17,
    maxWidth: 260,
    width: "100%",
    margin: "0 auto",
  },
  card: {
    marginTop: 12,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 12,
    boxShadow: "0 2px 8px rgba(17,24,39,.05)",
  },
  input: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: "#f8fafc",
    color: "#111",
    boxSizing: "border-box",
    outline: "none",
  },
};

const ANON_BTN: React.CSSProperties = {
  ...UI.bigBtn,
  background: "linear-gradient(180deg, #7cc464, #4c9c32)",
  color: "#ffffff",
};

const TRIAL_BTN_GREEN: React.CSSProperties = {
  ...UI.bigBtn,
  background: "linear-gradient(180deg, #7cc464, #4c9c32)",
  color: "#ffffff",
};

const TRIAL_BTN_RED: React.CSSProperties = {
  ...UI.bigBtn,
  background: "linear-gradient(180deg, #ffb347, #f97316)",
  color: "#ffffff",
};

const Card: React.FC<React.PropsWithChildren<{ title?: string }>> = ({
  title,
  children,
}) => (
  <div style={UI.card}>
    {title && (
      <div
        style={{
          fontWeight: 800,
          fontSize:
            typeof window !== "undefined" && window.innerWidth >= 1024 ? 16 : 14,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
    )}
    {children}
  </div>
);

/* ============== APP ============== */
// Yalnız web: /admin rotası mı? (module scope — SSR güvenli)
const isAdminRoute =
  !isNative() &&
  typeof window !== "undefined" &&
  window.location.pathname === "/admin";

export default function App() {
  const { t } = useTranslation();

  const [tab, setTab] = useState<"home" | "settings">("home");
  const [syncingProducts, setSyncingProducts] = useState(false);


  const isBrowser = typeof window !== "undefined";
  const [isWide, setIsWide] = useState<boolean>(
    !isNative() && isBrowser && window.innerWidth >= 1024
  );
  useEffect(() => {
    if (!isBrowser || isNative()) return;
    const onResize = () => setIsWide(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isBrowser]);

  // Stakeholder
  const [myStakeholderId, setMyStakeholderId] = useState<string>("");
  const [deviceId, setDeviceId] = useState<string | null>(null);

  // Trial state
  const [trialExpiresMs, setTrialExpiresMs] = useState<number | null>(null);
  const trialActive =
    trialExpiresMs != null ? Date.now() <= trialExpiresMs : false;

  // FAST sayfası
  const [showFastPage, setShowFastPage] = useState(false);

  // EASY sayfaları
  const [showEasyPage, setShowEasyPage] = useState(false);
  const [showEasyFinalPage, setShowEasyFinalPage] = useState(false);
  const [, setEasyCodes] = useState<string[]>([]);
  const [easyNote, setEasyNote] = useState("");
  const [easyItems, setEasyItems] = useState<StockScanLog[]>([]);
  const [easyResolving, setEasyResolving] = useState(false);

  // EASY geçmiş satış detayı
  const [easyHistorySale, setEasyHistorySale] = useState<any | null>(null);
  const [showEasyHistoryPage, setShowEasyHistoryPage] = useState(false);

  // EASY / stok sayım için karekod çözümleyici (API yok)
  const resolveStockItemByQR = async (
    rawQR: string
  ): Promise<StockScanLog | null> => {
    try {
      if (!rawQR) {
        return {
          brand: "",
          gtin: "",
          lot: "",
          raw: "",
          sn: "",
          t: new Date().toISOString(),
          status: "error",
          title: "Geçersiz karekod",
          description: "Boş karekod değeri alındı.",
        };
      }

      const s = String(rawQR);
      const m = s.match(/01(\d{14})/);
      let gtin = "";
      if (m && m[1]) {
        const gtin14 = m[1];
        gtin = gtin14.startsWith("0") ? gtin14.slice(1) : gtin14;
      } else {
        const digits = s.replace(/\D/g, "");
        if (digits.length >= 13) gtin = digits.slice(0, 13);
      }

      return {
        brand: "",
        gtin,
        lot: "",
        sn: "",
        raw: rawQR,
        t: new Date().toISOString(),
        status: "error",
        title: "Sorgu kapalı",
        description:
          "Bu sürümde NDB/API sorgusu yapılmıyor. Yalnızca kayıt/export yapılır.",
      };
    } catch (e: any) {
      return {
        brand: "",
        gtin: "",
        lot: "",
        raw: rawQR,
        sn: "",
        t: new Date().toISOString(),
        status: "error",
        title: "Hata",
        description: e?.message || "Karekod işlenemedi.",
      };
    }
  };

  // Ayarları yükle
  useEffect(() => {
    (async () => {
      setMyStakeholderId((await prefGet(K.stakeholderId)) || "");

      const id = await getDeviceId();
      setDeviceId(id);

      const savedTrial = Number((await prefGet(K.trialExpiry)) || "0");
      setTrialExpiresMs(
        Number.isFinite(savedTrial) && savedTrial > 0 ? savedTrial : null
      );
    })();
  }, []);

  // FAST ürün kataloğu (initial_products.json) → SQLite sync
  useEffect(() => {
    ensureFastProductsInitialized();
  }, []);

  // Settings tabına girildiğinde trial bilgisini sunucudan güncelle
  const refreshTrialFromServer = async () => {
    if (!myStakeholderId) return;
    try {
      const st = await trialStatus(myStakeholderId);

      if (st?.expiresAt) {
        const ms = Date.parse(st.expiresAt);
        if (Number.isFinite(ms)) {
          setTrialExpiresMs(ms);
          await prefSet(K.trialExpiry, String(ms));
          return;
        }
      }

      setTrialExpiresMs(null);
      await prefSet(K.trialExpiry, "");
    } catch {
      // mini-backend kapalıysa sessiz geç
    }
  };

  useEffect(() => {
    if (tab !== "settings") return;
    if (!myStakeholderId) return;
    refreshTrialFromServer();
  }, [tab, myStakeholderId]);

  const ensureOnline = (): boolean => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      alert("Internete bağlı değilsiniz, lütfen bağlantınızı kontrol edin.");
      return false;
    }
    return true;
  };

  // === Trial yardımcıları ===
  const ensureTrialOrAlert = async (): Promise<boolean> => {
    if (!myStakeholderId) {
      alert("Önce Settings → Eczane adını yazın.");
      setTab("settings");
      return false;
    }

    try {
      const st = await trialStatus(myStakeholderId);
      let allowed = !!st?.allowed;

      if (st?.expiresAt) {
        const ms = Date.parse(st.expiresAt);
        if (Number.isFinite(ms)) {
          setTrialExpiresMs(ms);
          await prefSet(K.trialExpiry, String(ms));
          if (ms > Date.now()) allowed = true;
        }
      }

      if (!allowed) {
        const reason = st?.reason;
        if (reason === "no_trial") {
          alert(
            "Receive / Stock Count için deneme süreniz başlatılmamış. Lütfen Settings bölümünden eczanenizi seçin."
          );
        } else if (reason === "trial_expired") {
          alert(
            "Deneme süreniz sona ermiştir. İlave deneme süresi isterseniz Settings içinden 'Deneme süremi arttır' butonu ile talep gönderebilirsiniz."
          );
        } else {
          alert(
            "Deneme süreniz yok veya bitmiş. Admin ile iletişime geçin ya da 'Deneme süremi arttır' talebi gönderin."
          );
        }
        return false;
      }

      return true;
    } catch (e: any) {
      console.warn("trialStatus alınamadı:", e);
      if (!trialActive) {
        alert(
          "Deneme süresi doğrulanamadı. İnternet bağlantınızı ve ayarlarınızı kontrol edin."
        );
        return false;
      }
      return true;
    }
  };

  const saveSettings = async () => {
    await prefSet(K.stakeholderId, myStakeholderId);

    if (myStakeholderId) {
      try {
        const st = await trialStatus(myStakeholderId);

        if (st?.expiresAt) {
          const ms = Date.parse(st.expiresAt);
          if (Number.isFinite(ms)) {
            setTrialExpiresMs(ms);
            await prefSet(K.trialExpiry, String(ms));
          }
        } else if (st?.reason === "no_trial") {
          const reg = await trialRegister(myStakeholderId, "");
          if (reg?.expiresAt) {
            const ms = Date.parse(reg.expiresAt);
            if (Number.isFinite(ms)) {
              setTrialExpiresMs(ms);
              await prefSet(K.trialExpiry, String(ms));
            }
          }
        }
      } catch {
        // mini-backend kapalıysa sessiz
      }
    }

    alert("Kaydedildi.");
    setTab("home");
  };

const syncFastProductsFromServer = async () => {
  if (!isNative()) {
    alert("SYNC sadece telefonda (native) çalışır.");
    return;
  }
  if (!ensureOnline()) return;

  setSyncingProducts(true);
  try {
    const data = await httpGet(FAST_PRODUCTS_URL);

    const items = (Array.isArray(data?.items) ? data.items : [])
      .map((it: any) => ({
        gtin: String(it.gtin || ""),
        brand_name: String(it.brand_name || it.name || ""),
      }))
      .filter((x: any) => x.gtin && x.brand_name) as ProductRow[];

    if (!items.length) {
      alert("initial_products.json içinde ürün bulunamadı.");
      return;
    }

    // @ts-ignore
    const res = await (FastStockScanner as any).syncProducts({ items });

    alert(
      `SYNC tamamlandı.\nYeni: ${res?.added ?? 0}\nGüncellenen: ${res?.updated ?? 0}\nToplam okunan: ${items.length}`
    );
  } catch (e: any) {
    alert("SYNC hatası: " + (e?.message || String(e)));
  } finally {
    setSyncingProducts(false);
  }
};


  // EASY modunda okunan karekodları tek tek işler
  const loadEasyItems = async (codes: string[]) => {
    setEasyResolving(true);
    try {
      setEasyCodes(codes);
      setEasyNote("");
      const results: StockScanLog[] = [];

      for (const raw of codes) {
        try {
          const log = await resolveStockItemByQR(raw);
          if (log) results.push(log);
        } catch (err) {
          console.warn("Easy stock resolve error", err);
        }
      }

      setEasyItems(results);
      setShowEasyPage(false);
      setShowEasyFinalPage(true);
    } finally {
      setEasyResolving(false);
    }
  };

  const appendEasyItems = async (codes: string[]) => {
    if (!codes.length) return;
    setEasyResolving(true);
    try {
      const results: StockScanLog[] = [];

      for (const raw of codes) {
        try {
          const log = await resolveStockItemByQR(raw);
          if (log) results.push(log);
        } catch (err) {
          console.warn("Easy stock resolve error (append)", err);
        }
      }

      setEasyItems((prev) => {
        const existingRaw = new Set(prev.map((p) => p.raw));
        const onlyNew = results.filter((r) => !existingRaw.has(r.raw));
        return [...prev, ...onlyNew];
      });

      setShowEasyPage(false);
      setShowEasyFinalPage(true);
    } finally {
      setEasyResolving(false);
    }
  };

  const handleEasyAddMore = async () => {
    if (!Capacitor.isNativePlatform()) {
      alert("Easy ekleme sadece gerçek cihazda yapılabilir.");
      return;
    }

    try {
      // @ts-ignore
      const res = await (FastStockScanner as any).startMultiScan({
        durationMs: 2500,
        skipNote: true,
      });

      const barcodes = ((res && (res as any).barcodes) || []) as string[];
      const values = Array.from(new Set(barcodes)).filter((c) => !!c);

      if (!values.length) {
        alert("Yeni okutulan karekod yok.");
        return;
      }

      await appendEasyItems(values);
    } catch (err: any) {
      alert(
        "Easy ekleme sırasında tarama hatası: " +
          (err?.message || String(err || ""))
      );
    }
  };

  const handleEasyDailyCsv = async (payload: {
    dateKey: string;
    label: string;
    ids: number[];
  }) => {
    alert(`Günlük CSV hazırlanıyor (${payload.label})...`);

    const extractGtinFromRawCode = (raw: string | undefined | null): string => {
      if (!raw) return "";
      const s = String(raw);

      const m = s.match(/01(\d{14})/);
      let gtin14: string | null = null;

      if (m) {
        gtin14 = m[1];
      } else {
        const digits = s.replace(/\D/g, "");
        if (digits.length >= 14) {
          gtin14 = digits.slice(0, 14);
        } else if (digits.length === 13) {
          return digits;
        } else {
          return "";
        }
      }

      if (!gtin14) return "";
      if (gtin14.length === 14 && gtin14.startsWith("0")) {
        return gtin14.slice(1);
      }
      return gtin14;
    };

    try {
      const gtinMap = new Map<string, { brand: string; count: number }>();

      for (const id of payload.ids) {
        // @ts-ignore
        const res = await (FastStockScanner as any).getEasySaleDetail({ id });
        const rawItems = Array.isArray(res.items) ? res.items : [];

        for (const it of rawItems as any[]) {
          const brand: string = (it.brand as string) || "";
          const rawCode: string =
            (it.gtin as string) || (it.barcode as string) || "";
          const gtin = extractGtinFromRawCode(rawCode);
          if (!gtin) continue;

          const prev = gtinMap.get(gtin) || { brand: "", count: 0 };
          const nextBrand = prev.brand || brand;
          gtinMap.set(gtin, { brand: nextBrand, count: prev.count + 1 });
        }
      }

      if (gtinMap.size === 0) {
        alert("Bu gün için GTIN / barkod bilgisi bulunamadı.");
        return;
      }

      const header = "Brand,GTIN,Count\n";
      const rows = Array.from(gtinMap.entries()).map(([gtin, info]) => {
        const cols = [info.brand, gtin, String(info.count)];
        return cols
          .map((s) => `"${csvSafe(s).replace(/"/g, '""')}"`)
          .join(",");
      });
      const csv = header + rows.join("\n");
      const filename = `easy-gtin-${payload.dateKey}.csv`;

      if (isNative()) {
        try {
          await Filesystem.mkdir({
            path: "Download",
            directory: Directory.Documents,
            recursive: true,
          });
        } catch {}

        const path = `Download/${filename}`;
        await Filesystem.writeFile({
          path,
          directory: Directory.Documents,
          data: "\uFEFF" + csv,
          encoding: Encoding.UTF8,
          recursive: true,
        });

        const { uri } = await Filesystem.getUri({
          path,
          directory: Directory.Documents,
        });

        try {
          await Share.share({
            title: filename,
            text: "Easy günlük GTIN özeti",
            url: uri,
          });
        } catch {}

        alert(`CSV kaydedildi:\nDocuments/${path}`);
      } else {
        const blob = new Blob(["\uFEFF", csv], {
          type: "text/csv;charset=utf-8;",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert("CSV indirildi.");
      }
    } catch (err: any) {
      alert(
        "Günlük CSV hazırlanırken hata: " + (err?.message || String(err || ""))
      );
    }
  };

  const handleEasySale = async (payload: {
    patient: string;
    citizenId: string;
    prescriptionNumber: string;
    note: string;
    items: (StockScanLog & { unitPrice?: string; partialAmount?: string })[];
  }) => {
    if (!Capacitor.isNativePlatform()) {
      alert("Easy satış kaydı sadece gerçek cihazda kaydedilir.");
      return;
    }

    try {
      const now = new Date().toISOString();

      const salePayload = {
        createdAt: now,
        patient: payload.patient,
        citizenId: payload.citizenId,
        prescriptionNumber: payload.prescriptionNumber,
        note: payload.note,
        items: payload.items.map((item) => ({
          barcode: item.raw,
          brand: item.brand,
          sn: item.sn || "",
          status: item.status,
          description: item.description || "",
          note: item.note || "",
          unitPrice: item.unitPrice ?? "",
          partialAmount: item.partialAmount ?? "",
        })),
      };

      // @ts-ignore
      await (FastStockScanner as any).saveEasySale(salePayload);

      const results = payload.items.map((item) => ({
        qrCode: item.raw,
        success: false,
        message:
          "Bu sürümde NDB satış bildirimi yapılmamaktadır (yalnızca cihaz içine kayıt yapılır).",
      }));

      alert("Satış kaydı cihaz içine kaydedildi.");
      return results;
    } catch (err: any) {
      alert(
        "Satış kaydı sırasında hata: " + (err?.message || String(err || ""))
      );
    }
  };

  /* ========= /admin rotasında erken dönüş ========= */
  if (isAdminRoute) {
    const [adminTab, setAdminTab] = React.useState<
      "trials" | "stakeholders" | "products"
    >("trials");

    const tabBtn: React.CSSProperties = {
      padding: "8px 12px",
      borderRadius: 10,
      border: "1px solid #e5e7eb",
      background: "#fff",
      fontWeight: 700,
      cursor: "pointer",
    };
    const tabBtnActive: React.CSSProperties = {
      ...tabBtn,
      background: "#111",
      color: "#fff",
      borderColor: "#111",
    };

    const AdminTrials = React.useMemo(
      () => React.lazy(() => import("./pages/AdminTrials")),
      []
    );
    const AdminStakeholdersLazy = React.useMemo(
      () => React.lazy(() => import("./pages/AdminStakeholders")),
      []
    );
    const AdminProducts = React.useMemo(
      () => React.lazy(() => import("./pages/AdminProducts")),
      []
    );

    return (
      <div
        style={{
          ...UI.page,
          ...(isWide
            ? { maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }
            : null),
        }}
      >
        <div style={UI.logoWrap}>
          <div style={UI.logoBadge}>DMS</div>
          <div style={UI.logoText}>Admin</div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button
            onClick={() => setAdminTab("trials")}
            style={adminTab === "trials" ? tabBtnActive : tabBtn}
          >
            Trial Yönetimi
          </button>
          <button
            onClick={() => setAdminTab("stakeholders")}
            style={adminTab === "stakeholders" ? tabBtnActive : tabBtn}
          >
            Stakeholders
          </button>
          <button
            onClick={() => setAdminTab("products")}
            style={adminTab === "products" ? tabBtnActive : tabBtn}
          >
            İlaç Listesi
          </button>
        </div>

        <AdminGate>
          <React.Suspense fallback={<div>Yükleniyor…</div>}>
            {adminTab === "trials" ? (
              <AdminTrials />
            ) : adminTab === "stakeholders" ? (
              <AdminStakeholdersLazy />
            ) : (
              <AdminProducts />
            )}
          </React.Suspense>
        </AdminGate>
      </div>
    );
  }

  // EASY geçmiş satış detayı (sadece görüntüleme)
  if (showEasyHistoryPage && easyHistorySale && !isAdminRoute) {
    const mappedItems: (StockScanLog & {
      unitPrice?: string;
      partialAmount?: string;
      ndbSuccess?: boolean | null;
      ndbMessage?: string | null;
    })[] = (easyHistorySale.items || []).map((it: any) => ({
      brand: it.brand ?? "",
      gtin: "",
      lot: "",
      sn: it.sn ?? "",
      raw: it.barcode ?? "",
      t: easyHistorySale.createdAt || new Date().toISOString(),
      status:
        it.status === "sellable" || it.status === "nonsellable"
          ? it.status
          : "error",
      title:
        it.status === "sellable"
          ? "Satılabilir"
          : it.status === "nonsellable"
          ? "Satılamaz"
          : "Durum bilinmiyor / sorgu hatası",
      description: it.description ?? "",
      note: it.note ?? "",
      unitPrice: it.unitPrice ?? "",
      partialAmount: it.partialAmount ?? "",
      ndbSuccess: typeof it.ndbSuccess === "boolean" ? it.ndbSuccess : null,
      ndbMessage: it.ndbMessage ?? null,
    }));

    return (
      <EasyFinalPage
        onBack={() => {
          setShowEasyHistoryPage(false);
          setEasyHistorySale(null);
        }}
        items={mappedItems}
        initialNote={easyHistorySale.note || ""}
        initialPatient={easyHistorySale.patient || ""}
        initialCitizenId={easyHistorySale.citizenId || ""}
        initialPrescriptionNumber={easyHistorySale.prescriptionNumber || ""}
        readOnly
      />
    );
  }

  if (showEasyFinalPage && !isAdminRoute) {
    return (
      <EasyFinalPage
        onBack={() => {
          setShowEasyFinalPage(false);
          setShowEasyPage(false);
        }}
        items={easyItems}
        initialNote={easyNote}
        onSale={handleEasySale}
        onChangeItems={setEasyItems}
        onAddMore={handleEasyAddMore}
      />
    );
  }

  if (showEasyPage && !isAdminRoute) {
    return (
      <EasyPage
        onBack={() => {
          setShowEasyPage(false);
        }}
        resolving={easyResolving}
        onDone={async (codes) => {
          await loadEasyItems(codes);
        }}
        onOpenHistorySale={(sale: any) => {
          setEasyHistorySale(sale);
          setShowEasyHistoryPage(true);
        }}
        onExportDailyCsv={handleEasyDailyCsv}
      />
    );
  }

  if (showFastPage && !isAdminRoute) {
    return <FastPage onBack={() => setShowFastPage(false)} />;
  }

  return (
    <div
      style={{
        ...UI.page,
        ...(isWide
          ? { maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }
          : null),
      }}
    >
      <div style={UI.logoWrap}>
        <div style={UI.logoBadge}>DMS</div>
        <div style={UI.logoText}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>
            DataMatrix Scanner{" "}
          </span>
          <span style={{ fontSize: 20, fontWeight: 800, opacity: 0.9 }}>
            {myStakeholderId ? "for" : "for Pharmacy"}
          </span>
        </div>
      </div>

      {myStakeholderId && (
        <div
          style={{
            marginTop: 6,
            marginBottom: 24,
            fontWeight: 900,
            fontSize: isWide ? 22 : 20,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#111827",
            textShadow: "0 1px 2px rgba(0,0,0,0.18)",
            textAlign: "center",
          }}
        >
          {myStakeholderId}
        </div>
      )}

      {/* HOME */}
      {tab === "home" && (
        <>
          <div
            style={{
              ...UI.grid4,
              gridTemplateColumns: isWide ? "1fr 1fr 1fr" : "1fr",
            }}
          >
            {/* FAST */}
            <button
              style={
                trialActive
                  ? TRIAL_BTN_GREEN
                  : { ...TRIAL_BTN_RED, opacity: 0.75 }
              }
              onClick={async () => {
                if (!(await ensureTrialOrAlert())) return;
                setShowFastPage(true);
              }}
            >
              FAST
            </button>

            {/* EASY */}
            <button
              style={
                trialActive
                  ? TRIAL_BTN_GREEN
                  : { ...TRIAL_BTN_RED, opacity: 0.75 }
              }
              onClick={async () => {
                if (!(await ensureTrialOrAlert())) return;
                setShowEasyPage(true);
              }}
            >
              EASY
            </button>

            {/* Settings */}
            <button style={ANON_BTN} onClick={() => setTab("settings")}>
              {t("buttons.settings")}
            </button>
          </div>
        </>
      )}

      {/* SETTINGS */}
      {tab === "settings" && (
        <Card title={t("settings.title")}>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Eczane Adı</div>
              <input
                value={myStakeholderId}
                onChange={(e) => setMyStakeholderId(e.target.value)}
                placeholder="Eczanenizin adını yazın"
                style={{ ...UI.input, width: "100%", maxWidth: 480 }}
              />
            </div>

            {/* Trial durumu + uzatma talebi */}
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>
  {myStakeholderId ? (
    trialActive ? (
      <>
        Deneme süresi aktif{" "}
        {trialExpiresMs ? (
          <span style={{ fontWeight: 800 }}>
            (Bitiş:{" "}
            {new Date(trialExpiresMs).toLocaleDateString("tr-TR", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            })}
            )
          </span>
        ) : null}
      </>
    ) : (
      "Deneme süresi bitmiş"
    )
  ) : (
    "Eczane adı girilmemiş"
  )}
</div>


              {!trialActive && myStakeholderId && (
                <div style={{ marginLeft: "auto" }}>
                  <button
                    onClick={async () => {
                      if (!ensureOnline()) return;

                      if (!myStakeholderId) {
                        alert("Önce Eczane adını yazın.");
                        setTab("settings");
                        return;
                      }

                      try {
                        const r = await trialExtendRequest(myStakeholderId);
                        if (r?.ok) {
                          alert(
                            "Talebiniz iletildi. Admin onayladığında süreniz güncellenecek."
                          );
                        } else {
                          alert(
                            "Talep gönderilemedi. Lütfen daha sonra tekrar deneyin."
                          );
                        }
                      } catch (e: any) {
                        alert(
                          "Talep gönderilemedi: " + (e?.message || String(e))
                        );
                      }
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      fontSize: 13,
                    }}
                  >
                    Deneme süremi arttır
                  </button>
                </div>
              )}
            </div>

            {deviceId && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 10,
                  textAlign: "center",
                  color: "#9ca3af",
                  letterSpacing: 0.5,
                }}
              >
                {deviceId}
              </div>
            )}

            {/* Kaydet */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={saveSettings}
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #111",
                  background: "#111",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                Kaydet
              </button>
              
              <button
                onClick={() => setTab("home")}
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                }}
              >
                Geri
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
  <button
    onClick={syncFastProductsFromServer}
    disabled={syncingProducts}
    style={{
      width: "100%",
      padding: "14px 14px",
      borderRadius: 12,
      border: "1px solid #0f766e",
      background: syncingProducts ? "#94a3b8" : "#0f766e",
      color: "#fff",
      fontWeight: 800,
    }}
  >
    {syncingProducts ? "SYNC yapılıyor..." : "SYNC (FAST Ürün Kataloğu)"}
  </button>
</div>

          </div>
        </Card>
      )}
    </div>
  );
}
