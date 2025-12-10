// src/pages/EasyResultPage.tsx
import React from "react";
import type { EasyFormValues } from "./EasyFormPage";

type EasyResultPageProps = {
  onBack: () => void;
  codes: string[];
  form: EasyFormValues;
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

const EasyResultPage: React.FC<EasyResultPageProps> = ({
  onBack,
  codes,
  form,
}) => {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        padding: 16,
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
            Reçete Özeti
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
          Tamam
        </button>
      </div>

      {/* Reçete bilgileri */}
      <Card title="Reçete Bilgileri">
        <div style={{ fontSize: 14, display: "grid", gap: 4 }}>
          <div>
            <strong>Patient:</strong> {form.patient}
          </div>
          <div>
            <strong>Prescription Number:</strong> {form.prescriptionNumber}
          </div>
          <div>
            <strong>Citizen Id:</strong> {form.citizenId}
          </div>
          <div>
            <strong>Not:</strong> {form.note || "-"}
          </div>
        </div>
      </Card>

      {/* İlaç listesi */}
      <Card title="Okunan İlaçlar">
        {codes.length === 0 ? (
          <div style={{ fontSize: 14, color: "#6b7280" }}>
            Bu reçeteye ait kayıtlı karekod yok.
          </div>
        ) : (
          <div style={{ fontSize: 13 }}>
            <div
              style={{
                marginBottom: 8,
              }}
            >
              Toplam okunan karekod:{" "}
              <span style={{ fontWeight: 700 }}>{codes.length}</span>
            </div>

            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
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
                    Karekod
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
                {codes.map((code, index) => (
                  <tr
                    key={index}
                    style={{
                      backgroundColor: index % 2 === 0 ? "#ecfdf3" : "#f9fafb",
                    }}
                  >
                    <td
                      style={{
                        padding: "6px 8px",
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      {index + 1}
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        borderBottom: "1px solid #e5e7eb",
                        wordBreak: "break-all",
                      }}
                    >
                      {code}
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      {/* Şimdilik durum "Bekliyor". Sonraki adımda
                          FAST stok raporundaki API sonucu buraya bağlayacağız. */}
                      <span style={{ fontWeight: 600 }}>Bekliyor</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default EasyResultPage;
