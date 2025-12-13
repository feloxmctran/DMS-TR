// src/pages/AdminProducts.tsx
import { useState } from "react";

const API_BASE = "http://localhost:4000";

export default function AdminProducts() {
  const [productsFile, setProductsFile] = useState<File | null>(null);
  const [productsUploading, setProductsUploading] = useState(false);

  // ✅ Tek ürün ekleme state
  const [newGtin, setNewGtin] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [addingOne, setAddingOne] = useState(false);

  function handleProductsFileChange(e: any) {
    const file = e.target?.files?.[0] || null;
    setProductsFile(file);
  }

  async function handleProductsUpload() {
    if (!productsFile) {
      alert("Lütfen önce bir CSV dosyası seçin.");
      return;
    }

    setProductsUploading(true);
    try {
      const text = await productsFile.text();

      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const items: { gtin: string; brand_name: string }[] = [];

      // Satırın başındaki/sonundaki çift tırnakları atan yardımcı
      const stripOuterQuotes = (s: string) => {
        s = s.trim();
        if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
          return s.slice(1, -1); // ilk ve son tırnağı at
        }
        return s;
      };

      for (let rawLine of lines) {
        // Ör:  "7613...;Бисопролол ..."  →  7613...;Бисопролол ...
        const line = stripOuterQuotes(rawLine);
        if (!line) continue;

        // Artık gerçek ayraç olan ; / , ile bölebiliriz
        const parts = line.split(/[;,]/);
        if (parts.length < 2) continue;

        let gtin = parts[0].trim();
        let brandName = parts[1].trim();

        // Ekstra güvenlik: alanın içinde de tırnak varsa kes
        if (gtin.startsWith('"') && gtin.endsWith('"') && gtin.length >= 2) {
          gtin = gtin.slice(1, -1).trim();
        }
        if (
          brandName.startsWith('"') &&
          brandName.endsWith('"') &&
          brandName.length >= 2
        ) {
          brandName = brandName.slice(1, -1).trim();
        }

        if (!gtin || !brandName) continue;
        items.push({ gtin, brand_name: brandName });
      }

      if (!items.length) {
        alert(
          "CSV'den geçerli ürün okunamadı. Format: her satır GTIN;İlaç Adı şeklinde olmalı."
        );
        return;
      }

      const resp = await fetch(`${API_BASE}/api/admin/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      const textResp = await resp.text();
      let data: any = {};
      try {
        data = textResp ? JSON.parse(textResp) : {};
      } catch {
        data = {};
      }

      if (!resp.ok || !data.ok) {
        throw new Error(data?.error || `HTTP ${resp.status} → ${textResp}`);
      }

      alert(
        `İlaç listesi yüklendi. Toplam ${data.count} ürün kaydedildi (products.json).\nlastChangeId=${data.lastChangeId ?? "?"}`
      );
    } catch (e: any) {
      alert(e?.message || "İlaç listesi yüklenirken hata oluştu.");
    } finally {
      setProductsUploading(false);
    }
  }

  // ✅ Tek ürün ekleme
  async function handleAddSingleProduct() {
    const gtin = newGtin.trim();
    const brand = newBrand.trim();

    if (!gtin || !brand) {
      alert("GTIN ve İlaç Adı zorunlu.");
      return;
    }

    setAddingOne(true);
    try {
      const resp = await fetch(`${API_BASE}/api/admin/products/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gtin, brand_name: brand }),
      });

      const textResp = await resp.text();
      let data: any = {};
      try {
        data = textResp ? JSON.parse(textResp) : {};
      } catch {
        data = {};
      }

      if (!resp.ok || !data.ok) {
        throw new Error(data?.error || `HTTP ${resp.status} → ${textResp}`);
      }

      alert(
        `Kaydedildi (${data.action}).\nGTIN=${data.gtin}\nlastChangeId=${data.lastChangeId}\nToplam=${data.total}`
      );

      setNewGtin("");
      setNewBrand("");
    } catch (e: any) {
      alert(e?.message || "Tek ürün eklerken hata oluştu.");
    } finally {
      setAddingOne(false);
    }
  }

  return (
    <div className="p-4 rounded-2xl shadow bg-white mb-4">
      <h2 className="text-base font-semibold mb-2">
        İlaç Listesi Yükle (GTIN + İlaç Adı)
      </h2>
      <p className="text-xs opacity-70 mb-3">
        Format: Her satır{" "}
        <code>GTIN;İlaç Adı</code> veya <code>GTIN,İlaç Adı</code> şeklinde bir
        CSV dosyası olmalıdır. Örnek:{" "}
        <code>8699514090014;PAROL 500 MG TABLET 20</code>
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,.txt"
          onChange={handleProductsFileChange}
          className="text-sm"
        />
        <button
          onClick={handleProductsUpload}
          disabled={!productsFile || productsUploading}
          className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm shadow hover:opacity-90 disabled:opacity-50"
        >
          {productsUploading ? "Yükleniyor…" : "İlaç listesini yükle"}
        </button>
        {productsFile && (
          <span className="text-xs opacity-70">
            Seçili dosya: <span className="font-mono">{productsFile.name}</span>
          </span>
        )}
      </div>

      {/* ✅ Tek ürün ekleme alanı */}
      <div className="mt-5 p-4 rounded-2xl border border-slate-200 bg-slate-50">
        <h3 className="text-sm font-semibold mb-2">Tek Ürün Ekle / Güncelle</h3>

        <div className="grid gap-2">
          <input
            value={newGtin}
            onChange={(e) => setNewGtin(e.target.value)}
            placeholder="GTIN (13 hane)"
            className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
          />
          <input
            value={newBrand}
            onChange={(e) => setNewBrand(e.target.value)}
            placeholder="İlaç adı (brand_name)"
            className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
          />

          <button
            onClick={handleAddSingleProduct}
            disabled={addingOne}
            className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm shadow hover:opacity-90 disabled:opacity-50"
          >
            {addingOne ? "Kaydediliyor…" : "Kaydet (Ekle/Güncelle)"}
          </button>

          <p className="text-[11px] opacity-70">
            Not: Bu işlem <code>/api/admin/products/add</code> çağırır, ürün
            ekler/günceller ve <code>lastChangeId</code> değerini +1 arttırır.
          </p>
        </div>
      </div>
    </div>
  );
}
