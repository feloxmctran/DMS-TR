// src/pages/EasyFinalPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { StockScanLog } from "../App";

type EasyItemWithExtras = StockScanLog & {
  unitPrice?: string;      // satır için opsiyonel fiyat
  partialAmount?: string;  // satır için opsiyonel kısmi satış miktarı

  // NDB satış bildirimi sonucu (geçmiş kayıt için)
  ndbSuccess?: boolean | null;
  ndbMessage?: string | null;
};


type EasyFinalPageProps = {
  onBack: () => void;
  items: StockScanLog[];
  initialNote: string;

  // history’den gelirken doldurmak için
  initialPatient?: string;
  initialCitizenId?: string;
  initialPrescriptionNumber?: string;

  // geçmiş kaydı görüntüleme modunda alanlar kilitlensin
  readOnly?: boolean;

  // satış butonu
    onSale?: (payload: {
    patient: string;
    citizenId: string;
    prescriptionNumber: string;
    note: string;
    items: EasyItemWithExtras[];
  }) => Promise<
    | void
    | {
        qrCode: string;
        success: boolean;
        message: string;
      }[]
  >;


  // liste değişince App.tsx içindeki easyItems’ı da güncelle
  onChangeItems?: (items: StockScanLog[]) => void;

  // “Ekle” butonuna basınca kamera açılsın
  onAddMore?: () => void;
};

const EasyFinalPage: React.FC<EasyFinalPageProps> = ({
  onBack,
  items,
  initialNote,
  initialPatient,
  initialCitizenId,
  initialPrescriptionNumber,
  readOnly = false,
  onSale,
  onChangeItems,
  onAddMore,
}) => {
  const [patient, setPatient] = useState(initialPatient ?? "");
  const [citizenId, setCitizenId] = useState(initialCitizenId ?? "");
  const [prescriptionNumber, setPrescriptionNumber] = useState(
    initialPrescriptionNumber ?? ""
  );
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState(false);

  // ✅ Burada tip artık "dizi"
  const [localItems, setLocalItems] = useState<EasyItemWithExtras[]>(
    (items ?? []) as EasyItemWithExtras[]
  );

  // NDB SalesDeclaration sonuçları (qrCode = item.raw üzerinden)
  const [declarationResults, setDeclarationResults] = useState<
    Record<
      string,
      {
        success: boolean;
        message: string;
      }
    >
  >({});

  // Fiyat / kısmi satış düzenleme popup'ı için
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editPartialAmount, setEditPartialAmount] = useState("");

  const openEditForIndex = (index: number) => {
    const item = localItems[index];
    setEditPrice(item.unitPrice ?? "");
    setEditPartialAmount(item.partialAmount ?? "");
    setEditingIndex(index);
  };

  const closeEdit = () => {
    setEditingIndex(null);
    setEditPrice("");
    setEditPartialAmount("");
  };

  const handleSaveEdit = () => {
    if (editingIndex === null) return;

    setLocalItems((prev) => {
      const next = [...prev];
      const current = next[editingIndex];

      next[editingIndex] = {
        ...current,
        unitPrice: editPrice.trim(),
        partialAmount: editPartialAmount.trim(),
      };

      if (onChangeItems) onChangeItems(next as StockScanLog[]);
      return next;
    });

    closeEdit();
  };

  // App.tsx’ten easyItems değişirse (ör. Ekle ile yeni ilaçlar eklenince)
  // local listeyi sync et
  useEffect(() => {
    setLocalItems((items ?? []) as EasyItemWithExtras[]);
  }, [items]);

    // 🔹 Geçmiş kaydı (readOnly) açarken, DB'den gelen ndbSuccess/ndbMessage
  // alanlarından declarationResults haritasını otomatik kur.
  useEffect(() => {
    if (!readOnly) return;

    const map: Record<
      string,
      {
        success: boolean;
        message: string;
      }
    > = {};

    for (const it of localItems) {
      const key = it.raw || "";
      if (!key) continue;

      if (typeof it.ndbSuccess === "boolean") {
        map[key] = {
          success: it.ndbSuccess,
          message: it.ndbSuccess
            ? "Bildirim yapıldı."
            : it.ndbMessage || "Bildirim yapılamadı.",
        };
      } else if (it.ndbMessage) {
        // Success bilgisi yok ama mesaj var ise: başarısız say
        map[key] = {
          success: false,
          message: it.ndbMessage,
        };
      }
    }

    setDeclarationResults(map);
  }, [readOnly, localItems]);


  // özet sayılar
  const { totalCount, sellableCount, nonsellableCount, unknownCount } =
    useMemo(() => {
      let total = 0;
      let sell = 0;
      let non = 0;
      let unk = 0;
      for (const it of localItems) {
        total++;
        if (it.status === "sellable") sell++;
        else if (it.status === "nonsellable") non++;
        else unk++;
      }
      return {
        totalCount: total,
        sellableCount: sell,
        nonsellableCount: non,
        unknownCount: unk,
      };
    }, [localItems]);

  const handleRemove = (index: number) => {
    if (readOnly) return; // geçmiş kaydı görüntülerken silme yok
    setLocalItems((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (onChangeItems) onChangeItems(next as StockScanLog[]);
      return next;
    });
  };

  

    const handleSubmit = async () => {
    if (!onSale) return;
    if (!localItems.length) {
      alert("Satış yapmadan önce listede en az bir ilaç olmalı.");
      return;
    }

    setBusy(true);
    try {
      const result = await onSale({
        patient: patient.trim(),
        citizenId: citizenId.trim(),
        prescriptionNumber: prescriptionNumber.trim(),
        note: note.trim(),
        items: localItems,
      });

      // App.tsx'teki handleEasySale, her ürün için
      // { qrCode, success, message } listesi döndürecek.
      if (Array.isArray(result)) {
        const map: Record<
          string,
          {
            success: boolean;
            message: string;
          }
        > = {};

        for (const r of result) {
          if (!r.qrCode) continue;
          map[r.qrCode] = {
            success: r.success,
            message: r.message,
          };
        }

        setDeclarationResults(map);
      }
    } catch (err: any) {
      alert("Satış sırasında hata: " + (err?.message || String(err || "")));
    } finally {
      setBusy(false);
    }
  };

  return (
  <div
    style={{
  minHeight: "100vh",
  background: "#f3f4f6",
  padding: 16,
  paddingTop: 72,
  paddingBottom: 110,
  maxWidth: 1100,
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
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
            Easy Satış Özeti
          </div>
        </div>

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
      </div>

      {/* Hasta / reçete bilgileri */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: 16,
          padding: 16,
          marginBottom: 20,
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          border: "1px solid #e5e7eb",
        }}
      >
        <div
          style={{
            fontWeight: 800,
            fontSize: 15,
            marginBottom: 12,
          }}
        >
          Reçete / Hasta Bilgileri
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {/* Patient */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "130px 1fr",
              alignItems: "center",
              columnGap: 8,
            }}
          >
            <div style={{ fontSize: 13 }}>Patient</div>
            <input
              value={patient}
              onChange={(e) => setPatient(e.target.value)}
              disabled={readOnly}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: 14,
                backgroundColor: readOnly ? "#f9fafb" : "#ffffff",
              }}
            />
          </div>

          {/* Citizen Id */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "130px 1fr",
              alignItems: "center",
              columnGap: 8,
            }}
          >
            <div style={{ fontSize: 13 }}>Citizen Id</div>
            <input
              value={citizenId}
              onChange={(e) => setCitizenId(e.target.value)}
              disabled={readOnly}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: 14,
                backgroundColor: readOnly ? "#f9fafb" : "#ffffff",
              }}
            />
          </div>

          {/* Prescription Number */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "130px 1fr",
              alignItems: "center",
              columnGap: 8,
            }}
          >
            <div style={{ fontSize: 13 }}>Prescription Number</div>
            <input
              value={prescriptionNumber}
              onChange={(e) => setPrescriptionNumber(e.target.value)}
              disabled={readOnly}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: 14,
                backgroundColor: readOnly ? "#f9fafb" : "#ffffff",
              }}
            />
          </div>

          {/* Not */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "130px 1fr",
              alignItems: "flex-start",
              columnGap: 8,
              marginTop: 6,
            }}
          >
            <div style={{ fontSize: 13, marginTop: 4 }}>Not</div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={readOnly}
              rows={2}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: 14,
                resize: "vertical",
                backgroundColor: readOnly ? "#f9fafb" : "#ffffff",
              }}
            />
          </div>
        </div>
      </div>

      {/* İlaç listesi */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: 16,
          padding: 16,
          marginBottom: 20,
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          border: "1px solid #e5e7eb",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontWeight: 800,
              fontSize: 15,
            }}
          >
            İlaçlar
          </div>

          {/* Özet */}
          <div style={{ fontSize: 12, color: "#4b5563" }}>
            Toplam:{" "}
            <span style={{ fontWeight: 700 }}>{totalCount}</span> • Satılabilir:{" "}
            <span style={{ fontWeight: 700, color: "#16a34a" }}>
              {sellableCount}
            </span>{" "}
            • Satılamaz:{" "}
            <span style={{ fontWeight: 700, color: "#dc2626" }}>
              {nonsellableCount}
            </span>{" "}
            • Bilinmiyor:{" "}
            <span style={{ fontWeight: 700, color: "#f97316" }}>
              {unknownCount}
            </span>
          </div>
        </div>

        {localItems.length === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 14 }}>
            Listede henüz ilaç yok.
          </div>
        ) : (
          <div style={{ flex: 1, overflow: "auto" }}>
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
                    #
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "6px 8px",
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    Brand
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "6px 8px",
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    SN
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "6px 8px",
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    Durum
                  </th>
                </tr>
              </thead>
              <tbody>
                {localItems.map((item, i) => {
                  const isSellable = item.status === "sellable";
                  const isNonSellable = item.status === "nonsellable";

                  const desc = item.description || "";
                  const lowerDesc = desc.toLocaleLowerCase("tr-TR");
                  const unitPrice = item.unitPrice;
                  const partialAmount = item.partialAmount;

                  const isPendingAccept =
                    lowerDesc.includes("eczanenize yollanmış") ||
                    lowerDesc.includes("eczanenize gönderilmiştir");

                  let rowBg = "#ffffff";
                  if (isSellable) {
                    rowBg = "#dcfce7";
                  } else if (isNonSellable && isPendingAccept) {
                    rowBg = "#fef9c3";
                  } else if (isNonSellable) {
                    rowBg = "#fee2e2";
                  }

                  let durumBaslik = "";
                  let durumAciklama = "";

                  if (isSellable) {
                    durumBaslik = "Satılabilir";
                    durumAciklama = desc;
                  } else if (isNonSellable) {
                    durumBaslik = "Satılamaz";
                    durumAciklama =
                      desc ||
                      "Bu ürün satılamaz. Lütfen sistemdeki uyarıyı kontrol edin.";
                  } else {
                    durumBaslik = "Durum bilinmiyor / sorgu hatası";
                    durumAciklama =
                      desc ||
                      "actionResult bulunamadı.\nactionResult yok";
                  }

                  const qrCodeKey = item.raw || "";
                  const resultForItem =
                    qrCodeKey && declarationResults[qrCodeKey]
                      ? declarationResults[qrCodeKey]
                      : null;

                  return (
                    <tr
                      key={item.raw + "_" + i}
                      style={{
                        background: rowBg,
                        cursor: readOnly ? "default" : "pointer",
                      }}
                      onClick={() => {
                        if (!readOnly) openEditForIndex(i);
                      }}
                    >
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: "1px solid #f3f4f6",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span>{i + 1}</span>
                          {!readOnly && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemove(i);
                              }}
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 999,
                                border: "1px solid #e5e7eb",
                                background: "#f9fafb",
                                lineHeight: "18px",
                                textAlign: "center",
                                padding: 0,
                                fontSize: 14,
                                fontWeight: 700,
                              }}
                              title="Listeden çıkar"
                            >
                              -
                            </button>
                          )}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: "1px solid #f3f4f6",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {item.brand || "—"}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: "1px solid #f3f4f6",
                        }}
                      >
                        {item.sn || "—"}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: "1px solid #f3f4f6",
                          fontSize: 12,
                          color: "#111827",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{durumBaslik}</div>
                        {durumAciklama && (
                          <div
                            style={{
                              marginTop: 2,
                              color: "#4b5563",
                            }}
                          >
                            {durumAciklama}
                          </div>
                        )}

                        {(unitPrice || partialAmount) && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              color: "#374151",
                            }}
                          >
                            {unitPrice && (
                              <div>Birim fiyat: {unitPrice}</div>
                            )}
                            {partialAmount && (
                              <div>Kısmi miktar: {partialAmount}</div>
                            )}
                          </div>
                        )}

                        {resultForItem && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {resultForItem.success ? "✅" : "❌"}{" "}
                            {resultForItem.success
                              ? "Bildirim yapıldı."
                              : resultForItem.message}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alt butonlar */}
      {!readOnly && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 16,
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={onBack}
            style={{
              flex: 1,
              minWidth: 120,
              padding: "10px 0",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Geri
          </button>

          {onAddMore && (
            <button
              onClick={onAddMore}
              style={{
                flex: 1,
                minWidth: 140,
                padding: "10px 0",
                borderRadius: 10,
                border: "1px solid #0f766e",
                background: "#0d9488",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              Ekle (yeniden okut)
            </button>
          )}

          <button
            onClick={handleSubmit}
            disabled={busy || !localItems.length}
            style={{
              flex: 1,
              minWidth: 140,
              padding: "10px 0",
              borderRadius: 10,
              border: "1px solid #1d4ed8",
              background: busy || !localItems.length ? "#93c5fd" : "#2563eb",
              color: "#fff",
              fontWeight: 800,
              fontSize: 15,
              opacity: busy || !localItems.length ? 0.7 : 1,
            }}
          >
            {busy ? "Satış kaydediliyor..." : "Satış Yap ve Bildir"}
          </button>
        </div>
      )}

      {/* Fiyat / Kısmi Satış popup'ı */}
      {editingIndex !== null && !readOnly && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={closeEdit}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#ffffff",
              borderRadius: 16,
              padding: 16,
              width: "90%",
              maxWidth: 360,
              boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 15,
                marginBottom: 12,
              }}
            >
              Fiyat / Kısmi Satış
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {/* Fiyat */}
              <label style={{ fontSize: 13 }}>
                Price
                <input
                  value={editPrice}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.,]/g, "");
                    if (v.length <= 8) setEditPrice(v);
                  }}
                  inputMode="decimal"
                  style={{
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    fontSize: 14,
                  }}
                />
              </label>

              {/* Kısmi satış miktarı */}
              <label style={{ fontSize: 13 }}>
                Partial sale amount
                <input
                  value={editPartialAmount}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "");
                    if (v.length <= 3) setEditPartialAmount(v);
                  }}
                  inputMode="numeric"
                  style={{
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    fontSize: 14,
                  }}
                />
              </label>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 16,
              }}
            >
              <button
                onClick={handleSaveEdit}
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  border: "1px solid #1d4ed8",
                  background: "#2563eb",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EasyFinalPage;
