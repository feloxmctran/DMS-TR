// src/pages/EasyPage.tsx
import React, { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { FastStockScanner } from "../plugins/fastStockScanner";

type EasySaleRecord = {
  id: number;
  createdAt: string;
  patient: string;
  citizenId: string;
  prescriptionNumber: string;
  note: string;
  items: {
    barcode: string;
    brand: string;
    sn: string;
    status: "sellable" | "nonsellable" | "error";
    description?: string;
    note?: string;

    // Fiyat ve kısmi miktar (history detail için)
    unitPrice?: string;
    partialAmount?: string;

    // NDB satış bildirimi sonucu (geçmiş kayıt için)
    ndbSuccess?: boolean | null;
    ndbMessage?: string | null;
  }[];
};



type EasyDailyCsvPayload = {
  dateKey: string;
  label: string;
  ids: number[];
};

type EasyPageProps = {
  onBack: () => void;
  resolving: boolean;
  onDone: (codes: string[]) => void;
  onOpenHistorySale?: (sale: EasySaleRecord) => void;
  // 🔹 yeni: günlük CSV isteğini App.tsx’e aktarmak için
  onExportDailyCsv?: (payload: EasyDailyCsvPayload) => void | Promise<void>;
};

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

const EasyPage: React.FC<EasyPageProps> = ({
  onBack,
  onDone,
  resolving,
  onOpenHistorySale,
  onExportDailyCsv,
}) => {
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [easySales, setEasySales] = useState<
    { id: number; created_at: string; item_count: number; note?: string }[]
  >([]);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!Capacitor.isNativePlatform()) return;
      try {
        // Native plugin'den easy satış listesi
        // @ts-ignore
        const res = await (FastStockScanner as any).getEasySales();
        const list =
          res && Array.isArray(res.sales)
            ? (res.sales as {
                id: number;
                created_at: string;
                item_count: number;
                note?: string;
              }[]).map((s) => ({
                id: s.id,
                created_at: s.created_at,
                item_count: s.item_count,
                note: s.note ?? "",
              }))
            : [];

        if (!cancelled) {
          setEasySales(list);
        }
      } catch (err) {
        console.warn("Easy satış listesi okunamadı:", err);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleScan = async () => {
    try {
      if (!Capacitor.isNativePlatform()) {
        alert("Bu özellik sadece gerçek cihazda çalışır.");
        return;
      }

      setBusy(true);

      const res = await FastStockScanner.startMultiScan({
        durationMs: 2500,
        skipNote: true,
      });

      const values = Array.from(new Set(res?.barcodes ?? [])).filter(Boolean);

      if (!values.length) {
        alert("Hiç karekod okunamadı.");
        setCodes([]);
        return;
      }

      onDone(values);
    } catch (err: any) {
      alert("Easy modunda tarama hatası: " + (err?.message || String(err)));
    } finally {
      setBusy(false);
    }
  };

    const handleOpenSale = async (saleId: number) => {
    if (!onOpenHistorySale) {
      return;
    }

    if (!Capacitor.isNativePlatform()) {
      alert("Easy satış detayı sadece gerçek cihazda görüntülenebilir.");
      return;
    }

    try {
      // Native plugin'den detay çek
      // @ts-ignore
      const res = await (FastStockScanner as any).getEasySaleDetail({
        id: saleId,
      });

      const rawItems = Array.isArray(res.items) ? res.items : [];

      const record: EasySaleRecord = {
        id: res.id,
        createdAt: res.createdAt,
        patient: res.patient ?? "",
        citizenId: res.citizenId ?? "",
        prescriptionNumber: res.prescriptionNumber ?? "",
        note: res.note ?? "",
        items: rawItems.map((it: any) => ({
          barcode: it.barcode ?? "",
          brand: it.brand ?? "",
          sn: it.sn ?? "",
          status:
            it.status === "sellable" || it.status === "nonsellable"
              ? it.status
              : "error",
          description: it.description ?? "",
          note: it.note ?? "",

          // Native’ten gelen alan isimlerine göre oku
          unitPrice: it.unitPrice ?? it.unit_price ?? "",
          partialAmount: it.partialAmount ?? it.partial_amount ?? "",

          // 🔹 NDB satış bildirimi sonucu (plugin artık bunları döndürüyor)
          ndbSuccess:
            typeof it.ndbSuccess === "boolean" ? it.ndbSuccess : null,
          ndbMessage: it.ndbMessage ?? null,
        })),
      };

      onOpenHistorySale(record);
    } catch (err: any) {
      console.error("Easy satış detayı okunamadı:", err);
      alert("Easy satış detayı okunamadı: " + (err?.message || String(err)));
    }
  };


  // Gün bazlı gruplanmış liste
  const groupedEasySalesByDate = React.useMemo(() => {
    const groupsMap: Record<string, { label: string; items: any[] }> = {};

    easySales.forEach((s) => {
      const d = new Date(s.created_at);
      if (isNaN(d.getTime())) return;

      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");

      const dateKey = `${yyyy}-${mm}-${dd}`;
      const label = `${dd}.${mm}.${yyyy}`;

      if (!groupsMap[dateKey]) {
        groupsMap[dateKey] = { label, items: [] };
      }
      groupsMap[dateKey].items.push(s);
    });

    return Object.entries(groupsMap)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, value]) => ({
        dateKey,
        label: value.label,
        items: value.items,
      }));
  }, [easySales]);

  const handleProceed = () => {
    if (!codes.length) {
      alert("Henüz karekod yok.");
      return;
    }

    onDone(codes);
  };

  // 🔹 Günlük CSV isteğini App.tsx’e ileten handler
  const handleDownloadCsvForGroup = (group: {
    dateKey: string;
    label: string;
    items: any[];
  }) => {
    if (!onExportDailyCsv) {
      alert("Günlük CSV özeti bu sürümde tanımlı değil.");
      return;
    }

    const ids = group.items
      .map((s: any) => Number(s.id))
      .filter((n) => !Number.isNaN(n));

    if (!ids.length) {
      alert("Bu gün için kayıt bulunamadı.");
      return;
    }

    onExportDailyCsv({
      dateKey: group.dateKey,
      label: group.label,
      ids,
    });
  };

  return (
    <div
      style={{
  minHeight: "100vh",
  background: "#f3f4f6",
  padding: 16,
  paddingTop: 72,
  maxWidth: 1100,
  margin: "0 auto",
}}

    >
      {/* Üst bar */}
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
            EASY
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
            }}
          >
            Easy Liste
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
            onClick={handleScan}
            disabled={busy}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #0f766e",
              background: busy ? "#6b7280" : "#0d9488",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Taranıyor..." : "Start"}
          </button>
        </div>
      </div>

{resolving && (
        <div
          style={{
            marginTop: 12,
            fontSize: 14,
            fontWeight: 600,
            color: "#2563eb",
          }}
        >
          İlaçlar sorgulanıyor, lütfen bekleyiniz...
        </div>
      )}

      {/* EASY satış kayıtları listesi */}
      <Card title="Easy Satış Kayıtları">
        {easySales.length === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 14 }}>
            Henüz kayıtlı easy satışı yok.
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {groupedEasySalesByDate.map((group) => (
              <div
                key={group.dateKey}
                style={{
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                  padding: 8,
                }}
              >
                {/* Gün başlığı + CSV butonu */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#374151",
                    }}
                  >
                    {group.label}
                  </div>

                  <button
                    onClick={() => handleDownloadCsvForGroup(group)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 8,
                      border: "1px solid #1d4ed8",
                      background: "#2563eb",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    Günlük CSV (GTIN)
                  </button>
                </div>

                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12,
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "6px 8px",
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        ID
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "6px 8px",
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Saat
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "6px 8px",
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Not
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: "6px 8px",
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        Kutu sayısı
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((s: any) => {
                      const saat = new Date(
                        s.created_at
                      ).toLocaleTimeString("tr-TR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      });

                      return (
                        <tr
                          key={s.id}
                          style={{
                            cursor: "pointer",
                            background: "transparent",
                          }}
                          onClick={() => handleOpenSale(s.id)}
                        >
                          <td
                            style={{
                              padding: "6px 8px",
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            {s.id}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            {saat}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            {s.note || "—"}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              borderBottom: "1px solid #f3f4f6",
                              textAlign: "right",
                            }}
                          >
                            {s.item_count}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Card>

      

      {/* Satış ekranına geç butonu */}
      {codes.length > 0 && (
        <button
          onClick={handleProceed}
          style={{
            marginTop: 20,
            width: "100%",
            padding: "12px 0",
            background: "#2563eb",
            borderRadius: 10,
            border: "1px solid #1d4ed8",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          Satış ekranına geç
        </button>
      )}
    </div>
  );
};

export default EasyPage;
