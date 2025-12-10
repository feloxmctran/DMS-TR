// App.tsx — DataMatrix Scanner (admin ayrıldı, anahtar/gizleme alanları kaldırıldı)
// Not: Admin sayfası artık ./pages/AdminStakeholders içinde, yalnız web'de erişilir.

import React, { useEffect, useRef, useState } from "react";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import { Preferences } from "@capacitor/preferences";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  TOKEN_URL,
  INQUIRY_URL,
  DEFAULT_SCOPE,
  DEFAULT_GRANT,
} from "./config";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import "./i18n";
import { useTranslation } from "react-i18next";
import AdminStakeholders from "./pages/AdminStakeholders";
import AdminGate from "./pages/AdminGate";
import FastPage from "./pages/FastPage";
import EasyPage from "./pages/EasyPage";
import EasyFinalPage from "./pages/EasyFinalPage";
import { FastStockScanner } from "./plugins/fastStockScanner";

import type { ProductRow } from "./plugins/fastStockScanner";


/* ============== SABİTLER ============== */
const K = {
  // NDB QR sorgu
  username: "ndb_username",
  password: "ndb_password",
  scope: "ndb_scope",
  grant: "ndb_grant",
  tokenUrl: "ndb_token_url",
  apiUrl: "ndb_api_url",
  clientId: "ndb_client_id",
  clientSecret: "ndb_client_secret",
  testMode: "ndb_test_mode",

  // Seçilen stakeholder + partner
  stakeholderId: "ndb_my_stakeholder_id",
  stakeholderPartnerId: "ndb_my_stakeholder_partner_id",

  // Trial (deneme) bitiş zamanı
  trialExpiry: "ndb_trial_expiry_ms",
};

const DEFAULTS = {
  tokenUrl: TOKEN_URL,
  apiUrl: INQUIRY_URL,
  scope: DEFAULT_SCOPE,
  grant: DEFAULT_GRANT as "password" | "client_credentials",
};

const TEST_ENDPOINTS = {
  tokenUrl: "https://testndbapi.med.kg/connect/token",
  apiUrl: "https://testndbapi.med.kg/api/TrackAndTrace/ProductInquiryQRCode",
};

const isNative = () => Capacitor.isNativePlatform();

/* ============== Tipler ============== */
type InquiryResponse = {
  resultCode?: number;
  resultMessage?: string;
  actionResult?: {
    productName?: string;
    gtin?: string;
    serialNumber?: string;
    batchNumber?: string;
    productionDate?: string;
    expirationDate?: string;
    stakeHolderName?: string;
    isAvailableForSale?: boolean;
    isSuspendedOrRecalled?: boolean;
    manufacturerName?: string;
    certificateNumber?: string;
    overallRetailPrice?: string;
    // ek alanlar
    isExpired?: boolean;
    productStatus?: string | number;
    productState?: string | number;
    suspendRecallInfo?: string;
    isFomsDrug?: boolean;
    productInquiryHistory?: Array<{
      declarationNumber?: number;
      stakeHolder?: string;
      state?: number;
      stateDate?: string;
      price?: number;
    }>;
  };
  ___raw?: string;
};

type ReceiveDeclDetail = {
  productBoxId?: number;
  drugPackageItemId?: string;
  fullBrandName?: string;
  qrCode?: string;
  gtin?: string;
  batchNumber?: string;
  expirationDate?: string;
  serialNumber?: string;
  price?: number;
};

type ReceiveDeclResponse = {
  resultCode?: number;
  resultMessage?: string;
  actionResult?: {
    declarationId?: number;
    documentNo?: string;
    documentDate?: string;
    fromStakeholder?: number;
    toStakeholder?: number;
    declarationDate?: string;
    description?: string;
    currentState?: number;
    isReturn?: boolean;
    details?: ReceiveDeclDetail[];
  };
};

type TransferAcceptResponse = {
  resultCode?: number;
  resultMessage?: string;
  actionResult?: {
    declarationId?: number;
    declarationDate?: string;
  };
};



type StockItem = {
  brand: string;
  gtin: string;
  lot: string;
  sn?: string;
  raw?: string;
  t?: string;
};

type StockGroup = { brand: string; gtin: string; lot: string; count: number };
export type StockScanLog = {
  brand: string;
  gtin: string;
  lot: string;
  sn?: string;
  raw: string;
  t: string;
  status: "sellable" | "nonsellable" | "error";
  title?: string;
  description?: string;
  note?: string;

  // EASY için ek alanlar
  unitPrice?: string;
  partialAmount?: string;
};




type StakeholderItem = { id: string; name?: string } & Record<string, any>;

/* ============== yardımcılar ============== */
const prefGet = async (key: string) => (await Preferences.get({ key })).value || "";
const prefSet = async (key: string, value?: string) => Preferences.set({ key, value: value ?? "" });

function formatISO(dt?: string | null) {
  if (!dt) return "—";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return String(dt);
  const dd = String(d.getDate()).padStart(2, "0");
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const HH = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${MM}-${yyyy} ${HH}.${mm}`;
}
function formatTRDate(input: string | number | Date) {
  const d = new Date(input);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
function formatTRDateTime(input: string | number | Date) {
  const d = new Date(input);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${hh}.${mi}`;
}
function formatISODateOnly(dt?: string | null) {
  if (!dt) return "—";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return String(dt);
  const dd = String(d.getDate()).padStart(2, "0");
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${MM}-${yyyy}`;
}
function norm(txt: any) {
  const s = String(txt ?? "");
  return s
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
function csvSafe(v: any) {
  const s = String(v ?? "");
  return s.replace(/\r?\n/g, " ").replace(/[\u2013\u2014]/g, "-");
}




function mapProductState(value: any): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value != null ? String(value) : "";
  switch (n) {
    case 1:  return "Production";
    case 2:  return "Import";
    case 3:  return "Sales";
    case 4:  return "Deactivation";
    case 5:  return "Export";
    case 6:  return "SalesReturn";
    case 7:  return "PurchaseConfirmation";
    case 8:  return "SalesCancel";
    case 9:  return "TransferInitiated";
    case 10: return "TransferAccepted";
    case 11: return "TransferCancelled";
    case 12: return "PartialSales";
    case 13: return "Stock";
    case 14: return "ReturnTransferInitiated";
    case 15: return "ReturnTransferAccepted";
    case 16: return "ReturnTransferCancelled";
    case 17: return "PartialSalesCancel";
    default:
      return String(value ?? "");
  }
}

// productInquiryHistory içinden en büyük declarationNumber'ı bulur
function getLatestDeclarationNumberFromHistory(
  history: Array<{ declarationNumber?: number | string | null }> | undefined
): number | null {
  if (!history || !history.length) return null;

  let max: number | null = null;
  for (const h of history) {
    const n = Number(h?.declarationNumber);
    if (Number.isFinite(n)) {
      max = max === null ? n : Math.max(max, n);
    }
  }
  return max;
}


type ProductStateSaleInfo = {
  isSellable: boolean;
  title: string;
  description: string;
};

function getProductStateSaleInfo(value: any): ProductStateSaleInfo | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  switch (n) {
    case 1:
      return {
        isSellable: false,
        title: "Satılamaz",
        description: "Bu ürün üretim aşamasındadır.",
      };
    case 2:
      return {
        isSellable: false,
        title: "Satılamaz",
        description:
          "Bu ürün ithalatı gerçekleşmiş ancak henüz eczaneye dağıtımı yapılmamıştır.",
      };
    case 3:
      return {
        isSellable: false,
        title: "Satılamaz",
        description: "Bu ürün daha önce satılmıştır.",
      };
    case 4:
      return {
        isSellable: false,
        title: "Satılamaz",
        description:
          "Bu ürün için satılamaz olarak bildirim yapılmıştır.",
      };
    case 5:
      return {
        isSellable: false,
        title: "Satılamaz",
        description: "Bu ürün ihracat bildirimi yapılmıştır.",
      };
    case 6:
      return {
        isSellable: true,
        title: "Satılabilir",
        description:
          "Bu ürün daha önce satılmış ancak iade edilmiştir.",
      };
    case 7:
      return {
        isSellable: true,
        title: "Satılabilir",
        description: "PurchaseConfirmation.",
      };
    case 8:
      return {
        isSellable: true,
        title: "Satılabilir",
        description:
          "Bu ürün daha önce satılmış ancak satış iptal edilmiştir.",
      };
    case 9:
      return {
        isSellable: false,
        title: "Satılamaz",
        description:
          "Bu ürün bir depodan bir eczaneye gönderilmiştir. Eczanenin kabul yapması gerekir.",
      };
    case 10:
      return {
        isSellable: true,
        title: "Satılabilir",
        description:
          "Bu ürün eczane tarafından kabul edilmiş ve stoklara işlenmiştir.",
      };
    case 11:
      return {
        isSellable: false,
        title: "Satılamaz",
        description:
          "Bu ürün bir depodan bir eczaneye gönderme işlemi iptal edilmiştir.",
      };
    case 12:
      return {
        isSellable: true,
        title: "Satılabilir",
        description:
          "Bu ürünün paketinin bir kısmı daha önce satılmıştır.",
      };
    case 13:
      return {
        isSellable: false,
        title: "Satılamaz",
        description: "Bu ürün stokta kayıtlıdır.",
      };
    case 14:
      return {
        isSellable: false,
        title: "Satılamaz",
        description:
          "Bu ürün eczane tarafından kabul edilmiş ancak sonra iade edilmiştir.",
      };
    case 15:
      return {
        isSellable: false,
        title: "Satılamaz",
        description:
          "Bu ürün eczane tarafından depoya iade edilmiş ve depo iadeyi kabul etmiştir.",
      };
    case 16:
      return {
        isSellable: true,
        title: "Satılabilir",
        description:
          "Bu ürün eczane tarafından depoya iade edilmiş ancak iade işlemi iptal edilmiştir.",
      };
    case 17:
      return {
        isSellable: true,
        title: "Satılabilir",
        description:
          "Bu ürünün paketinin bir kısmı daha önce satılmıştır ancak sonra satış iptal edilmiştir.",
      };
    default:
      return null;
  }
}

type StockSaleInfo = {
  status: "sellable" | "nonsellable" | "error";
  title: string;
  description: string;
};

function buildStockSaleInfo(ar: any): StockSaleInfo {
  try {
    if (!ar || typeof ar !== "object") {
      return {
        status: "error",
        title: "Durum bilinmiyor",
        description: "Ürün bilgisi alınamadı.",
      };
    }

    // Suspend/Recall bayrağı
    const suspendedFlag = !!(
      ar.isSuspendedOrRecalled ??
      ar.IsSuspendedOrRecalled ??
      false
    );

    // Expired bayrağı
    const isExpiredFlag = !!(
      ar.isExpired ??
      ar.IsExpired ??
      false
    );

    // Son kullanma tarihi (yaklaşan SKT için)
    const expRaw =
      ar.expirationDate ??
      ar.ExpirationDate ??
      null;

    let daysLeft: number | null = null;
    if (!isExpiredFlag && expRaw) {
      const now = new Date();
      const exp = new Date(expRaw);
      if (!isNaN(exp.getTime())) {
        const diffMs = exp.getTime() - now.getTime();
        daysLeft = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      }
    }

    // 1) Askıya alınmış / geri çağrılmış → her zaman SATILAMAZ
    if (suspendedFlag) {
      const sri = ar.suspendRecallInfo ?? ar.SuspendRecallInfo ?? null;

      let reasonText = "";
      let start: string | null = null;
      let end: string | null = null;

      if (sri && typeof sri === "object") {
        reasonText =
          String(
            sri.reason ??
              sri.Reason ??
              sri.description ??
              sri.Description ??
              ""
          ).trim() || "";
        start =
          (sri.startDate ??
            sri.StartDate ??
            sri.start ??
            sri.Start) || null;
        end =
          (sri.endDate ??
            sri.EndDate ??
            sri.end ??
            sri.End) || null;
      } else if (sri != null) {
        reasonText = String(sri);
      }

      const lines: string[] = [];
      lines.push(
        "Bu ürünün satışları askıya alınmıştır veya geri çağrılmıştır."
      );
      if (reasonText) {
        lines.push(`Neden: ${reasonText}`);
      }

      let dateLine = "";
      if (start && end) {
        dateLine = `Geçerlilik: ${formatISODateOnly(
          start
        )} - ${formatISODateOnly(end)}`;
      } else if (start && !end) {
        dateLine = `Başlangıç: ${formatISODateOnly(start)}`;
      } else if (!start && end) {
        dateLine = `Bitiş: ${formatISODateOnly(end)}`;
      }
      if (dateLine) lines.push(dateLine);

      return {
        status: "nonsellable",
        title: "SATILAMAZ",
        description: lines.join("\n"),
      };
    }

    // 2) Süresi dolmuş → her zaman SATILAMAZ
    if (isExpiredFlag) {
      return {
        status: "nonsellable",
        title: "SATILAMAZ",
        description: "Bu ürünün son kullanım tarihi dolmuştur.",
      };
    }

    // 3) Askıda değil ve süresi dolmamış → ProductState tablosuna göre
    const rawState =
      ar.productState ??
      ar.ProductState ??
      null;

    const info = getProductStateSaleInfo(rawState);
    if (!info) {
      return {
        status: "error",
        title: "Durum bilinmiyor",
        description: "Ürünün ProductState bilgisi anlaşılamadı.",
      };
    }

    let title = info.title;
    let description = info.description;

    // Son kullanma tarihine az kalmışsa ekstra not ekle (aynı mantık)
    if (info.isSellable && daysLeft != null && daysLeft >= 0 && daysLeft < 60) {
      const extra = `Bu ürünün son kullanma tarihine ${daysLeft} gün kalmıştır.`;
      description = `${info.description}\n${extra}`;
      title = "Satılabilir";
    }

    return {
      status: info.isSellable ? "sellable" : "nonsellable",
      title,
      description,
    };
  } catch {
    return {
      status: "error",
      title: "Durum bilinmiyor",
      description: "Satılabilirlik hesaplanamadı.",
    };
  }
}


/** Cihaz kimliği */
async function getDeviceId(): Promise<string> {
  const KEY = "device_id";
  const cur = await prefGet(KEY);
  if (cur) return cur;
  const uuid = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)) + Date.now();
  await prefSet(KEY, uuid);
  return uuid;
}

/** Trial API tabanı — dev’de same-origin (''), prod’da kendi domain’in olabilir */
/** Trial API tabanı — web’de localhost, native’de PC’nin IP’si */
const TRIAL_API_BASE = isNative()
  ? "http://200.0.0.137:4000" // ← BURAYA PC’NİN YEREL IP ADRESİNİ YAZ
  : "http://localhost:4000";
  // FAST ürün kataloğu için Preferences anahtarları
const FAST_PRODUCTS_INITIALIZED_KEY = "fast_products_initialized";
const FAST_PRODUCTS_LAST_CHANGE_ID_KEY = "fast_products_last_change_id";

async function ensureFastProductsInitialized() {
  try {
    // Sadece native’de (Android/iOS) çalıştıralım
    if (!isNative()) return;

    // Daha önce initial import yapıldı mı?
    const { value } = await Preferences.get({
      key: FAST_PRODUCTS_INITIALIZED_KEY,
    });
    if (value === "1") {
      // Zaten import edilmiş
      return;
    }

    // APK içindeki public/initial_products.json dosyasını oku
    const res = await fetch("/initial_products.json");
    if (!res.ok) {
      console.error("initial_products.json okunamadı:", res.status);
      return;
    }

    const data = await res.json();
    const items = (data.items || []) as ProductRow[];

    if (!items.length) {
      console.warn("initial_products.json içinde ürün bulunamadı.");
      return;
    }

    // Native plugin'e gönder ve SQLite'a yazdır
    const result = await FastStockScanner.importInitialProducts({ items });

    console.log(
      "FAST initial products import tamamlandı. Kayıt sayısı:",
      result?.count ?? items.length
    );

    // server’dan gelecek senaryoya hazırlık: lastChangeId varsa kaydet
    if (typeof (data as any).lastChangeId === "number") {
      await Preferences.set({
        key: FAST_PRODUCTS_LAST_CHANGE_ID_KEY,
        value: String((data as any).lastChangeId),
      });
    }

    // Artık initial import tamamlandı
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
    return typeof r.data === "string" ? JSON.parse(r.data || "{}") : (r.data || {});
  } else {
    const r = await fetch(url, { headers });
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  }
}
async function httpPost(url: string, data: any, headers: Record<string, string> = {}) {
  if (isNative()) {
    const r = await CapacitorHttp.post({
      url,
      data,
      headers: { "Content-Type": "application/json", ...headers },
    });
    return typeof r.data === "string" ? JSON.parse(r.data || "{}") : (r.data || {});
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
  return httpPost(`${TRIAL_API_BASE}/api/trial/register`, { stakeholderId, partnerId, deviceId });
}
async function trialStatus(stakeholderId: string) {
  const deviceId = await getDeviceId();
  const q = new URLSearchParams({ stakeholderId, deviceId }).toString();
  return httpGet(`${TRIAL_API_BASE}/api/trial/status?${q}`);
}
async function trialExtendRequest(stakeholderId: string) {
  const deviceId = await getDeviceId();
  return httpPost(`${TRIAL_API_BASE}/api/trial/extend-request`, { stakeholderId, deviceId });
}

/** Stok gruplama */
function groupStock(items: StockItem[]): StockGroup[] {
  const map = new Map<string, StockGroup>();
  for (const it of items) {
    const key = `${it.brand}|${it.gtin}|${it.lot}`;
    const g = map.get(key);
    if (g) g.count += 1;
    else map.set(key, { brand: it.brand ?? "", gtin: it.gtin ?? "", lot: it.lot ?? "", count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/** CSV */
function makeCSV(groups: StockGroup[]) {
  const header = "Brand,GTIN,LOT,Count\n";
  const rows = groups.map((g) =>
    [g.brand, g.gtin, g.lot, g.count].map((s) => `"${csvSafe(s).replace(/"/g, '""')}"`).join(",")
  );
  return header + rows.join("\n");
}
function downloadCSV(filename: string, groups: StockGroup[]) {
  const csv = makeCSV(groups);
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
async function saveCSVNative(filename: string, groups: StockGroup[], doShare = false) {
  const csv = makeCSV(groups);
  try {
    await Filesystem.mkdir({ path: "Download", directory: Directory.Documents, recursive: true });
  } catch {}
  const path = `Download/${filename}`;
  await Filesystem.writeFile({
    path,
    directory: Directory.Documents,
    data: "\uFEFF" + csv,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Documents });
  if (doShare) {
    try {
      await Share.share({ title: filename, text: "Stok sayım CSV", url: uri });
    } catch {}
  }
  return { path, uri };
}

const STOCK_HISTORY_KEY = "stock_sessions";
async function saveStockSession(groups: StockGroup[], total: number) {
  const now = new Date();
  const stamp = now.toISOString();
  const title = `stok-sayim-${formatTRDateTime(now).replaceAll(" ", "_").replaceAll(".", "-")}.csv`;
  const item = { id: stamp, createdAt: stamp, total, groups, title };
  let arr: any[] = [];
  try {
    arr = JSON.parse((await Preferences.get({ key: STOCK_HISTORY_KEY })).value || "[]");
  } catch {}
  arr.unshift(item);
  await Preferences.set({ key: STOCK_HISTORY_KEY, value: JSON.stringify(arr.slice(0, 50)) });
  return item;
}

/* ============== TOKEN & API (NDB QR) ============== */
async function obtainToken(cfg: {
  grant: "password" | "client_credentials";
  tokenUrl: string;
  username: string;
  password: string;
  clientId?: string;
  clientSecret?: string;
  scope: string;
}): Promise<string> {
  const body = new URLSearchParams();
  if (cfg.grant === "client_credentials") {
    body.set("grant_type", "client_credentials");
    if (cfg.clientId) body.set("client_id", cfg.clientId);
    if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
    if (cfg.scope) body.set("scope", cfg.scope);
  } else {
    body.set("grant_type", "password");
    body.set("username", (cfg.username || "").trim());
    body.set("password", (cfg.password || "").trim());
    if (cfg.scope) body.set("scope", cfg.scope);
  }

  if (isNative()) {
    const res = await CapacitorHttp.post({
      url: cfg.tokenUrl,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: body.toString(),
    });
    let token: string | undefined;
    try {
      token =
        typeof res.data === "string"
          ? JSON.parse(res.data).access_token
          : (res.data || {})?.access_token;
    } catch {}
    if (!token) throw new Error(`Token alınamadı (native) [HTTP ${res.status}]`);
    return token;
  } else {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Token alınamadı (${res.status}) → ${text}`);
    const data = text ? JSON.parse(text) : {};
    const token = data?.access_token;
    if (!token) throw new Error("Yanıtta access_token yok.");
    return token;
  }
}

async function postInquiryQRCodeAuth(
  apiUrl: string,
  token: string,
  payload: { qrCode: string },
  opts?: { timeoutMs?: number }
) {
  if (isNative()) {
    const res = await CapacitorHttp.post({
      url: apiUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/plain",
        "Content-Type": "application/json-patch+json",
      },
      data: payload,
      connectTimeout: opts?.timeoutMs ?? 25000,
    });
    let json: any = res.data;
    if (typeof json === "string") {
      try {
        json = JSON.parse(json);
      } catch {
        json = null;
      }
    }
    (json ??= {}).___raw = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return json as InquiryResponse;
  } else {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 25000);
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/plain",
        "Content-Type": "application/json-patch+json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
    const raw = await res.text();
    if (!res.ok) throw new Error(`Sorgu hatası (${res.status}) → ${raw}`);
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      const s = raw.indexOf("{"),
        e = raw.lastIndexOf("}");
      if (s >= 0 && e > s) {
        try {
          json = JSON.parse(raw.slice(s, e + 1));
        } catch {}
      }
    }
    (json ??= {}).___raw = raw;
    return json as InquiryResponse;
  }
}

async function postInquiryQRCodeAnon(
  apiUrl: string,
  payload: { qrCode: string },
  opts?: { timeoutMs?: number }
) {
  if (isNative()) {
    const res = await CapacitorHttp.post({
      url: apiUrl,
      headers: { Accept: "text/plain", "Content-Type": "application/json-patch+json" },
      data: payload,
      connectTimeout: opts?.timeoutMs ?? 25000,
    });
    let json: any = res.data;
    if (typeof json === "string") {
      try {
        json = JSON.parse(json);
      } catch {
        json = null;
      }
    }
    (json ??= {}).___raw = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return json as InquiryResponse;
  } else {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 25000);
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Accept: "text/plain", "Content-Type": "application/json-patch+json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
    const raw = await res.text();
    if (!res.ok) throw new Error(`Anon sorgu hatası (${res.status}) → ${raw}`);
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      const s = raw.indexOf("{"),
        e = raw.lastIndexOf("}");
      if (s >= 0 && e > s) {
        try {
          json = JSON.parse(raw.slice(s, e + 1));
        } catch {}
      }
    }
    (json ??= {}).___raw = raw;
    return json as InquiryResponse;
  }
}

function buildGtinSnUrl(apiUrl: string): string {
  if (!apiUrl) return "";
  if (/ProductInquiryQRCode/i.test(apiUrl)) {
    return apiUrl.replace(/ProductInquiryQRCode/gi, "ProductInquiryGtinSn");
  }
  // Son çare: path’in sonuna ekle
  return apiUrl.replace(/\/?$/, "") + "/ProductInquiryGtinSn";
}

async function postInquiryGtinSnAnon(
  apiUrl: string,
  payload: { gtin: string; serialNumber: string },
  opts?: { timeoutMs?: number }
) {
  const url = buildGtinSnUrl(apiUrl);

  if (isNative()) {
    const res = await CapacitorHttp.post({
      url,
      headers: { Accept: "text/plain", "Content-Type": "application/json-patch+json" },
      data: payload,
      connectTimeout: opts?.timeoutMs ?? 25000,
    });
    let json: any = res.data;
    if (typeof json === "string") {
      try {
        json = JSON.parse(json);
      } catch {
        json = null;
      }
    }
    (json ??= {}).___raw =
      typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return json as InquiryResponse;
  } else {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 25000);
    const res = await fetch(url, {
      method: "POST",
      headers: { Accept: "text/plain", "Content-Type": "application/json-patch+json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));

    const raw = await res.text();
    if (!res.ok)
      throw new Error(`Anon GTIN+SN sorgu hatası (${res.status}) → ${raw}`);

    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      const s = raw.indexOf("{"),
        e = raw.lastIndexOf("}");
      if (s >= 0 && e > s) {
        try {
          json = JSON.parse(raw.slice(s, e + 1));
        } catch {}
      }
    }
    (json ??= {}).___raw = raw;
    return json as InquiryResponse;
  }
}


/* ============== RECEIVE • GetTransferDeclaration ============== */
async function fetchGetTransferDeclaration(opts: {
  baseTest: boolean;
  token: string;
  declarationId: number;
}): Promise<ReceiveDeclResponse> {
  const url = `https://${opts.baseTest ? "testndbapi" : "ndbapi"}.med.kg/api/TrackAndTrace/GetTransferDeclaration?declarationId=${encodeURIComponent(
    String(opts.declarationId)
  )}`;
  if (isNative()) {
    const res = await CapacitorHttp.get({
      url,
      headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json, text/plain, */*" },
    });
    let data: any = res.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        data = null;
      }
    }
    return (data ?? {}) as ReceiveDeclResponse;
  } else {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json, text/plain, */*" },
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) throw new Error(`GetTransferDeclaration hata (${res.status}) → ${text}`);
    return (json ?? {}) as ReceiveDeclResponse;
  }
}

async function postTransferAccept(opts: {
  baseTest: boolean;
  token: string;
  declarationId: number;
}): Promise<TransferAcceptResponse> {
  const url = `https://${opts.baseTest ? "testndbapi" : "ndbapi"}.med.kg/api/TrackAndTrace/TransferAccept`;
  const payload = { declarationId: opts.declarationId };

  if (isNative()) {
    const res = await CapacitorHttp.post({
      url,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
      },
      data: payload,
    });
    let data: any = res.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        data = null;
      }
    }
    return (data ?? {}) as TransferAcceptResponse;
  } else {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      throw new Error(`TransferAccept hata (${res.status}) → ${text}`);
    }
    return (json ?? {}) as TransferAcceptResponse;
  }
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
  textarea: React.CSSProperties;
} = {
  page: {
    padding: "16px 12px",
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
    gap: 20,               // butonlar arası daha ferah
    marginTop: 16,
    width: "100%",
    boxSizing: "border-box",
  },


      bigBtn: {
    padding: "18px 26px",              // 14x20 → 18x26 (oran korunup büyüdü)
    borderRadius: 18,
    border: "none",
    boxShadow: "0 4px 10px rgba(0,0,0,0.18)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    fontWeight: 700,
    fontSize: 17,
    maxWidth: 260,                     // 200 → 260, ekranda daha dolu
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
  textarea: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid #d1d5db",
    background: "#f8fafc",
    color: "#111",
    boxSizing: "border-box",
    outline: "none",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
};

const ANON_BTN: React.CSSProperties = {
  ...UI.bigBtn,
  background: "linear-gradient(180deg, #7cc464, #4c9c32)", // üstten alta yeşil
  color: "#ffffff",
};

const TRIAL_BTN_BASE: React.CSSProperties = {
  ...UI.bigBtn,
};

const TRIAL_BTN_GREEN: React.CSSProperties = {
  ...TRIAL_BTN_BASE,
  background: "linear-gradient(180deg, #7cc464, #4c9c32)", // trial aktifken istersen yeşil
  color: "#ffffff",
};

const TRIAL_BTN_RED: React.CSSProperties = {
  ...TRIAL_BTN_BASE,
  background: "linear-gradient(180deg, #ffb347, #f97316)", // turuncu ton
  color: "#ffffff",
};





const Field = ({ label, value }: { label: string; value?: string | number | boolean | null }) => (
  <div style={{ display: "grid", gridTemplateColumns: "minmax(92px, 38%) 1fr", gap: 6 }}>
    <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
    <div
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 14,
        lineHeight: 1.4,
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
      }}
    >

      {value === undefined || value === null || value === "" ? (
        <span style={{ opacity: 0.5 }}>—</span>
      ) : (
        String(value)
      )}
    </div>
  </div>
);

const Card: React.FC<React.PropsWithChildren<{ title?: string }>> = ({ title, children }) => (
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
  const { t, i18n } = useTranslation();
  const [lang, setLang] = useState<"en" | "ru">("en");

    const [tab, setTab] = useState<
    "home" | "manual" | "result" | "settings" | "receive" | "stock"
  >("home");


  const isBrowser = typeof window !== "undefined";
  const [isWide, setIsWide] = useState<boolean>(
    !isNative() && isBrowser && window.innerWidth >= 1024
  );
  useEffect(() => {
    if (!isBrowser || isNative()) return;
    const onResize = () => setIsWide(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Login (password grant)
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [apiUrl, setApiUrl] = useState(DEFAULTS.apiUrl);
  const [tokenUrl, setTokenUrl] = useState(DEFAULTS.tokenUrl);
  const [scope, setScope] = useState(DEFAULTS.scope);
  const [grant, setGrant] = useState<"password" | "client_credentials">(DEFAULTS.grant);
  const [testMode, setTestMode] = useState(true);

  // Stakeholder + partner
  const [myStakeholderId, setMyStakeholderId] = useState<string>("");
  const [myStakeholderPartnerId, setMyStakeholderPartnerId] = useState<string>("");
  
    const [deviceId, setDeviceId] = useState<string | null>(null);


  // Trial state
  const [trialExpiresMs, setTrialExpiresMs] = useState<number | null>(null);
  const trialActive = trialExpiresMs != null ? Date.now() <= trialExpiresMs : false;

  // Stakeholder list (typeahead)
  const [stakeholders, setStakeholders] = useState<StakeholderItem[]>([]);
  const [stkQuery, setStkQuery] = useState("");
  const [stkOpen, setStkOpen] = useState(false);

    const selectedStakeholderName = React.useMemo(() => {
    if (!myStakeholderId) return "";

    // myStakeholderId ile stakeholders.id’yi sadece rakamlarıyla karşılaştır
    const myDigits = String(myStakeholderId).replace(/\D+/g, "");

    const m = stakeholders.find((s) => {
      const sidDigits = String(s.id ?? "").replace(/\D+/g, "");
      return sidDigits === myDigits;
    });

    // Listede eşleşen kayıt yoksa, üstte hiçbir şey göstermeyelim
    if (!m) return "";

    const name = m.name ? String(m.name) : String(m.id ?? "");
    return name;
  }, [myStakeholderId, stakeholders]);

  const stakeholderNameById = (id: any): string => {
    if (id == null) return "";
    const sid = String(id).replace(/\D+/g, "");
    const m = stakeholders.find((s) => String(s.id) === sid);
    return m?.name ? String(m.name) : String(id);
  };


  // Sorgu
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [ndbResult, setNdbResult] = useState<InquiryResponse | null>(null);
  const [anonLoading, setAnonLoading] = useState(false);
    // ProductState = 9 için ekstra mesaj (Satılabilir/Satılamaz paneli override)
  const [productState9Message, setProductState9Message] = useState<string | null>(null);
  const [productState9Loading, setProductState9Loading] = useState(false);


  // Manual
  const [manual, setManual] = useState("");
    const [manualGtin, setManualGtin] = useState("");
  const [manualSn, setManualSn] = useState("");


  // RECEIVE
  // RECEIVE
  const [receiveQr, setReceiveQr] = useState<string>("");
  const [receiveLoading, setReceiveLoading] = useState(false);
  const [receiveError, setReceiveError] = useState<string>("");
  const [receiveInfo, setReceiveInfo] = useState<string>(""); // 🔹 EKLE
  const [receiveData, setReceiveData] = useState<ReceiveDeclResponse | null>(null);
  const [receiveGroups, setReceiveGroups] = useState<
    Array<{ brand: string; gtin: string; lot: string; count: number }>
  >([]);
    const [receiveDbg, setReceiveDbg] = useState<{

    declId?: number | null;
    toStake?: number | null;
    myStk?: number | null;
    myPartner?: number | null;
  } | null>(null);



  const [receiveAcceptLoading, setReceiveAcceptLoading] = useState(false);
  const [receiveAcceptMessage, setReceiveAcceptMessage] = useState<string | null>(null);
  const [receiveAcceptError, setReceiveAcceptError] = useState<string | null>(null);

    const [receiveAccepted, setReceiveAccepted] = useState(false);


  // STOCK
    const [stockActive, _setStockActive] = useState(false);
  const stockActiveRef = useRef(false);
  const setStockActive = (v: boolean) => {
    stockActiveRef.current = v;
    _setStockActive(v);
  };
  const stockTokenRef = useRef<Promise<string> | null>(null);
  const scannedQRCodesRef = useRef<Set<string>>(new Set());  // 👈 YENİ
  const [stockBusy, setStockBusy] = useState(false);
  const [stockPaused, setStockPaused] = useState(false);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockLog, setStockLog] = useState<StockScanLog[]>([]);

  const [stockError, setStockError] = useState("");
  const [stockSummary, setStockSummary] = useState<StockGroup[]>([]);
  const [, setStockLast] = useState<StockItem | null>(null);
  const [] = useState("");

     // FAST sayfası (ayrı ekranda)
  const [showFastPage, setShowFastPage] = useState(false);

  // EASY (reçete satış) sayfaları
  const [showEasyPage, setShowEasyPage] = useState(false);
  const [showEasyFinalPage, setShowEasyFinalPage] = useState(false);
  const [, setEasyCodes] = useState<string[]>([]);

  const [easyNote, setEasyNote] = useState("");
  const [easyItems, setEasyItems] = useState<StockScanLog[]>([]);
    const [easyResolving, setEasyResolving] = useState(false);

      // EASY geçmiş satış detayı için:
  const [easyHistorySale, setEasyHistorySale] = useState<any | null>(null);
  const [showEasyHistoryPage, setShowEasyHistoryPage] = useState(false);



  

  // Ayarları yükle



  // Ayarları yükle
  useEffect(() => {
    (async () => {
      setUsername((await prefGet(K.username)) || "");
      setPassword((await prefGet(K.password)) || "");
      setMyStakeholderId((await prefGet(K.stakeholderId)) || "");
      setMyStakeholderPartnerId((await prefGet(K.stakeholderPartnerId)) || "");
            const id = await getDeviceId();
      setDeviceId(id);


      // Trial status (persisted)
      const savedTrial = Number((await prefGet(K.trialExpiry)) || "0");
      setTrialExpiresMs(Number.isFinite(savedTrial) && savedTrial > 0 ? savedTrial : null);

      const savedLang = (await Preferences.get({ key: "app_lang" })).value as
        | "en"
        | "ru"
        | null;
      const initial = savedLang === "ru" ? "ru" : "en";
      setLang(initial);
      i18n.changeLanguage(initial);

      const savedTestRaw = await prefGet(K.testMode);
      const defaultTest = savedTestRaw ? savedTestRaw === "1" : true;
      setTestMode(defaultTest);
      if (!savedTestRaw) await prefSet(K.testMode, "1");

      let storedApi = (await prefGet(K.apiUrl)) || DEFAULTS.apiUrl;
      storedApi = storedApi.replace(/Trackandtrace/gi, "TrackAndTrace");
      if (/productInquiryGtin/i.test(storedApi)) storedApi = DEFAULTS.apiUrl;

      const endpoints = defaultTest
        ? TEST_ENDPOINTS
        : { tokenUrl: DEFAULTS.tokenUrl, apiUrl: storedApi };
      setTokenUrl(endpoints.tokenUrl);
      setApiUrl(endpoints.apiUrl);
      setScope(DEFAULTS.scope);
      setGrant(DEFAULTS.grant);

      await prefSet(K.tokenUrl, endpoints.tokenUrl);
      await prefSet(K.apiUrl, endpoints.apiUrl);
      await prefSet(K.scope, DEFAULTS.scope);
      await prefSet(K.grant, DEFAULTS.grant);
      await prefSet(K.clientId, "");
      await prefSet(K.clientSecret, "");
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
          return; // geçerli bir tarih bulduk, burada bit
        }
      }

      // Buraya geldiysek: backend'de kayıt yok veya expiresAt yok → lokal bilgiyi temizle
      setTrialExpiresMs(null);
      await prefSet(K.trialExpiry, "");
    } catch {
      // mini-backend kapalıysa sessiz geç (offline senaryosu)
    }
  };

  useEffect(() => {
    if (tab !== "settings") return;
    if (!myStakeholderId) return;
    refreshTrialFromServer();
  }, [tab, myStakeholderId]);

  // myStakeholderId → typeahead value
  useEffect(() => {
    if (!myStakeholderId) {
      setStkQuery("");
      return;
    }
    const m = stakeholders.find((s) => String(s.id) === String(myStakeholderId));
    if (m) setStkQuery(m.name ? String(m.name) : String(m.id));
  }, [myStakeholderId, stakeholders]);

  // stakeholders.json yükle
  const refreshStakeholders = async (force = false) => {
    try {
      const url = force ? `/stakeholders.json?v=${Date.now()}` : "/stakeholders.json";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("stakeholders.json HTTP " + res.status);
      const data = await res.json();
      const arr: any[] = Array.isArray(data)
        ? data
        : Array.isArray((data as any)?.result)
        ? (data as any).result
        : Array.isArray((data as any)?.data)
        ? (data as any).data
        : Array.isArray((data as any)?.actionResult?.stakeholders)
        ? (data as any).actionResult.stakeholders
        : [];
      const normd = arr.map((it: any) => ({
        id: String(it.code ?? it.id ?? ""),
        name: String(it.name ?? it.title ?? it.code ?? it.id ?? ""),
        parentId:
          it.parentId ??
          it.parentid ??
          it.parent ??
          it.parentCode ??
          it.parentcode ??
          it.parent_code ??
          null,
        ...it,
      }));
      setStakeholders(normd);
    } catch (e) {
      console.error("stakeholders.json yüklenemedi:", e);
      setStakeholders([]);
    }
  };
  useEffect(() => {
    let dead = false;
    (async () => {
      if (!dead) await refreshStakeholders(false);
    })();
    return () => {
      dead = true;
    };
  }, []);
  useEffect(() => {
    if (tab === "settings") refreshStakeholders(true);
  }, [tab]);

  // Test modu toggle
  useEffect(() => {
    const apply = async () => {
      const endpoints = testMode
        ? TEST_ENDPOINTS
        : { tokenUrl: DEFAULTS.tokenUrl, apiUrl: DEFAULTS.apiUrl };
      setTokenUrl(endpoints.tokenUrl);
      setApiUrl(endpoints.apiUrl);
      await prefSet(K.testMode, testMode ? "1" : "0");
      await prefSet(K.tokenUrl, endpoints.tokenUrl);
      await prefSet(K.apiUrl, endpoints.apiUrl);
    };
    apply();
  }, [testMode]);

  // tarama UI stil (stok)
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.key = "scanner-style";
    style.textContent = `
      body.scanner-active { background: transparent !important; }
      .scan-preview-75 { height: 75vh; width: 100%; background: transparent; position: relative; }
      .scan-panel-25 {
        position: fixed; left: 0; right: 0; bottom: 0; height: 25vh;
        background: #fff; border-top: 1px solid #e5e7eb;
        box-shadow: 0 -6px 24px rgba(0,0,0,.08);
        padding: 10px; display: grid; gap: 8px; z-index: 2147483647;
      }
    `;
    document.head.appendChild(style);
    return () => {
      try {
        document.head.removeChild(style);
      } catch {}
    };
  }, []);

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
      alert("Önce Settings → Stakeholder seçin.");
      setTab("settings");
      return false;
    }

    try {
      const st = await trialStatus(myStakeholderId);
      let allowed = !!st?.allowed;

      // Sunucudan gelen expiresAt varsa state + localStorage güncelle
      if (st?.expiresAt) {
        const ms = Date.parse(st.expiresAt);
        if (Number.isFinite(ms)) {
          setTrialExpiresMs(ms);
          await prefSet(K.trialExpiry, String(ms));
          // Tarih gelecekteyse allowed'ı güvenle true kabul edelim
          if (ms > Date.now()) {
            allowed = true;
          }
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
            "Deneme süreniz sona ermiştir. İlave deneme süresi isterseniz ana ekrandaki 'Deneme süremi arttır' butonu ile talep gönderebilirsiniz."
          );
        } else {
          alert(
            "Deneme süreniz yok veya bitmiş. Admin ile iletişime geçin ya da 'Deneme süremi arttır' talebi gönderin."
          );
        }
        return false;
      }

      // Sunucu 'allowed: true' dediyse girişe izin ver
      return true;
    } catch (e: any) {
      console.warn("trialStatus alınamadı:", e);
      // Sunucuya ulaşamadı ama lokalde süre hala aktif görünüyorsa zorla engelleme
      if (!trialActive) {
        alert(
          "Deneme süresi doğrulanamadı. İnternet bağlantınızı ve ayarlarınızı kontrol edin."
        );
        return false;
      }
      return true;
    }
  };

  // === Tarama ve sorgu ===
  const startScan = async () => {
    try {
      setApiError("");
      setNdbResult(null);
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.DATA_MATRIX,
        scanButton: false,
      });
      const text =
        (result as any)?.ScanResult ??
        (result as any)?.content ??
        (result as any)?.text ??
        "";
      if (!text) return;
      setTab("result");
      setLoading(true);
      try {
        const json = await postInquiryQRCodeAnon(apiUrl, { qrCode: String(text) });
        setNdbResult(json);
      } catch (e: any) {
        setApiError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    } catch (e: any) {
      alert("Scan error: " + (e?.message || String(e)));
    }
  };


  const queryManualAnon = async () => {
    setApiError("");
    setNdbResult(null);
    const input = manual.trim();
    if (!input) {
      setApiError("Lütfen QR/GS1 ham metnini girin.");
      setTab("result");
      return;
    }
    setTab("result");
    setAnonLoading(true);
    try {
      const json = await postInquiryQRCodeAnon(apiUrl, { qrCode: input });
      setNdbResult(json);
    } catch (e: any) {
      setApiError(e?.message || String(e));
    } finally {
      setAnonLoading(false);
    }
  };
  const queryManualGtinSn = async () => {
    setApiError("");
    setNdbResult(null);

    const gtin = manualGtin.trim();
    const sn = manualSn.trim();

    if (!gtin || !sn) {
      setApiError("Lütfen GTIN ve seri numarasını girin.");
      setTab("result");
      return;
    }

    setTab("result");
    setAnonLoading(true);
    try {
      const json = await postInquiryGtinSnAnon(apiUrl, {
        gtin,
        serialNumber: sn,
      });
      setNdbResult(json);
    } catch (e: any) {
      setApiError(e?.message || String(e));
    } finally {
      setAnonLoading(false);
    }
  };

  // RESULT ekranında productState = 9 ise, declarationNumber üzerinden transfer kontrolü
  useEffect(() => {
    // Yeni sorguda önce resetle
    setProductState9Message(null);
    setProductState9Loading(false);

    const ar = ndbResult?.actionResult as any;
    if (!ar) return;

    const rawState = ar.productState ?? ar.ProductState ?? null;
    const stateNumber = Number(rawState);
    if (stateNumber !== 9) return; // sadece 9 için çalışıyoruz

    const history = Array.isArray(ar.productInquiryHistory)
      ? ar.productInquiryHistory
      : [];
    const latestDecl = getLatestDeclarationNumberFromHistory(history);
    if (latestDecl == null) return;

    // Kullanıcı adı / şifre yoksa, ekstra kontrol yapamayız → default mesaja dokunma
    if (!username || !password) return;

    let cancelled = false;

    (async () => {
      try {
        setProductState9Loading(true);

        // NDB token al
        const token = await obtainToken({
          grant,
          tokenUrl,
          username: (username || "").trim(),
          password: (password || "").trim(),
          scope,
        });

        // Receive ekranında kullandığımız GetTransferDeclaration ile sorgula
        const decl = await fetchGetTransferDeclaration({
          baseTest: testMode,
          token,
          declarationId: latestDecl,
        });

        if (cancelled) return;

        const toStake = decl?.actionResult?.toStakeholder;

        const myStkNum =
          Number(String(myStakeholderId || "").replace(/\D+/g, "")) || null;
        const partnerNumRaw =
          Number(String(myStakeholderPartnerId || "").replace(/\D+/g, ""));
        const partnerNum =
          Number.isFinite(partnerNumRaw) && partnerNumRaw
            ? partnerNumRaw
            : null;

        const toNum = Number(toStake);

        if (
          Number.isFinite(toNum) &&
          (toNum === myStkNum ||
            (partnerNum != null && toNum === partnerNum))
        ) {
          // 🔹 toStakeholder bizim eczane / partner ise:
          setProductState9Message(
            "Bu ürün eczanenize yollanmış ama henüz kabul yapmamışsınız. Lütfen önce kabul işlemi yapın."
          );
        } else {
          // 🔹 değilse:
          setProductState9Message(
            "Bu ürün bir depodan başka bir eczaneye gönderilmiştir."
          );
        }
      } catch (e) {
        console.warn("productState=9 transfer kontrolü hatası:", e);
        // Hata halinde default description devam eder
      } finally {
        if (!cancelled) setProductState9Loading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    ndbResult,
    username,
    password,
    grant,
    tokenUrl,
    scope,
    testMode,
    myStakeholderId,
    myStakeholderPartnerId,
  ]);


  const saveSettings = async () => {
    // NDB (QR)
    await prefSet(K.username, username);
    await prefSet(K.password, password);
    await prefSet(K.scope, DEFAULTS.scope);
    await prefSet(K.grant, DEFAULTS.grant);
    await prefSet(K.clientId, "");
    await prefSet(K.clientSecret, "");
    await prefSet(K.testMode, testMode ? "1" : "0");
    await prefSet(K.tokenUrl, tokenUrl);
    await prefSet(K.apiUrl, apiUrl);
    // Stakeholder
    await prefSet(K.stakeholderId, myStakeholderId);
    await prefSet(K.stakeholderPartnerId, myStakeholderPartnerId);

    // Trial mantığı:
    //  - Eğer sunucuda kayıt yoksa (reason === "no_trial") ⇒ ilk defa: 14 gün aç
    //  - Kayıt varsa (aktif ya da süresi dolmuş) ⇒ sadece sunucudaki expiresAt'i oku, YENİ trial açma
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
          // Hiç kayıt yoksa ilk kez trial aç
          const reg = await trialRegister(myStakeholderId, myStakeholderPartnerId || "");
          if (reg?.expiresAt) {
            const ms = Date.parse(reg.expiresAt);
            if (Number.isFinite(ms)) {
              setTrialExpiresMs(ms);
              await prefSet(K.trialExpiry, String(ms));
            }
          }
        }
      } catch {
        // mini-backend kapalıysa sessizce devam et
      }
    }

    alert("Kaydedildi.");
    setTab("home");
  };

  /* ====== RECEIVE ====== */
  const scanForReceive = async () => {
    try {
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.ALL,
        scanButton: false,
      });
      const text =
        (result as any)?.ScanResult ??
        (result as any)?.content ??
        (result as any)?.text ??
        "";
      if (text) setReceiveQr(String(text));
    } catch (e: any) {
      alert("Scan error: " + (e?.message || String(e)));
    }
  };

   const runReceiveFlow = async () => {
    if (!(await ensureTrialOrAlert())) return;

    setReceiveLoading(true);
    setReceiveError("");
    setReceiveInfo("");
    setReceiveData(null);
    setReceiveGroups([]);
    setReceiveDbg(null);

    // Kabul durumunu ve mesajlarını da her yeni sorguda sıfırla
    setReceiveAccepted(false);
    setReceiveAcceptMessage(null);
    setReceiveAcceptError(null);

    try {
      const qr = (receiveQr || "").trim();
      if (!qr) throw new Error("Lütfen karekod girin veya okutun.");
      if (!username || !password) {
        throw new Error("Önce Settings’ten NDB kullanıcı adı ve şifrenizi kaydedin.");
      }

      // 1) ProductInquiryQRCode → ürün geçmişini al
      const token = await obtainToken({
        grant,
        tokenUrl,
        username: (username || "").trim(),
        password: (password || "").trim(),
        scope,
      });

      const qrResp = await postInquiryQRCodeAuth(apiUrl, token, { qrCode: qr });
      const ar = qrResp?.actionResult ?? null;
      if (!ar) {
        throw new Error("QR sorgusu döndü fakat actionResult bulunamadı.");
      }

      const history = Array.isArray(ar.productInquiryHistory)
        ? ar.productInquiryHistory
        : [];
      if (!history.length) {
        throw new Error("QR sorgusunda geçmiş bulunamadı (declarationNumber yok).");
      }

      // 2) En büyük declarationNumber ve o kaydın stakeHolder'ını bul
      let latestDecl: number | null = null;
      let latestHolder: string | null = null;

      for (const h of history as any[]) {
        const n = Number(h?.declarationNumber);
        if (Number.isFinite(n)) {
          if (latestDecl === null || n > latestDecl) {
            latestDecl = n;
            latestHolder = h?.stakeHolder ? String(h.stakeHolder).trim() : null;
          }
        }
      }

      if (latestDecl === null) {
        throw new Error("Geçerli declarationNumber tespit edilemedi.");
      }

      // 3) Settings'teki stakeholder / partner adları ile karşılaştır
      const myNameNorm = norm(selectedStakeholderName || "");

      let partnerNameNorm = "";
      if (myStakeholderPartnerId) {
        const partnerName = stakeholderNameById(myStakeholderPartnerId).trim();
        partnerNameNorm = norm(partnerName);
      }

      const holderNorm = norm(latestHolder || "");

      const matchesOwnStock =
        !!holderNorm &&
        (holderNorm === myNameNorm ||
          (!!partnerNameNorm && holderNorm === partnerNameNorm));

      if (matchesOwnStock) {
        // 🔹 Ürün zaten sizin stoğunuzda → ikinci API'ye gitme
        setReceiveInfo("Bu ilaç zaten sizin stoğunuzda görünüyor.");
        setReceiveDbg({
          declId: latestDecl,
          toStake: null,
          myStk: null,
          myPartner: null,
        });
        setReceiveLoading(false);
        return;
      }

      // 4) Ürün henüz size geçmemiş → GetTransferDeclaration ile detayları çek
      const declResp = await fetchGetTransferDeclaration({
        baseTest: testMode,
        token,
        declarationId: latestDecl,
      });

      const toStk = declResp?.actionResult?.toStakeholder ?? null;
      const myStkNum =
        Number(String(myStakeholderId || "").replace(/\D+/g, "")) || null;

      const partnerRaw = myStakeholderPartnerId;
      const partnerNum = Number(String(partnerRaw || "").replace(/\D+/g, ""));

      if (!myStkNum) {
        throw new Error("Settings → Stakeholder seçimi yapılmamış.");
      }

      const toNum = Number(toStk);
      const matchesMeNum =
        Number.isFinite(toNum) &&
        (toNum === myStkNum ||
          (Number.isFinite(partnerNum) && toNum === partnerNum));

      setReceiveDbg({
        declId: latestDecl,
        toStake: Number(toStk) || null,
        myStk: myStkNum,
        myPartner: Number.isFinite(partnerNum) ? (partnerNum as number) : null,
      });

            if (!matchesMeNum) {
        setReceiveData(null);
        setReceiveGroups([]);
        throw new Error("Bu ürün size transfer edilmemiştir. Kabul işlemi yapılamaz.");
      }


      // 5) Detay satırlarını grupla (eski mantık)
      const details = declResp?.actionResult?.details || [];
      const map = new Map<
        string,
        { brand: string; gtin: string; lot: string; count: number }
      >();

      for (const d of details) {
        const brand = (d.fullBrandName || "").trim();
        const gtin = (d.gtin || "").trim();
        const lot = (d.batchNumber || "").trim();
        const key = `${brand}@@${gtin}@@${lot}`;
        if (!map.has(key)) {
          map.set(key, { brand, gtin, lot, count: 1 });
        } else {
          map.get(key)!.count += 1;
        }
      }

      setReceiveData(declResp);
      setReceiveGroups(Array.from(map.values()));
    } catch (e: any) {
      setReceiveError(e?.message || String(e));
    } finally {
      setReceiveLoading(false);
    }
  };

    const runReceiveAccept = async () => {
    if (!(await ensureTrialOrAlert())) return;

    setReceiveAcceptMessage(null);
    setReceiveAcceptError(null);

    try {
      setReceiveAcceptLoading(true);
      setReceiveAccepted(false);

      const declIdSource =
        receiveData?.actionResult?.declarationId ?? receiveDbg?.declId ?? null;
      const declId = Number(declIdSource);

      if (!Number.isFinite(declId) || !declId) {
        throw new Error("Kabul edilecek declarationId bulunamadı.");
      }

      if (!username || !password) {
        throw new Error("Önce Settings’ten NDB kullanıcı adı ve şifrenizi kaydedin.");
      }

      const token = await obtainToken({
        grant,
        tokenUrl,
        username: (username || "").trim(),
        password: (password || "").trim(),
        scope,
      });

            const resp = await postTransferAccept({
        baseTest: testMode,
        token,
        declarationId: declId,
      });

      let msg: string;

      if (resp?.resultCode === 0) {
        // 🔹 Başarılı durumda kendi mesajımızı göster
        msg = "Kabul işlemi tamamlanmıştır. Tüm ürünler stoklarınıza işlenmiştir.";
      } else {
        // Diğer durumlarda API’nin mesajını ya da genel hata metnini göster
        msg =
          resp?.resultMessage ||
          "İşlem sonucu alınamadı.";
      }

      setReceiveAcceptMessage(msg);

      if (resp?.resultCode === 0) {
        setReceiveAccepted(true);
      }

    } catch (e: any) {
      setReceiveAcceptError(e?.message || String(e));
    } finally {
      setReceiveAcceptLoading(false);
    }
  };



  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function lockScroll() {
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.width = "100%";
  }
  function unlockScroll() {
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = "";
    body.style.overflow = "";
    body.style.position = "";
    body.style.width = "";
  }
  async function ensureCameraPermission(): Promise<boolean> {
    try {
      const anyMod = CapacitorBarcodeScanner as any;
      if (anyMod?.checkPermissions) {
        const perm = await anyMod.checkPermissions();
        if (perm?.camera === "granted") return true;
        if (anyMod?.requestPermissions) {
          const req = await anyMod.requestPermissions();
          if (req?.camera === "granted") return true;
        }
        if (anyMod?.openAppSettings) {
          alert("Kamera izni gerekli. Ayarlardan izin verip tekrar deneyin.");
          await anyMod.openAppSettings();
        }
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  // ==== Gömülü tarama UI kontrolü (stok) ====
  const [, setScanUiActive] = useState(false);
  function enterScanUI() {
    setScanUiActive(true);
    document.body.classList.add("scanner-active");
    try {
      const anyMod = CapacitorBarcodeScanner as any;
      if (anyMod?.hideBackground) anyMod.hideBackground();
    } catch {}
    lockScroll();
  }
  function exitScanUI() {
    setScanUiActive(false);
    document.body.classList.remove("scanner-active");
    try {
      const anyMod = CapacitorBarcodeScanner as any;
      if (anyMod?.showBackground) anyMod.showBackground();
    } catch {}
    unlockScroll();
  }


  
  /* ====== STOK SAYIM ====== */
    const resolveStockItemByQR = async (
  rawQR: string,
  tokenOverride?: string
): Promise<StockScanLog | null> => {
  const tk =
    tokenOverride ||
    (await obtainToken({
      grant,
      tokenUrl,
      username: (username || "").trim(),
      password: (password || "").trim(),
      scope,
    }));

  const data = await postInquiryQRCodeAuth(apiUrl, tk, { qrCode: rawQR });
  const ar: any = data?.actionResult;
  if (!ar) {
    return {
      brand: "",
      gtin: "",
      lot: "",
      raw: rawQR,
      t: new Date().toISOString(),
      status: "error",
      title: "Durum bilinmiyor",
      description: "actionResult bulunamadı.",
      note: "actionResult yok",
    };
  }

  // ProductState=9 için Scan&Check ile aynı mantığı çalıştırıp
  // açıklamayı gerekirse override edeceğiz
  let ps9Override: string | null = null;

  try {
    const rawState = ar.productState ?? ar.ProductState ?? null;
    const stateNumber = Number(rawState);

    if (stateNumber === 9 && username && password) {
      const history = Array.isArray(ar.productInquiryHistory)
        ? ar.productInquiryHistory
        : [];
      const latestDecl = getLatestDeclarationNumberFromHistory(history);
      if (latestDecl != null) {
        // Scan&Check’te yaptığımız gibi GetTransferDeclaration çağrısı
        const decl = await fetchGetTransferDeclaration({
          baseTest: testMode,
          token: tk,
          declarationId: latestDecl,
        });

        const declAr: any =
          (decl as any)?.actionResult ?? (decl as any)?.ActionResult ?? null;

        const toStake =
          declAr?.toStakeholder ??
          declAr?.ToStakeholder ??
          null;

        const myStkNum =
          Number(String(myStakeholderId || "").replace(/\D+/g, "")) || null;
        const partnerNumRaw = Number(
          String(myStakeholderPartnerId || "").replace(/\D+/g, "")
        );
        const partnerNum =
          Number.isFinite(partnerNumRaw) && partnerNumRaw
            ? partnerNumRaw
            : null;

        const toNum = Number(toStake);

        if (
          Number.isFinite(toNum) &&
          (toNum === myStkNum ||
            (partnerNum != null && toNum === partnerNum))
        ) {
          // 🔹 toStakeholder bizim eczane / partner ise:
          ps9Override =
            "Bu ürün eczanenize yollanmış ama henüz kabul yapmamışsınız. Lütfen önce kabul işlemi yapın.";
        } else {
          // 🔹 değilse:
          ps9Override =
            "Bu ürün bir depodan başka bir eczaneye gönderilmiştir.";
        }
      }
    }
  } catch (e) {
    console.warn(
      "resolveStockItemByQR productState=9 transfer kontrolü hatası:",
      e
    );
    // Hata halinde ps9Override null kalır; default description kullanılır
  }

  const brand = (ar.productName || "").trim();
  const gtin = (ar.gtin || "").trim();
  const lot = (ar.batchNumber || "").trim();
  const sn = (ar.serialNumber || "").trim();

  // Satılabilir / Satılamaz panel mantığı
  const sale = buildStockSaleInfo(ar);

  const description = ps9Override ?? sale.description;

  return {
    brand,
    gtin,
    lot,
    sn,
    raw: rawQR,
    t: new Date().toISOString(),
    status: sale.status,
    title: sale.title,
    description,
  };
};


      // EASY modunda okunan karekodları tek tek sorgular
  const loadEasyItems = async (codes: string[]) => {
    setEasyResolving(true);
    try {
      // Easy final ekranda hem liste, hem sayaç için kullanacağız
      setEasyCodes(codes);
      // Not artık sadece final ekranda girilecek; başlangıçta boş olsun
      setEasyNote("");
      const results: StockScanLog[] = [];

      for (const raw of codes) {
        try {
          const log = await resolveStockItemByQR(raw);
          if (log) {
            results.push(log);
          }
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

  // 🔹 EASY final ekrandan “Ekle” ile gelen yeni kodları
  // mevcut listeye EKLE (üzerine yazma)
  const appendEasyItems = async (codes: string[]) => {
    if (!codes.length) return;
    setEasyResolving(true);
    try {
      const results: StockScanLog[] = [];

      for (const raw of codes) {
        try {
          const log = await resolveStockItemByQR(raw);
          if (log) {
            results.push(log);
          }
        } catch (err) {
          console.warn("Easy stock resolve error (append)", err);
        }
      }

      setEasyItems((prev) => {
        const existingRaw = new Set(prev.map((p) => p.raw));
        const onlyNew = results.filter((r) => !existingRaw.has(r.raw));
        return [...prev, ...onlyNew];
      });

      // Easy final zaten açık, tekrar açmaya gerek yok
      setShowEasyPage(false);
      setShowEasyFinalPage(true);
    } finally {
      setEasyResolving(false);
    }
  };

  // 🔹 Easy final ekrandaki “Ekle” butonu:
  // tekrar kamera aç, yeni kodları oku ve mevcut listeye ekle
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

    // DataMatrix / barkod içinden GTIN-13 çıkarma
    const extractGtinFromRawCode = (raw: string | undefined | null): string => {
      if (!raw) return "";
      const s = String(raw);

      // Önce 01 + 14 digit (AI 01) şeklini ara
      const m = s.match(/01(\d{14})/);
      let gtin14: string | null = null;

      if (m) {
        gtin14 = m[1];
      } else {
        // Olmazsa tüm rakamları topla, ilk 14 veya 13 haneyi kullan
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
      // 14 haneli ve başı 0 ise → GTIN-13
      if (gtin14.length === 14 && gtin14.startsWith("0")) {
        return gtin14.slice(1);
      }
      return gtin14;
    };

    try {
      // GTIN -> { brand, count } map'i
      const gtinMap = new Map<string, { brand: string; count: number }>();

      for (const id of payload.ids) {
        // Native easy satış detayını çek
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
          const nextBrand = prev.brand || brand; // ilk gördüğümüz brand'i kullan
          gtinMap.set(gtin, { brand: nextBrand, count: prev.count + 1 });
        }
      }

      if (gtinMap.size === 0) {
        alert("Bu gün için GTIN / barkod bilgisi bulunamadı.");
        return;
      }

      // --- Brand,GTIN,Count CSV'si hazırlama (LOT YOK) ---
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
        // Native: Documents/Download altına yaz + paylaş
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
        // Web: direkt indirt
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
        "Günlük CSV hazırlanırken hata: " +
          (err?.message || String(err || ""))
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

    // 1) EASY satış kaydını cihaza yaz
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

    // 2) NDB SalesDeclaration – sonuçları EasyFinalPage'e döndür
    const results: {
      qrCode: string;
      success: boolean;
      message: string;
    }[] = [];

    // Kullanıcı adı / şifre yoksa sadece kayıt yap, bildirim deneme
    if (!username || !password) {
      alert(
        "Satış kaydı cihaz içine kaydedildi.\n\nNDB satış bildirimi için lütfen Settings ekranından kullanıcı adı ve şifreyi kaydedin."
      );
      return results;
    }

    // Access token al
    const token = await obtainToken({
      grant,
      tokenUrl,
      username: (username || "").trim(),
      password: (password || "").trim(),
      scope,
    });

    const url = `https://${testMode ? "testndbapi" : "ndbapi"}.med.kg/api/TrackAndTrace/SalesDeclaration`;

    for (const item of payload.items) {
      const qrCode = item.raw;
      if (!qrCode) {
        results.push({
          qrCode: "",
          success: false,
          message: "Geçersiz karekod (raw alanı boş).",
        });
        continue;
      }

      // Fiyat ve partial'ı sayıya çevir
      const priceRaw = String(item.unitPrice || "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");
      const priceNum = priceRaw ? Number(priceRaw) : 0;

      const partialRaw = String(item.partialAmount || "").replace(
        /[^\d]/g,
        ""
      );
      const partialNum = partialRaw ? Number(partialRaw) : 0;

      const body = {
        prescriptionId: payload.prescriptionNumber.trim(),
        patientId: payload.citizenId.trim(),
        requestNumber: "",
        departmentName: "",
        isPharmacyConsuption: true,
        details: [
          {
            qrCode,
            price: Number.isFinite(priceNum) ? priceNum : 0,
            isPartialSale: partialNum > 0,
            partialSaleAmount: partialNum > 0 ? partialNum : 0,
          },
        ],
      };

      try {
        const res = await CapacitorHttp.post({
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
          },
          data: body,
        });

        let data: any = res.data;
        if (typeof data === "string") {
          try {
            data = data ? JSON.parse(data) : null;
          } catch {
            data = null;
          }
        }

        if (res.status >= 200 && res.status < 300 && data?.resultCode === 0) {
  results.push({
    qrCode,
    success: true,
    message: "Bildirim yapıldı.",
  });
} else {
  let msg =
    (data && data.resultMessage) ||
    `SalesDeclaration hata (${res.status}).`;

  // "Product with QRCode ... is not suitable for sale"
  // gibi mesajlarda sadece "is not suitable for sale" göster
  if (msg) {
    const lowered = msg.toLowerCase();
    const needle = "is not suitable for sale";
    const idx = lowered.indexOf(needle);
    if (idx !== -1) {
      msg = "is not suitable for sale";
    }
  }

  results.push({
    qrCode,
    success: false,
    message: msg,
  });
}

      } catch (e: any) {
        results.push({
          qrCode,
          success: false,
          message:
            e?.message || "SalesDeclaration çağrısı sırasında ağ hatası.",
        });
      }
    }

    // Kayıt mesajı (istersen tutmaya devam edebiliriz)
    alert("Satış kaydı cihaz içine kaydedildi.");

    // EasyFinalPage, satır altındaki ✅ / ❌ için bu listeyi kullanacak
    return results;
  } catch (err: any) {
    alert(
      "Satış kaydı sırasında hata: " +
        (err?.message || String(err || ""))
    );
  }
};



    const stockScanOnce = async () => {
    if (!stockActiveRef.current) return;
    setStockBusy(true);
    try {
      const anyMod = CapacitorBarcodeScanner as any;
      let text = "";

      if (anyMod?.startScan) {
        const result = await anyMod.startScan({});
        text = result?.content ?? result?.text ?? (result as any)?.ScanResult ?? "";
      } else {
        const result = await CapacitorBarcodeScanner.scanBarcode({
          hint: CapacitorBarcodeScannerTypeHint.DATA_MATRIX,
          scanButton: false,
        });
        text =
          (result as any)?.ScanResult ??
          (result as any)?.content ??
          (result as any)?.text ??
          "";
      }

          if (!text) {
      // Barkod okunmadı (plugin boş döndü). Kullanıcı Durdur'a basmadıysa
      // döngüyü öldürme, kısa bir beklemeden sonra yeniden tara.
      setStockBusy(false);

      if (stockActiveRef.current) {
        await sleep(80);
        return stockScanOnce();
      }
      return;
    }


      // Ham QR metni (tam senin verdiğin string: 0108....A333333)
      const rawQR = String(text).trim();
      if (!rawQR) {
        setStockBusy(false);
        setStockPaused(true);
        return;
      }

      // 🔁 DUPLICATE KONTROLÜ:
      // Bu karekod daha önce okunduysa, hiç sorgu yapmadan atla
      if (scannedQRCodesRef.current.has(rawQR)) {
        setStockBusy(false);

        if (stockActiveRef.current) {
          await sleep(80);
          return stockScanOnce(); // bir sonrakini bekle
        }
        return;
      }

      // İlk defa görüyoruz → sete ekle
      scannedQRCodesRef.current.add(rawQR);

      if (!stockTokenRef.current) {
        stockTokenRef.current = (async () =>
          await obtainToken({
            grant,
            tokenUrl,
            username: (username || "").trim(),
            password: (password || "").trim(),
            scope,
          }))();
      }

      let tk = "";
      try {
        tk = await stockTokenRef.current!;
      } catch (e: any) {
        setStockError("Token alınamadı: " + (e?.message || String(e)));
        stockTokenRef.current = null;
        setStockBusy(false);
        if (stockActiveRef.current && !stockPaused) {
          await sleep(80);
          return stockScanOnce();
        }
        return;
      }

      if (!stockActiveRef.current) return;

      const item = await resolveStockItemByQR(rawQR, tk); // 👈 rawQR kullanıyoruz

      if (item) {
        setStockLog((prev) => [...prev, item]);
        const asStockItem: StockItem = {
          brand: item.brand,
          gtin: item.gtin,
          lot: item.lot,
          sn: item.sn,
          raw: item.raw,
          t: item.t,
        };

        setStockItems((prev) => {
          const arr = [...prev, asStockItem];
          setStockSummary(groupStock(arr));
          return arr;
        });
        setStockLast(asStockItem);
      }

      setStockBusy(false);
      if (stockActiveRef.current) {
        await sleep(80);
        return stockScanOnce();
      }
     } catch (e: any) {
    const msg = e?.message || String(e);

    // Kullanıcı X'e basıp taramayı iptal ettiyse → sessizce o anki denemeyi bitir,
    // döngüyü zorlamayalım. (Durdur butonunu kullanırsa zaten tamamen çıkıyor.)
    if (/AbortError|aborted|cancel/i.test(msg)) {
      setStockBusy(false);
      return;
    }

    // Gerçek hata ise mesajı göster ama taramayı tamamen öldürme;
    // hâlâ aktifse kısa bekleyip yeniden dene.
    setStockError(msg);
    setStockBusy(false);

    if (stockActiveRef.current) {
      await sleep(300);
      return stockScanOnce();
    }
    return;
  }

  };


  const startStockCounting = async () => {
    if (!(await ensureTrialOrAlert())) return;
    if (!username || !password) {
      alert("Önce Settings’ten kullanıcı adı ve şifre girin.");
      setTab("settings");
      return;
    }
    setTab("stock");
    const ok = await ensureCameraPermission();
    if (!ok) return;
    enterScanUI();
    setStockError("");
    setStockItems([]);
    setStockSummary([]);
    setStockLast(null);
    setStockPaused(false);
    setStockActive(true);
    setStockLog([]);
    scannedQRCodesRef.current = new Set();
    stockTokenRef.current = null;
    await stockScanOnce();
  };

  const stopStockCounting = async () => {
    setStockActive(false);
    stockActiveRef.current = false;
    setStockPaused(false);
    try {
      const anyMod = CapacitorBarcodeScanner as any;
      if (anyMod?.stopScan) await anyMod.stopScan();
    } catch {}
    exitScanUI();
  };

   /*
  const addManualQRToStock = async () => {
    const raw = stockManualQR.trim();
    if (!raw) return;
    setStockBusy(true);
    try {
      const item = await resolveStockItemByQR(raw);
      if (item) {
        setStockLog((prev) => [...prev, item]);
        const asStockItem: StockItem = {
          brand: item.brand,
          gtin: item.gtin,
          lot: item.lot,
          raw: item.raw,
          t: item.t,
        };
        setStockItems((prev) => {
          const arr = [...prev, asStockItem];
          setStockSummary(groupStock(arr));
          return arr;
        });
        setStockLast(asStockItem);
        setStockManualQR("");
      }
    } catch (e: any) {
      alert("Sorgu hatası: " + (e?.message || String(e)));
    } finally {
      setStockBusy(false);
    }
  };
  */

  const saveStockCounting = async () => {
    const groups = stockSummary;
    const total = stockItems.length;
    if (!total) {
      alert("Kaydedilecek kayıt yok.");
      return;
    }
    const saved = await saveStockSession(groups, total);
    if (isNative()) {
      try {
        const { path } = await saveCSVNative(saved.title, groups, false);
        alert(`CSV kaydedildi:\nDocuments/${path}`);
      } catch (e: any) {
        alert("Yerel CSV kaydı başarısız: " + (e?.message || String(e)));
      }
    } else {
      downloadCSV(saved.title, groups);
      alert("CSV indirildi.");
    }
  };

 
  /* ========= /admin rotasında erken dönüş ========= */
  /* Dikkat: Hook kuralları açısından bu kısımda isAdminRoute sabit (path'e göre). */
    /* ========= /admin rotasında erken dönüş ========= */
  /* Dikkat: Hook kuralları açısından bu kısımda isAdminRoute sabit (path'e göre). */
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

    // Lazy import (dosya yolu: ./pages/AdminTrials.tsx)
    const AdminTrials = React.useMemo(
      () => React.lazy(() => import("./pages/AdminTrials")),
      []
    );

    // Lazy import (dosya yolu: ./pages/AdminProducts.tsx)
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
        {/* Logo */}
        <div style={UI.logoWrap}>
          <div style={UI.logoBadge}>DMS</div>
          <div style={UI.logoText}>Admin</div>
        </div>

        {/* Sekmeler */}
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
              <AdminStakeholders />
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

      // EASY item’a kaydedilen değerler (varsa)
      unitPrice: it.unitPrice ?? "",
      partialAmount: it.partialAmount ?? "",

      // NDB satış bildirimi bilgisi (geçmiş kayıt için)
      ndbSuccess:
        typeof it.ndbSuccess === "boolean" ? it.ndbSuccess : null,
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


    // EASY sayfası ayrı bir ekranda gösterilir
      // EASY final sayfası (reçete satış özeti)
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
        // 🔹 yeni: liste değişince App’teki state’i güncelle
        onChangeItems={setEasyItems}
        // 🔹 yeni: “Ekle (yeniden okut)” butonu
        onAddMore={handleEasyAddMore}
      />
    );
  }


      // EASY liste sayfası
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





  // FAST sayfası ayrı bir ekranda gösterilir
  if (showFastPage && !isAdminRoute) {
    return <FastPage onBack={() => setShowFastPage(false)} />;
  }


    return (
    <div
      style={{
        ...UI.page,
        ...(isWide ? { maxWidth: 1100, margin: "0 auto", padding: "24px 20px" } : null),
      }}
    >
      {/* Logo */}
<div style={UI.logoWrap}>
  <div style={UI.logoBadge}>DMS</div>
  <div style={UI.logoText}>
    <span style={{ fontSize: 20, fontWeight: 800 }}>
      DataMatrix Scanner{" "}
    </span>
    <span
      style={{
        fontSize: 20,
        fontWeight: 800,   // "for" ve "for Pharmacy" artık bold
        opacity: 0.9,
      }}
    >
      {myStakeholderId ? "for" : "for Pharmacy"}
    </span>
  </div>
</div>




            {/* Seçili stakeholder adı */}
      {selectedStakeholderName && (
        <div
          style={{
            marginTop: 6,
            marginBottom: 24,
            fontWeight: 900,
            fontSize: isWide ? 22 : 20,   // daha büyük
            letterSpacing: 2,              // daha ciddi görünen aralıklı yazı
            textTransform: "uppercase",
            color: "#111827",              // tam koyu gri / siyah
            textShadow: "0 1px 2px rgba(0,0,0,0.18)", // hafif gölgeyle öne çıkar
                        textAlign: "center",

          }}
        >
          {selectedStakeholderName}
        </div>
      )}




      {/* Kamera önizleme alanı: sadece STOK tarama AKTİF iken */}
      {stockActive && <div className="scan-preview-75" />}

          {/* HOME */}
      {tab === "home" && (
        <>
          <div
            style={{
              ...UI.grid4,
              gridTemplateColumns: isWide ? "1fr 1fr 1fr" : "1fr",
            }}
          >
            {/* 1) Normal Scan */}
            <button
              style={ANON_BTN}
              onClick={async () => {
                if (!ensureOnline()) return;
                await startScan();
              }}
            >
              {t("buttons.scan")}
            </button>

            {/* 2) Manual */}
            <button
              style={ANON_BTN}
              onClick={() => {
                if (!ensureOnline()) return;
                setTab("manual");
              }}
            >
              {t("buttons.manual")}
            </button>

            {/* 3) Receive */}
            <button
              style={
                trialActive
                  ? TRIAL_BTN_GREEN
                  : { ...TRIAL_BTN_RED, opacity: 0.75 }
              }
              onClick={async () => {
                if (!ensureOnline()) return;
                if (!(await ensureTrialOrAlert())) return;
                setTab("receive");
              }}
            >
              Receive
            </button>

            {/* 4) Stock Count */}
            <button
              style={
                trialActive
                  ? TRIAL_BTN_GREEN
                  : { ...TRIAL_BTN_RED, opacity: 0.75 }
              }
              onClick={async () => {
                if (!ensureOnline()) return;
                await startStockCounting(); // İçeride zaten ensureTrialOrAlert var
              }}
            >
              {t("buttons.stock")}
            </button>

            {/* 5) FAST */}
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

                       {/* 6) EASY */}
            <button
              style={
                trialActive
                  ? TRIAL_BTN_GREEN
                  : { ...TRIAL_BTN_RED, opacity: 0.75 }
              }
              onClick={async () => {
                if (!(await ensureTrialOrAlert())) return;
                setEasyItems([]);
                setEasyCodes([]);
                setEasyNote("");
                setShowEasyFinalPage(false);
                setShowEasyPage(true);
              }}
            >
              EASY
            </button>



            {/* 7) Settings */}
            <button
              style={ANON_BTN}
              onClick={() => setTab("settings")}
            >
              {t("buttons.settings")}
            </button>
          </div>
        </>
      )}


      {/* MANUAL */}
            {tab === "manual" && (
        <Card title={t("manual.title")}>
          <div style={{ display: "grid", gap: 12 }}>
            {/* 1) Ham QR / GS1 metni */}
            <textarea
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder={t("manual.placeholder")}
              rows={3}
              style={UI.textarea}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={queryManualAnon}
                disabled={anonLoading}
                title="Token olmadan QR/GS1 sorgusu"
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #111",
                  background: "#fff",
                  color: "#111",
                  fontWeight: 700,
                }}
              >
                {anonLoading ? t("result.loading") : t("buttons.anonQuery")}
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
                {t("buttons.back")}
              </button>
            </div>

            {/* Ayırıcı */}
            <div
              style={{
                margin: "8px 0",
                borderTop: "1px dashed #e5e7eb",
              }}
            />

            {/* 2) GTIN + Seri No ile sorgu */}
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              GTIN + Serial Number
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                value={manualGtin}
                onChange={(e) => setManualGtin(e.target.value)}
                placeholder="GTIN (ör. 8699536090115)"
                style={UI.input}
              />
              <input
                value={manualSn}
                onChange={(e) => setManualSn(e.target.value)}
                placeholder="Serial Number (ör. TST0000002117)"
                style={UI.input}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={queryManualGtinSn}
                disabled={anonLoading}
                title="GTIN + Seri No ile sorgu"
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #111",
                  background: "#fff",
                  color: "#111",
                  fontWeight: 700,
                }}
              >
                {anonLoading
                  ? t("result.loading")
                  : "Query by GTIN + SN"}
              </button>
            </div>
          </div>
        </Card>
      )}


      {/* SETTINGS */}
      {tab === "settings" && (
        <Card title={t("settings.title")}>
          <div style={{ display: "grid", gap: 12 }}>
            {/* Test toggle */}
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
              />
              <span>{t("settings.testEnv")} </span>
            </label>

            {/* Language */}
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                {t("settings.language")}
              </div>
              <select
                value={lang}
                onChange={async (e) => {
                  const v = e.target.value as "en" | "ru";
                  setLang(v);
                  i18n.changeLanguage(v);
                  await Preferences.set({ key: "app_lang", value: v });
                }}
                style={{ ...UI.input, width: "auto" }}
              >
                <option value="en">English</option>
                <option value="ru">Русский</option>
              </select>
            </div>

            {/* NDB kimlik */}
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Kullanıcı Adı (email)
              </div>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ornek@firma.com"
                style={UI.input}
                autoCapitalize="none"
                inputMode="email"
              />
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Şifre</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={UI.input}
              />
            </div>

            {/* Stakeholder typeahead */}
            <div style={{ position: "relative" }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Stakeholder</div>
              <input
                value={stkQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setStkQuery(v);
                  const minQuery = norm(v.replace(/\s+/g, " ").trim());
                  setStkOpen(minQuery.length >= 3);
                }}
                onFocus={() => {
                  if (stkQuery.trim().length >= 3) setStkOpen(true);
                }}
                onBlur={() => {
                  setTimeout(() => setStkOpen(false), 200);
                }}
                placeholder="En az 3 harf yazın, listeden seçin…"
                style={{ ...UI.input, width: "100%", maxWidth: 480 }}
              />
              {/* Sonuç sayısı */}
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                {(() => {
                  const q = norm(stkQuery.replace(/\s+/g, " ").trim());
                  if (q.length < 3)
                    return <>Listeyi görmek için en az 3 harf yazın.</>;
                  const count = stakeholders.reduce((n, s) => {
                    const name = norm(s.name);
                    const id = String(s.id ?? "");
                    return n + (name.includes(q) || id.includes(q) ? 1 : 0);
                  }, 0);
                  return (
                    <>
                      Eşleşen kayıtlar: <strong>{count}</strong>
                    </>
                  );
                })()}
              </div>

              {stkOpen && (
                <div
                  style={{
                    position: "absolute",
                    zIndex: 50,
                    top: "100%",
                    left: 0,
                    right: 0,
                    maxHeight: 280,
                    overflowY: "auto",
                    marginTop: 6,
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    boxShadow: "0 10px 30px rgba(0,0,0,.08)",
                  }}
                >
                  {(() => {
                    const q = norm(stkQuery.replace(/\s+/g, " ").trim());
                    const results =
                      q.length < 3
                        ? []
                        : stakeholders
                            .filter((s) => {
                              const name = norm(s.name);
                              const id = String(s.id ?? "");
                              return name.includes(q) || id.includes(q);
                            })
                            .slice(0, 100);

                    if (!results.length) {
                      return (
                        <div
                          style={{
                            padding: 10,
                            fontSize: 13,
                            color: "#6b7280",
                          }}
                        >
                          Sonuç yok. Daha fazla harf deneyin.
                        </div>
                      );
                    }

                    return results.map((s) => (
                      <div
                        key={String(s.id)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={async () => {
                          const sidRaw = String(s.id ?? "");
                          const sid = sidRaw.replace(/\D+/g, "");
                          setMyStakeholderId(sid);
                          setStkQuery(s.name ? String(s.name) : sidRaw);
                          setStkOpen(false);

                          // partnerId çıkarımı (child/parent)
                          let partner = "";
                          const sParentRaw =
                            (s as any)?.parentId ??
                            (s as any)?.parentid ??
                            (s as any)?.parent ??
                            (s as any)?.parentCode ??
                            (s as any)?.parentcode ??
                            (s as any)?.parent_code ??
                            null;
                          const sParent = String(sParentRaw ?? "");
                          if (sParent && sParent !== sid) {
                            partner = sParent.replace(/\D+/g, "");
                          } else {
                            const children = stakeholders.filter((x) => {
                              return (
                                String(
                                  (x as any)?.parentId ??
                                    (x as any)?.parentid ??
                                    (x as any)?.parent ??
                                    (x as any)?.parentCode ??
                                    (x as any)?.parentcode ??
                                    (x as any)?.parent_code ??
                                    ""
                                ) === sid
                              );
                            });
                            if (children.length) {
                              const wh = children.find(
                                (x: any) => Number(x?.type) === 7
                              );
                              const pick = wh || children[0];
                              partner = String(pick.id ?? "").replace(/\D+/g, "");
                            }
                          }
                          await prefSet(K.stakeholderId, sid);
                          await prefSet(K.stakeholderPartnerId, partner || "");
                          setMyStakeholderPartnerId(partner || "");
                        }}
                        style={{
                          padding: "10px 12px",
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ overflowWrap: "anywhere" }}>
                          {s.name || s.id}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              )}

              {/* Debug */}
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  padding: 8,
                  border: "1px dashed #cbd5e1",
                  borderRadius: 8,
                  background: "#f8fafc",
                }}
              >
                <div>
                  <b>stakeholderId</b>: <code>{myStakeholderId || "—"}</code>
                </div>
                <div>
                  <b>stakeholderPartnerId</b>:{" "}
                  <code>{myStakeholderPartnerId || "—"}</code>
                </div>
              </div>
         
              
                            <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 6,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => refreshStakeholders(true)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    fontSize: 12,
                  }}
                  title="Sunucudaki stakeholders.json'ı yeniden yükle"
                >
                  Listeyi Yeniden Yükle
                </button>
              </div>

            </div>

                       {/* Trial durumu + uzatma talebi (Settings içinde) */}
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
                {trialActive
                  ? `Deneme aktif • Bitiş: ${
                      trialExpiresMs ? formatTRDate(trialExpiresMs) : "—"
                    }`
                  : myStakeholderId
                  ? "Değerli kullanıcımız, deneme süreniz sona ermiştir. Eğer ilave deneme süresi isterseniz lütfen 'Deneme süremi arttır' butonuna basınız. Talebiniz uygun görülürse deneme süreniz 24 saat içinde arttırılacaktır."
                  : "Stakeholder seçilmemiş"}
              </div>

              {/* Deneme süresi bittiyse ve stakeholder seçildiyse buton göster */}
              {!trialActive && myStakeholderId && (
                <div style={{ marginLeft: "auto" }}>
                  <button
  onClick={async () => {
    // 1) Önce internet var mı kontrol et
    if (!ensureOnline()) return;

    // 2) Sonra mevcut stakeholder / trial akışı
    if (!myStakeholderId) {
      alert("Önce Stakeholder seçin.");
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
        "Talep gönderilemedi: " +
          (e?.message || String(e))
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
          </div>
        </Card>
      )}

      {/* RESULT */}
      {tab === "result" && (
        <>
          {(loading || anonLoading) && (
            <div style={{ marginTop: 12, fontWeight: 700 }}>
              {t("result.loading")}
            </div>
          )}
          {apiError && (
            <Card title={t("result.errorTitle")}>
              <div style={{ color: "#b91c1c" }}>{apiError}</div>
            </Card>
          )}
          {!loading && !apiError && ndbResult && (
            <>
              {ndbResult.actionResult ? (
                <>
                  <Card title={t("result.cards.result")}>
                    <div style={{ display: "grid", gap: 8 }}>
                                      <Field
                  label={t("result.fields.productName")}
                  value={ndbResult.actionResult.productName}
                />
                <Field
                  label={t("result.fields.gtin")}
                  value={ndbResult.actionResult.gtin}
                />
                <Field
                  label={t("result.fields.batchNumber")}
                  value={ndbResult.actionResult.batchNumber}
                />
                <Field
                  label={t("result.fields.serialNumber")}
                  value={ndbResult.actionResult.serialNumber}
                />
                <Field
                  label={t("result.fields.productionDate")}
                  value={formatISODateOnly(
                    ndbResult.actionResult.productionDate
                  )}
                />
                <Field
                  label={t("result.fields.expirationDate")}
                  value={formatISODateOnly(
                    ndbResult.actionResult.expirationDate
                  )}
                />
                <Field
                  label={t("result.fields.manufacturerName")}
                  value={ndbResult.actionResult.manufacturerName}
                />
                                <Field
                  label={t("result.fields.stakeHolderName")}
                  value={ndbResult.actionResult.stakeHolderName}
                />
                
          {/* Product State / Suspend / Expiry durumuna göre Satılabilir / Satılamaz paneli */}
{(() => {
  const ar = ndbResult.actionResult as any;

  // Suspend/Recall bayrağı
  const suspendedFlag = !!(
    ar.isSuspendedOrRecalled ??
    ar.IsSuspendedOrRecalled ??
    false
  );

  // Expired bayrağı
  const isExpiredFlag = !!(
    ar.isExpired ??
    ar.IsExpired ??
    false
  );

  // Son kullanma tarihi (yaklaşan SKT için)
  const expRaw =
    ar.expirationDate ??
    ar.ExpirationDate ??
    null;

  let daysLeft: number | null = null;
  if (!isExpiredFlag && expRaw) {
    const now = new Date();
    const exp = new Date(expRaw);
    if (!isNaN(exp.getTime())) {
      const diffMs = exp.getTime() - now.getTime();
      daysLeft = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }
  }

  // 1) ÜRÜN ASKIYA ALINMIŞ / GERİ ÇAĞRILMIŞSA → her zaman SATILAMAZ
  if (suspendedFlag) {
    const sri = ar.suspendRecallInfo ?? ar.SuspendRecallInfo ?? null;

    let reasonText = "";
    let start: string | null = null;
    let end: string | null = null;

    if (sri && typeof sri === "object") {
      reasonText =
        String(
          sri.reason ??
            sri.Reason ??
            sri.description ??
            sri.Description ??
            ""
        ).trim() || "";
      start =
        (sri.startDate ??
          sri.StartDate ??
          sri.start ??
          sri.Start) || null;
      end =
        (sri.endDate ??
          sri.EndDate ??
          sri.end ??
          sri.End) || null;
    } else if (sri != null) {
      reasonText = String(sri);
    }

    const lines: string[] = [];
    lines.push(
      "Bu ürünün satışları askıya alınmıştır veya geri çağrılmıştır."
    );
    if (reasonText) {
      lines.push(`Neden: ${reasonText}`);
    }

    let dateLine = "";
    if (start && end) {
      dateLine = `Geçerlilik: ${formatISODateOnly(
        start
      )} - ${formatISODateOnly(end)}`;
    } else if (start && !end) {
      dateLine = `Başlangıç: ${formatISODateOnly(start)}`;
    } else if (!start && end) {
      dateLine = `Bitiş: ${formatISODateOnly(end)}`;
    }
    if (dateLine) lines.push(dateLine);

    const description = lines.join("\n");

    const bg = "#991b1b"; // koyu kırmızı
    const border = "#f97373";

    return (
      <div
        style={{
          marginTop: 12,
          marginBottom: 4,
          padding: 14,
          borderRadius: 14,
          border: `1px solid ${border}`,
          background: bg,
          boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            fontWeight: 900,
            fontSize: 16,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "#ffffff",
          }}
        >
          SATILAMAZ
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 13,
            lineHeight: 1.5,
            fontWeight: 700,
            color: "#ffffff",
            whiteSpace: "pre-line",
          }}
        >
          {description}
        </div>
      </div>
    );
  }

  // 2) ÜRÜN SÜRESİ DOLMUŞSA → her zaman SATILAMAZ
  if (isExpiredFlag) {
    const bg = "#991b1b";
    const border = "#f97373";
    const description = "Bu ürünün son kullanım tarihi dolmuştur.";

    return (
      <div
        style={{
          marginTop: 12,
          marginBottom: 4,
          padding: 14,
          borderRadius: 14,
          border: `1px solid ${border}`,
          background: bg,
          boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            fontWeight: 900,
            fontSize: 16,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "#ffffff",
          }}
        >
          SATILAMAZ
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 13,
            lineHeight: 1.5,
            fontWeight: 700,
            color: "#ffffff",
            whiteSpace: "pre-line",
          }}
        >
          {description}
        </div>
      </div>
    );
  }

  // 3) Askıda değil ve süresi dolmamışsa → productState tablosuna göre çalış
  const rawState =
    ar.productState ??
    ar.ProductState ??
    null;

    const info = getProductStateSaleInfo(rawState);
  if (!info) return null;

  const stateNumber = Number(rawState);

  let title = info.title;
  let description = info.description;

  // ProductState = 9 ise, async olarak hesaplanan özel mesajı kullan
  if (stateNumber === 9) {
    if (productState9Loading) {
      description = "Bu ürün için transfer bilgisi kontrol ediliyor…";
    } else if (productState9Message) {
      description = productState9Message;
    }
  }


  // isExpired = false ve kalan süre 21 günden azsa → Satılabilir + ekstra metin
  if (info.isSellable && daysLeft != null && daysLeft >= 0 && daysLeft < 60) {
    title = "Satılabilir";
    const extra = `Bu ürünün son kullanma tarihine ${daysLeft} gün kalmıştır.`;
    description = `${info.description}\n${extra}`;
  }

  const bg = info.isSellable ? "#166534" : "#991b1b"; // koyu yeşil / koyu kırmızı
  const border = info.isSellable ? "#22c55e" : "#f97373";

  return (
    <div
      style={{
        marginTop: 12,
        marginBottom: 4,
        padding: 14,
        borderRadius: 14,
        border: `1px solid ${border}`,
        background: bg,
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        color: "#ffffff",
      }}
    >
      <div
        style={{
          fontWeight: 900,
          fontSize: 16,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "#ffffff",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          lineHeight: 1.5,
          fontWeight: 700,
          color: "#ffffff",
          whiteSpace: "pre-line",
        }}
      >
        {description}
      </div>
    </div>
  );
})()}


                    
                    </div>
                  </Card>

                  <Card title={t("result.cards.history")}>
                    {ndbResult.actionResult.productInquiryHistory?.length ? (
                      <div
                        style={{
                          overflowX: "auto",
                          marginTop: 6,
                        }}
                      >
                        <table
                          style={{
                            width: "100%",
                            fontSize: 12,
                            borderCollapse: "collapse",
                          }}
                        >
                          <thead>
                            <tr
                              style={{
                                textAlign: "left",
                                color: "#6b7280",
                              }}
                            >
                              <th style={{ padding: "6px" }}>
                                {
                                  t(
                                    "result.history.headers.declarationNumber"
                                  ) as any
                                }
                              </th>
                              <th style={{ padding: "6px" }}>
                                {t("result.history.headers.stakeHolder") as any}
                              </th>
                              <th style={{ padding: "6px" }}>
                                {t("result.history.headers.state") as any}
                              </th>
                              <th style={{ padding: "6px" }}>
                                {t("result.history.headers.stateDate") as any}
                              </th>
                              <th style={{ padding: "6px" }}>
                                {t("result.history.headers.price") as any}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {ndbResult.actionResult.productInquiryHistory!.map(
                              (h, i) => (
                                <tr
                                  key={i}
                                  style={{ borderTop: "1px solid #e5e7eb" }}
                                >
                                  <td style={{ padding: "6px" }}>
                                    {h.declarationNumber}
                                  </td>
                                  <td
                                    style={{
                                      padding: "6px",
                                      overflowWrap: "anywhere",
                                    }}
                                  >
                                    {h.stakeHolder}
                                  </td>
                                  <td style={{ padding: "6px" }}>
  {mapProductState(h.state)}
</td>

                                  <td style={{ padding: "6px" }}>
                                    {formatISO(h.stateDate)}
                                  </td>
                                  <td style={{ padding: "6px" }}>
                                    {h.price}
                                  </td>
                                </tr>
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ color: "#6b7280" }}>Geçmiş kaydı yok.</div>
                    )}
                  </Card>
                </>
              ) : (
                <Card title={t("result.cards.detail")}>
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid #fecaca",
                      background: "#fef2f2",
                      color: "#b91c1c",
                      fontWeight: 800,
                      fontSize: 14,
                      lineHeight: 1.5,
                      textAlign: "left",
                    }}
                  >
                    Bu ürün ile ilgili sistemde herhangi bir bilgi bulunamadı.
                  </div>
                </Card>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => setTab("home")}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                  }}
                >
                  Yeni İşlem
                </button>
                <button
                  onClick={startScan}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid #111",
                    background: "#111",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  Tekrar Tara
                </button>
              </div>
            </>
          )}
          {!loading && !anonLoading && !apiError && !ndbResult && (
            <Card>
              <div style={{ color: "#6b7280" }}>{t("result.empty")}</div>
            </Card>
          )}
        </>
      )}

      {/* RECEIVE */}
      {tab === "receive" && (
        <>
          <Card title="Receive • GetTransferDeclaration">
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {t("receive.datamatrixLabel")}
                </div>
                <textarea
                  value={receiveQr}
                  onChange={(e) => setReceiveQr(e.target.value)}
                  placeholder="010... ile başlayan ham QR/GS1 metni"
                  rows={3}
                  style={UI.textarea}
                />
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={scanForReceive}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                  }}
                >
                  Karekod Oku
                </button>
                <button
                  onClick={runReceiveFlow}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid #111",
                    background: "#111",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  Sorgula
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

                            {receiveLoading && (
                <div style={{ fontWeight: 700 }}>{t("result.loading")}</div>
              )}

              {!!receiveError && (
                <div
                  style={{
                    color: "#b91c1c",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {receiveError}
                </div>
              )}

              {receiveInfo && !receiveError && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "#ecfdf3",
                    color: "#166534",
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {receiveInfo}
                </div>
              )}

              {!receiveLoading && !receiveError && receiveData?.actionResult && (


                <>
                                    <Card title={t("receive.cardTitle")}>

                    {receiveData?.actionResult ? (
                      (() => {
                        const ar = receiveData.actionResult;
                        return (
                          <div style={{ display: "grid", gap: 8 }}>
                                                                                    <Field
                              label={t("receive.sender")}
                              value={stakeholderNameById(ar.fromStakeholder)}
                            />
                            <Field
                              label={t("receive.to")}
                              value={stakeholderNameById(ar.toStakeholder)}
                            />
                            <Field
                              label={t("receive.totalCount")}
                              value={ar.details?.length ?? 0}
                            />

                                                        {receiveDbg && receiveDbg.toStake != null && (
                              (() => {
                                const matched =
                                  receiveDbg.toStake === receiveDbg.myStk ||
                                  (receiveDbg.myPartner != null &&
                                    receiveDbg.toStake === receiveDbg.myPartner);

                                return (
                                  <div
                                    style={{
                                      fontWeight: 800,
                                      color: matched ? "#15803d" : "#b45309",
                                    }}
                                  >
                                                                        {matched
                                      ? t("receive.transferOk")
                                      : t("receive.transferMismatch")}

                                  </div>
                                );
                              })()
                            )}

                          </div>
                        );
                      })()
                    ) : (
                      <div style={{ color: "#6b7280" }}>Özet bilgisi yok.</div>
                    )}
                  </Card>

          {/* 🔹 Yeni açıklama metni (Details’in hemen üstünde) */}
          {receiveData?.actionResult?.documentNo &&
            receiveData.actionResult.documentDate && (
              <p
                style={{
                  marginTop: 8,
                  marginBottom: 4,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                Sorguladığınız ilaç{" "}
                <strong>{receiveData.actionResult.documentNo}</strong>{" "}
                numaralı ve{" "}
                <strong>
                  {formatISODateOnly(receiveData.actionResult.documentDate)}
                </strong>{" "}
                tarihli siparişin içerisinde yer almaktadır. Siparişin tümünü
                kabul etmek için <strong>Kabul et</strong> butonuna basınız.
              </p>
          )}


                  <Card title="Details (Brand • GTIN • Lot • Count)">
                    {receiveGroups.length ? (
                      <div style={{ overflowX: "auto" }}>
                        <table
                          style={{
                            width: "100%",
                            fontSize: 12,
                            borderCollapse: "collapse",
                          }}
                        >
                          <thead>
                            <tr
                              style={{
                                textAlign: "left",
                                color: "#6b7280",
                              }}
                            >
                              <th style={{ padding: 6 }}>Brand</th>
                              <th style={{ padding: 6 }}>GTIN</th>
                              <th style={{ padding: 6 }}>LOT</th>
                              <th style={{ padding: 6 }}>Count</th>
                            </tr>
                          </thead>
                          <tbody>
                            {receiveGroups.map((g, i) => (
                              <tr
                                key={i}
                                style={{
                                  borderTop: "1px solid #e5e7eb",
                                }}
                              >
                                <td
                                  style={{
                                    padding: 6,
                                    overflowWrap: "anywhere",
                                  }}
                                >
                                  {g.brand || "—"}
                                </td>
                                <td style={{ padding: 6 }}>
                                  {g.gtin || "—"}
                                </td>
                                <td style={{ padding: 6 }}>
                                  {g.lot || "—"}
                                </td>
                                <td
                                  style={{
                                    padding: 6,
                                    fontWeight: 700,
                                  }}
                                >
                                  {g.count}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ color: "#6b7280" }}>
                        Detay verisi bulunamadı.
                      </div>
                    )}
                                    </Card>

                  <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    {receiveAcceptMessage && (
                      <div
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: "#ecfdf3",
                          color: "#166534",
                          fontSize: 13,
                          fontWeight: 500,
                        }}
                      >
                        {receiveAcceptMessage}
                      </div>
                    )}

                    {receiveAcceptError && (
                      <div
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: "#fef2f2",
                          color: "#b91c1c",
                          fontSize: 13,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {receiveAcceptError}
                      </div>
                    )}

                                        {!receiveAccepted && (
                      <button
                        onClick={runReceiveAccept}
                        disabled={receiveAcceptLoading}
                        style={{
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: "1px solid #16a34a",
                          background: receiveAcceptLoading ? "#bbf7d0" : "#22c55e",
                          color: "#064e3b",
                          fontWeight: 700,
                        }}
                      >
                        {receiveAcceptLoading ? "Kabul ediliyor..." : "Kabul et"}
                      </button>
                    )}

                  </div>
                </>


                
              )}
            </div>
          </Card>
        </>
      )}

                   {tab === "stock" && !stockActive && (
        <>
          {/* Detaylı liste: Her okutulan karekod satır satır */}
          <Card title="Stok Sayım Detaylı Liste">
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                Toplam okunan karekod:{" "}
                <strong>{stockItems.length}</strong>
              </div>

              {stockLog.length ? (
                <div style={{ overflowX: "auto", marginTop: 6 }}>
                  <table
                    style={{
                      width: "100%",
                      fontSize: 12,
                      borderCollapse: "collapse",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          textAlign: "left",
                          color: "#6b7280",
                        }}
                      >
                        <th style={{ padding: 6 }}>#</th>
                        <th style={{ padding: 6 }}>Brand</th>
                        <th style={{ padding: 6 }}>SN</th>
                        <th style={{ padding: 6 }}>Durum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockLog.map((item, i) => {
                        let bg = "#f3f4f6"; // default gri
                        let color = "#111827";
                        let durumText = "Bilinmiyor / Hata";

                        if (item.status === "sellable") {
                          bg = "#dcfce7"; // açık yeşil
                          color = "#166534"; // koyu yeşil
                          durumText = "Satılabilir";
                        } else if (item.status === "nonsellable") {
                          bg = "#fee2e2"; // açık kırmızı
                          color = "#b91c1c"; // koyu kırmızı
                          durumText = "Satılamaz";
                        } else {
                          // error
                          bg = "#f3f4f6";
                          color = "#4b5563";
                          durumText = "Durum bilinmiyor / sorgu hatası";
                        }

                        return (
                          <tr
                            key={i}
                            style={{
                              borderTop: "1px solid #e5e7eb",
                              background: bg,
                              color,
                            }}
                          >
                            <td style={{ padding: 6 }}>{i + 1}</td>
                            <td
                              style={{
                                padding: 6,
                                overflowWrap: "anywhere",
                              }}
                            >
                              {item.brand || "—"}
                            </td>
                            <td style={{ padding: 6 }}>
                              {item.sn || "—"}
                            </td>
                            <td style={{ padding: 6 }}>
                              <div style={{ fontWeight: 700 }}>
                                {durumText}
                              </div>
                              {item.description && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    marginTop: 2,
                                    whiteSpace: "pre-line",
                                  }}
                                >
                                  {item.description}
                                </div>
                              )}
                              {item.note && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    marginTop: 2,
                                    color: "#4b5563",
                                  }}
                                >
                                  {item.note}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ color: "#6b7280", marginTop: 4 }}>
                  Henüz tarama yapılmamış.
                </div>
              )}

              {/* Kaydet / Geri butonları */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 10,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={saveStockCounting}
                  disabled={!stockItems.length}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #111",
                    background: "#111",
                    color: "#fff",
                    fontWeight: 800,
                  }}
                >
                  Kaydet (CSV)
                </button>
                <button
                  onClick={() => setTab("home")}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    fontWeight: 700,
                  }}
                >
                  Geri
                </button>
              </div>
            </div>
          </Card>

          {/* Özet: Brand + Count (GTIN / LOT YOK) */}
          <Card title="Stok Sayım Özeti">
            <div style={{ display: "grid", gap: 8 }}>
              {stockSummary.length ? (
                <div style={{ overflowX: "auto", marginTop: 6 }}>
                  <table
                    style={{
                      width: "100%",
                      fontSize: 12,
                      borderCollapse: "collapse",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          textAlign: "left",
                          color: "#6b7280",
                        }}
                      >
                        <th style={{ padding: 6 }}>Brand</th>
                        <th style={{ padding: 6 }}>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockSummary.map((g, i) => (
                        <tr
                          key={i}
                          style={{ borderTop: "1px solid #e5e7eb" }}
                        >
                          <td
                            style={{
                              padding: 6,
                              overflowWrap: "anywhere",
                            }}
                          >
                            {g.brand || "—"}
                          </td>
                          <td
                            style={{
                              padding: 6,
                              fontWeight: 700,
                            }}
                          >
                            {g.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ color: "#6b7280", marginTop: 4 }}>
                  Henüz tarama yapılmamış.
                </div>
              )}
            </div>
          </Card>
        </>
      )}


      {/* STOCK COUNTING alt panel */}
      {stockActive && (
        <div className="scan-panel-25">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={stopStockCounting}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #b91c1c",
                background: "#fff",
                color: "#b91c1c",
                fontWeight: 800,
              }}
            >
              Durdur
            </button>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Okuma: <strong>{stockItems.length}</strong>{" "}
              {stockBusy ? "• Okuma bekleniyor…" : ""}
            </div>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: 8,
              }}
            >
              <button
                onClick={saveStockCounting}
                disabled={!stockItems.length}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #111",
                  background: "#111",
                  color: "#fff",
                  fontWeight: 800,
                }}
              >
                Kaydet (CSV)
              </button>
              <button
                onClick={() => setTab("home")}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  fontWeight: 700,
                }}
              >
                Geri
              </button>
            </div>
          </div>

          {!!stockError && (
            <div
              style={{
                color: "#b91c1c",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {stockError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
