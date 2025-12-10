// src/pages/AdminGate.tsx
import React, { useEffect, useState } from "react";

const FALLBACK_SECRET = "admin123!"; // değiştir ☝️
const ENV_SECRET =
  (import.meta as any)?.env?.VITE_ADMIN_SECRET || ""; // .env’de VITE_ADMIN_SECRET varsa onu kullanır

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(false);
  const [pw, setPw] = useState("");

  useEffect(() => {
    const v = sessionStorage.getItem("admin_ok");
    if (v === "1") setOk(true);
  }, []);

  if (ok) return <>{children}</>;

  const check = () => {
    const secret = (ENV_SECRET || FALLBACK_SECRET).trim();
    if (!secret) {
      alert("Admin parolası yapılandırılmamış (VITE_ADMIN_SECRET).");
      return;
    }
    if (pw.trim() === secret) {
      sessionStorage.setItem("admin_ok", "1"); // sadece tarayıcı oturumu
      setOk(true);
    } else {
      alert("Parola hatalı.");
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "80px auto", padding: 20, border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Admin Girişi</h1>
      <div style={{ fontSize: 13, opacity: .7, marginBottom: 10 }}>
        Bu sayfa yalnızca web’de kullanılmalı. Mobil uygulamada yer almaz.
      </div>
      <input
        type="password"
        placeholder="Admin parolası"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #d1d5db", marginBottom: 8 }}
      />
      <button
        onClick={check}
        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 700, width: "100%" }}
      >
        Giriş Yap
      </button>
    </div>
  );
}
