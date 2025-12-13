// src/pages/FastPage.tsx
import { Preferences } from "@capacitor/preferences";

import React, { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { FastStockScanner } from "../plugins/fastStockScanner";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

import FastStockReportPage from "./FastStockReportPage";


import type {
  ScanSession,
  GetStockReportResult,
  StockReportRow,
} from "../plugins/fastStockScanner";

type FastPageProps = {
  onBack: () => void;
};

/** Küçük Card bileşeni */
const Card: React.FC<React.PropsWithChildren<{ title?: string }>> = ({
  title,
  children,
}) => (
  <div
    style={{
      background: "#ffffff",
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
      boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      border: "1px solid #e5e7eb",
    }}
  >
    {title && (
      <div
        style={{
          fontWeight: 800,
          fontSize:
            typeof window !== "undefined" && window.innerWidth >= 1024
              ? 16
              : 14,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
    )}
    {children}
  </div>
);

const isNative = () => Capacitor.isNativePlatform();

/** App.tsx'tekine benzer tarih formatı */
function formatTRDateTime(input: string | number | Date) {
  const d = new Date(input);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${hh}.${mi}`;
}

/** Cihaz ID'nin sadece son 5 hanesini gösterir */
function formatDeviceId(id?: string | null) {
  if (!id) return "—";
  const trimmed = id.trim();
  if (trimmed.length <= 5) return trimmed;
  return "…" + trimmed.slice(-5);
}

/** CSV alanı kaçışlama (TR Excel için ; ayırıcı) */
function csvEscape(value: string): string {
  const v = String(value ?? "")
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ");

  if (v.includes(";") || v.includes('"')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/** Verilen satırlardan CSV oluşturur ve platforma göre kaydeder/indirir (UTF-8 + BOM) */
async function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
  const csvWithBom = "\uFEFF" + csv;

  // Native (Android/iOS): Documents'a yazma -> Cache'e yaz + Share ile kaydet/paylaş
  if (Capacitor.isNativePlatform()) {
    try {
      const safeName = filename.endsWith(".csv") ? filename : `${filename}.csv`;

      await Filesystem.writeFile({
        path: safeName,
        data: csvWithBom,
        directory: Directory.Cache,     // ✅ izin istemez
        encoding: Encoding.UTF8,
      });

      const { uri } = await Filesystem.getUri({
        path: safeName,
        directory: Directory.Cache,
      });

      await Share.share({
        title: safeName,
        text: "CSV dosyası",
        url: uri,
        dialogTitle: "CSV'yi kaydet / paylaş",
      });

      return;
    } catch (e: any) {
      console.error("CSV yazılırken hata:", e);
      alert(
        "CSV dosyası kaydedilemedi: " +
          (e?.message || e?.toString?.() || "bilinmeyen hata")
      );
      return;
    }
  }

  // Web tarafında dosya indirme
  if (typeof window === "undefined") return;

  const blob = new Blob([csvWithBom], {
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
}





const FastPage: React.FC<FastPageProps> = ({ onBack }) => {
  const [scanSessions, setScanSessions] = useState<ScanSession[]>([]);
  const [scanSessionsLoading, setScanSessionsLoading] = useState(false);
  const [stockReport, setStockReport] = useState<GetStockReportResult | null>(
    null
  );
  const [stockReportLoading, setStockReportLoading] = useState(false);
    const [showReportPage, setShowReportPage] = useState(false);


  // Fast multi-scan ile SQLite'e kaydedilen oturumları okur
  const loadFastScanSessions = async () => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      setScanSessionsLoading(true);
      const res = await FastStockScanner.getScanSessions();
      setScanSessions(res.sessions ?? []);
    } catch (err: any) {
      console.error(err);
      const msg =
        typeof err === "string"
          ? err
          : err?.message || JSON.stringify(err ?? "");
      alert("Fast sayım oturumları yüklenirken hata: " + msg);
    } finally {
      setScanSessionsLoading(false);
    }
  };

  // FastStockScanner native plugin'i ile çoklu tarama (Stock Count Fast)
  const handleStart = async () => {
    try {
      if (!Capacitor.isNativePlatform()) {
        alert("Bu özellik sadece gerçek cihazda (Android/iOS) çalışır.");
        return;
      }

      // 2 saniyelik tarama
      const res = await FastStockScanner.startMultiScan({
        durationMs: 2000,
      });

      const values = Array.from(new Set(res?.barcodes ?? [])).filter(Boolean);

      if (!values.length) {
        alert("Hiç karekod okunamadı.");
        return;
      }

      // Başarılı durumda popup göstermiyoruz, sadece listeyi yeniliyoruz
      loadFastScanSessions();
    } catch (err: any) {
      const msg =
        typeof err === "string"
          ? err
          : err?.message || JSON.stringify(err ?? "");
      alert("FastStockScanner hata: " + msg);
    }
  };

  // Bir oturumu sil
  const handleDeleteSession = async (id: number) => {
    if (!Capacitor.isNativePlatform()) {
      alert("Silme sadece gerçek cihazda (Android/iOS) çalışır.");
      return;
    }

    const ok = window.confirm(`Oturum #${id} silinsin mi?`);
    if (!ok) return;

    try {
      // 🔴 Burada mutlaka { id } objesi gönderiliyor
      await FastStockScanner.deleteScanSession({ id });

      await loadFastScanSessions();
    } catch (err: any) {
      console.error(err);
      const msg =
        typeof err === "string"
          ? err
          : err?.message || JSON.stringify(err ?? "");
      alert("Oturum silinirken hata oluştu: " + msg);
    }
  };

    // Tüm oturumlardan stok raporu oluştur ve RAPOR SAYFASINI aç
  const handleBuildStockReport = async () => {
    if (!Capacitor.isNativePlatform()) {
      alert("Stok raporu sadece gerçek cihazda (Android/iOS) çalışır.");
      return;
    }

    if (!scanSessions.length) {
      alert("Önce en az bir Fast sayım oturumu kaydetmelisiniz.");
      return;
    }

    // Eğer daha önce rapor oluşturulduysa yeniden API çağırmadan sayfayı aç
    if (stockReport && stockReport.items && stockReport.items.length > 0) {
      setShowReportPage(true);
      return;
    }

    try {
      setStockReportLoading(true);
      const sessionIds = scanSessions.map((s) => s.id);
      const res = await FastStockScanner.getStockReport({ sessionIds });
      setStockReport(res);
      setShowReportPage(true);
    } catch (err: any) {
      console.error(err);
      const msg =
        typeof err === "string"
          ? err
          : err?.message || JSON.stringify(err ?? "");
      alert("Stok raporu oluşturulurken hata: " + msg);
    } finally {
      setStockReportLoading(false);
    }
  };

// Stok raporunu (tüm oturumlar) CSV'ye aktar
const handleExportStockReportCsv = async () => {
  if (!stockReport || !stockReport.items || stockReport.items.length === 0) {
    alert("Önce stok raporu oluşturmalısınız.");
    return;
  }

  const header = ["UrunAdi", "GTIN", "BenzersizKutu"];
  const rows = stockReport.items.map((row: StockReportRow) => [
    row.brand_name || "",
    row.gtin || "",
    String(row.distinctCount ?? 0),
  ]);

  await downloadCsv("stok_raporu_tum_oturumlar.csv", [header, ...rows]);

    alert(
    "CSV hazırlandı. Açılan paylaş/kaydet ekranından Dosyalar/Drive/WhatsApp ile kaydedebilirsiniz."
  );
};




   // Tüm datamatrixleri CSV'ye aktar (native pluginde getAllScanItems olması bekleniyor)
  const handleExportAllDatamatrixCsv = async () => {
    try {
      if (!Capacitor.isNativePlatform()) {
        alert("Bu özellik sadece gerçek cihazda (Android/iOS) çalışır.");
        return;
      }

      // Tip hatasını engellemek için any cast
      const anyScanner: any = FastStockScanner;
      const res = await anyScanner.getAllScanItems?.();

      const codesRaw: string[] = Array.isArray(res?.codes)
  ? res.codes
  : Array.isArray(res?.datamatrixes)
  ? res.datamatrixes
  : [];

// ✅ unique + boş temizliği
const codes = Array.from(
  new Set(
    codesRaw
      .map((s) => String(s || "").trim())
      .filter((s) => s.length > 0)
  )
);

if (!codes.length) {
  alert("Kayıtlı karekod bulunamadı.");
  return;
}

const header = ["Datamatrix"];
const rows = codes.map((code) => [code]);


      await downloadCsv("tum_datamatrixler.csv", [header, ...rows]);

      alert(
  `CSV hazırlandı. Benzersiz datamatrix: ${codes.length}\n` +
  "Açılan paylaş/kaydet ekranından Dosyalar/Drive/WhatsApp ile kaydedebilirsiniz."
);


    } catch (err: any) {
      const msg =
        typeof err === "string"
          ? err
          : err?.message || JSON.stringify(err ?? "");
      alert(
        "Datamatrix CSV oluşturulurken hata: " +
          msg +
          "\n\nNative FastStockScanner tarafında getAllScanItems metodunun tanımlı olduğundan emin olun."
      );
    }
  };

   
  // Sayfa açıldığında oturumları yükle
  useEffect(() => {
  if (!isNative()) return;
  importInitialProductsOnce();   // ✅ EKLE
  loadFastScanSessions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);


  if (showReportPage) {
    return (
      <FastStockReportPage
        onBack={() => setShowReportPage(false)}
        stockReport={stockReport}
        onExportStockReportCsv={handleExportStockReportCsv}
        onExportAllDatamatrixCsv={handleExportAllDatamatrixCsv}
      />
    );
  }


  return (
  <div
    style={{
      minHeight: "100vh",
      background: "#f3f4f6",
      padding: 16,
      paddingTop: 56,
      maxWidth: 1100,
      margin: "0 auto",
    }}
  >


      {/* Üst bar: başlık + Geri + Start */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#6b7280",
              letterSpacing: 1,
            }}
          >
            FAST COUNT
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
            }}
          >
            Fast Sayım Oturumları
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onBack}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Geri
          </button>
          <button
            onClick={handleStart}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #16a34a",
              background: "#16a34a",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            Start
          </button>
        </div>
      </div>

      {isNative() ? (
        <Card title="Fast Sayım Oturumları">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13 }}>
              Kaydedilmiş oturum sayısı:{" "}
              <strong>{scanSessions.length}</strong>
            </div>
                        <div style={{ fontSize: 13 }}>
              Tüm oturumlarda okutulan toplam kutu:{" "}
              <strong>
                {scanSessions.reduce((sum, s) => sum + (s.total_count || 0), 0)}
              </strong>
            </div>

            <button
              onClick={loadFastScanSessions}
              disabled={scanSessionsLoading}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {scanSessionsLoading ? "Yükleniyor…" : "Oturumları Yenile"}
            </button>
            <button
              onClick={handleBuildStockReport}
              disabled={stockReportLoading || scanSessions.length === 0}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid #0ea5e9",
                background: "#0ea5e9",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {stockReportLoading
                ? "Rapor hazırlanıyor…"
                : "Stok Raporu (tüm oturumlar)"}
            </button>
          </div>

          {scanSessions.length === 0 ? (
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              Henüz Fast sayım oturumu kaydedilmemiş.
            </div>
          ) : (
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
                    <th style={{ padding: 6 }}>ID</th>
                    <th style={{ padding: 6 }}>Tarih</th>
                    <th style={{ padding: 6 }}>Toplam</th>
                    <th style={{ padding: 6 }}>Cihaz</th>
                    <th style={{ padding: 6 }}>Not</th>
                    <th style={{ padding: 6 }}>Sil</th>
                  </tr>
                </thead>
                <tbody>
                  {scanSessions.map((s) => (
                    <tr
                      key={s.id}
                      style={{ borderTop: "1px solid #e5e7eb" }}
                    >
                      <td style={{ padding: 6 }}>{s.id}</td>
                      <td style={{ padding: 6 }}>
                        {formatTRDateTime(s.created_at)}
                      </td>
                      <td style={{ padding: 6, fontWeight: 700 }}>
                        {s.total_count}
                      </td>
                      <td style={{ padding: 6 }}>
                        {formatDeviceId(s.device_id)}
                      </td>
                      <td style={{ padding: 6 }}>
                        {s.note && s.note.trim() ? s.note : "—"}
                      </td>
                      <td style={{ padding: 6 }}>
                        <button
                          onClick={() => handleDeleteSession(s.id)}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 8,
                            border: "1px solid #ef4444",
                            background: "#fee2e2",
                            color: "#b91c1c",
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          Sil
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

           
        </Card>
      ) : (
        <Card>
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            Fast sayım oturumları sadece gerçek cihazda (Android/iOS)
            listelenir.
          </div>
        </Card>
      )}
    </div>
  );
};


const importInitialProductsOnce = async () => {
  if (!Capacitor.isNativePlatform()) return;

  // aynı cihazda sürekli import etmesin
  const flagKey = "fast_products_imported_v1";
  const already = await Preferences.get({ key: flagKey });
  if (already.value === "1") return;

  // public/initial_products.json → fetch ile oku
  const res = await fetch("/initial_products.json", { cache: "no-store" });
  if (!res.ok) {
    alert("initial_products.json okunamadı: " + res.status);
    return;
  }

  const json = await res.json();
  const items = Array.isArray(json?.items) ? json.items : [];

  if (!items.length) {
    alert("initial_products.json içindeki items boş geldi.");
    return;
  }

  const result = await (FastStockScanner as any).importInitialProducts({ items });

  const count = result?.count ?? result?.countInserted ?? result?.inserted ?? 0;
  await Preferences.set({ key: flagKey, value: "1" });

  alert("Ürün kataloğu içe aktarıldı. Yazılan kayıt: " + count);
};

export default FastPage;
