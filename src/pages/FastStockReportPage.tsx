// src/pages/FastStockReportPage.tsx
import React from "react";
import type {
  GetStockReportResult,
  StockReportRow,
} from "../plugins/fastStockScanner";

type FastStockReportPageProps = {
  onBack: () => void;
  stockReport: GetStockReportResult | null;
  onExportStockReportCsv: () => void;
  onExportAllDatamatrixCsv: () => void;
};

const FastStockReportPage: React.FC<FastStockReportPageProps> = ({
  onBack,
  stockReport,
  onExportStockReportCsv,
  onExportAllDatamatrixCsv,
}) => {
  const hasReport =
    !!stockReport &&
    Array.isArray(stockReport.items) &&
    stockReport.items.length > 0;

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: "#f3f4f6", // açık gri
    padding: 12,
    paddingTop: 44, // ✅ üstte boşluk (status bar çakışmasını engeller)
    boxSizing: "border-box",
  };

  const containerStyle: React.CSSProperties = {
    maxWidth: 900,
    margin: "0 auto",
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 12,
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.12)",
  };

  const headerBarStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    marginBottom: 8,
  };

  const backButtonStyle: React.CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    backgroundColor: "#ffffff",
  };

   const subtitleStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 8,
  };

  const summaryRowStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#111827",
    marginBottom: 8,
  };

  const buttonsRowStyle: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  };

    const primaryButtonStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 140,
    borderRadius: 999,
    border: "1px solid #16a34a",    // yeşil kenarlık
    backgroundColor: "#22c55e",      // yeşil doldurma
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    padding: "6px 10px",
  };


  const secondaryButtonStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 140,
    borderRadius: 999,
    border: "1px solid #bbf7d0", // çok hafif yeşil-gri
    backgroundColor: "#ffffff",
    color: "#111827",
    fontSize: 12,
    fontWeight: 600,
    padding: "6px 10px",
  };

  const tableWrapperStyle: React.CSSProperties = {
    marginTop: 4,
    maxHeight: "70vh",
    overflow: "auto",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
  };

  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 11,
  };

  const thStyle: React.CSSProperties = {
    position: "sticky",
    top: 0,
    backgroundColor: "#f9fafb",
    textAlign: "left",
    padding: "6px 8px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 12,
    fontWeight: 600,
    color: "#4b5563",
  };

  const tdStyle: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid #e5e7eb",
    verticalAlign: "top",
  };

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        {/* Üst çubuk */}
        <div style={headerBarStyle}>
          <button type="button" onClick={onBack} style={backButtonStyle}>
            ← Oturumlara geri dön
          </button>
        </div>

        {/* Başlık kartı */}
        <div
          style={{
            ...cardStyle,
            background:
            "linear-gradient(135deg, rgba(34,197,94,1), rgba(22,163,74,1))",
            color: "#ffffff",
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700 }}>FAST Stok Raporu</div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
            Tüm FAST sayım oturumlarından oluşan özet stok tablosu.
          </div>
        </div>

        {/* İçerik kartı */}
        <div style={cardStyle}>
          {/* Özet + butonlar */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <div style={subtitleStyle}>
              {hasReport ? (
                <>
                  <div style={summaryRowStyle}>
                    Toplam benzersiz kutu:{" "}
                    <strong>{stockReport!.totalDistinct}</strong>
                  </div>
                  <div style={summaryRowStyle}>
                    Toplam tarama:{" "}
                    <strong>{stockReport!.totalScans}</strong> • Tekrar
                    taranan:{" "}
                    <strong>{stockReport!.duplicateCount}</strong>
                  </div>
                </>
              ) : (
                <span>
                  Henüz stok raporu oluşturulmamış. FAST oturumları ekranında
                  &quot;Stok Raporu (tüm oturumlar)&quot; butonuna basarak
                  rapor oluşturabilirsiniz.
                </span>
              )}
            </div>

            <div style={buttonsRowStyle}>
              <button
                type="button"
                onClick={onExportStockReportCsv}
                style={primaryButtonStyle}
              >
                Stok raporunu CSV&apos;ye aktar
              </button>
              <button
                type="button"
                onClick={onExportAllDatamatrixCsv}
                style={secondaryButtonStyle}
              >
                Tüm datamatrixleri CSV&apos;ye aktar
              </button>
            </div>
          </div>

          {/* Tablo */}
          {hasReport && (
            <div style={tableWrapperStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Ürün Adı</th>
                    <th style={thStyle}>GTIN</th>
                    <th style={thStyle}>Benzersiz Kutu</th>
                  </tr>
                </thead>
                <tbody>
                  {stockReport!.items.map((row: StockReportRow, idx) => (
                    <tr
                      key={row.gtin ?? `row-${idx}`}
                      style={{
                        backgroundColor:
                          idx % 2 === 0 ? "#ffffff" : "#f9fafb",
                      }}
                    >
                      <td style={tdStyle}>
                        {row.brand_name || "İsmi bulunamayan ürün"}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>
                        {row.gtin || "—"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontWeight: 600,
                        }}
                      >
                        {row.distinctCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!hasReport && (
            <div
              style={{
                marginTop: 10,
                padding: 8,
                borderRadius: 10,
                backgroundColor: "#f9fafb",
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              FAST sayım ekranına dönüp en az bir oturum kaydettikten sonra
              stok raporu oluşturabilirsiniz.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FastStockReportPage;
