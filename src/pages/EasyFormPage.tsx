// src/pages/EasyFormPage.tsx
import React, { useState } from "react";

export type EasyFormValues = {
  patient: string;
  prescriptionNumber: string;
  citizenId: string;
  note: string;
};

type EasyFormPageProps = {
  onBack: () => void;
  codes: string[];
  onSubmit: (values: EasyFormValues) => void;
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

const EasyFormPage: React.FC<EasyFormPageProps> = ({
  onBack,
  codes,
  onSubmit,
}) => {
  const [patient, setPatient] = useState("");
  const [prescriptionNumber, setPrescriptionNumber] = useState("");
  const [citizenId, setCitizenId] = useState("");
  const [note, setNote] = useState("");

  const handleSubmit = () => {
    if (!patient || !prescriptionNumber || !citizenId) {
      alert("Patient, Prescription Number ve Citizen Id alanları zorunludur.");
      return;
    }

    onSubmit({
      patient,
      prescriptionNumber,
      citizenId,
      note,
    });
  };

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
            Reçete Bilgileri
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
            onClick={handleSubmit}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #2563eb",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            Devam
          </button>
        </div>
      </div>

      <Card title="Reçete Bilgileri">
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            Patient
            <input
              value={patient}
              onChange={(e) => setPatient(e.target.value)}
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

          <label style={{ fontSize: 13 }}>
            Prescription Number
            <input
              value={prescriptionNumber}
              onChange={(e) => setPrescriptionNumber(e.target.value)}
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

          <label style={{ fontSize: 13 }}>
            Citizen Id
            <input
              value={citizenId}
              onChange={(e) => setCitizenId(e.target.value)}
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

          <label style={{ fontSize: 13 }}>
            Not
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
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
      </Card>

      <Card title="Toplam Okunan Karekod">
        <div style={{ fontSize: 14 }}>
          Toplam okunan karekod:{" "}
          <span style={{ fontWeight: 700 }}>{codes.length}</span>
        </div>
      </Card>
    </div>
  );
};

export default EasyFormPage;
