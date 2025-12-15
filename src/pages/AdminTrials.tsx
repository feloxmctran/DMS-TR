import { useEffect, useMemo, useState } from "react";

const API_BASE = "https://dms-tr.onrender.com";


type TrialRow = {
  stakeholderId: string;
  deviceId: string;
  partnerId?: string;
  expiresAt: string | null;
  extensionRequested?: boolean;
  stakeholderName?: string;
  createdAt?: string | null;
  daysSinceCreated?: number | null;
};

// id -> name eşlemesi için
type NameMap = Record<string, string>;

export default function AdminTrials() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TrialRow[]>([]);
  const [defaultDays, setDefaultDays] = useState<number>(14);
  const [savingDefault, setSavingDefault] = useState(false);
  const [filter, setFilter] = useState("");
  const [nameMap, setNameMap] = useState<NameMap>({});

  // stakeholders.json'dan id → isim eşlemesi yükle
  useEffect(() => {
    async function loadStakeholderNames() {
      try {
        const res = await fetch("/stakeholders.json", { cache: "no-store" });
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

        const map: NameMap = {};
        for (const it of arr) {
          const id = String(it.code ?? it.id ?? "");
          const name = String(
            it.name ?? it.title ?? it.code ?? it.id ?? ""
          ).trim();
          if (id) map[id] = name || id;
        }
        setNameMap(map);
      } catch (e) {
        console.warn("stakeholders.json adları yüklenemedi:", e);
        setNameMap({});
      }
    }

    loadStakeholderNames();
  }, []);



  async function fetchList() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/api/admin/trials`, {
        headers: { Accept: "application/json" },
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status} → ${text}`);
      const data = text ? JSON.parse(text) : {};
      const list = Array.isArray(data?.list) ? data.list : [];

      // backend'den gelen alanları TrialRow'a map et
      setRows(
        list.map((r: any) => ({
          stakeholderId: String(r.stakeholderId ?? ""),
          deviceId: String(r.deviceId ?? ""),
          partnerId: r.partnerId ? String(r.partnerId) : undefined,
          expiresAt: r.expiresAt ?? null,
          extensionRequested: !!r.extensionRequested,
          stakeholderName: r.stakeholderName
            ? String(r.stakeholderName)
            : undefined,
          createdAt: r.createdAt ?? null,
          daysSinceCreated:
            typeof r.daysSinceCreated === "number"
              ? r.daysSinceCreated
              : null,
        }))
      );

      if (typeof data?.defaultDays === "number")
        setDefaultDays(data.defaultDays);
    } catch (e: any) {
      setError(e?.message || "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  async function saveDefaultDays() {
    const n = Number(defaultDays);
    if (!Number.isFinite(n) || n <= 0) {
      alert("Gün pozitif bir sayı olmalı.");
      return;
    }
    setSavingDefault(true);
    try {
      const resp = await fetch(`${API_BASE}/api/admin/default-expiry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: n }),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status} → ${text}`);
      await fetchList();
      alert("Varsayılan deneme süresi güncellendi.");
    } catch (e: any) {
      alert(e?.message || "Güncellenemedi");
    } finally {
      setSavingDefault(false);
    }
  }

  // +7 gün uzatma admin endpoint'i
  async function extend7d(stakeholderId: string, deviceId: string) {
    const ok = window.confirm(
      `${stakeholderId} / ${deviceId} için süreyi +7 gün uzatmak istiyor musunuz?`
    );
    if (!ok) return;

    try {
      const resp = await fetch(`${API_BASE}/api/admin/trial/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stakeholderId, deviceId, days: 7 }),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status} → ${text}`);
      await fetchList();
    } catch (e: any) {
      alert(e?.message || "Uzatılamadı");
    }
  }

  async function closeTrial(stakeholderId: string, deviceId: string) {
    const ok = window.confirm(
      "Bu cihaz için deneme süresini hemen kapatmak istediğinize emin misiniz?"
    );
    if (!ok) return;

    try {
      const resp = await fetch(`${API_BASE}/api/admin/trial-close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stakeholderId, deviceId }),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status} → ${text}`);
      await fetchList();
    } catch (e: any) {
      alert(e?.message || "Kapatılamadı");
    }
  }

  useEffect(() => {
    fetchList();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((r) => {
      const name =
        nameMap[r.stakeholderId]?.toLowerCase() ||
        r.stakeholderName?.toLowerCase() ||
        "";
      return (
        r.stakeholderId.toLowerCase().includes(q) ||
        r.deviceId.toLowerCase().includes(q) ||
        (r.partnerId || "").toLowerCase().includes(q) ||
        name.includes(q)
      );
    });
  }, [rows, filter, nameMap]);

  const now = Date.now();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Trial Yönetimi</h1>
      <p className="text-sm opacity-80 mb-4">
        Kaynak mini-backend: <code>{API_BASE}</code>
      </p>

      <div className="p-4 rounded-2xl shadow bg-white mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium">
            Varsayılan deneme süresi (gün)
          </label>
          <input
            type="number"
            value={defaultDays}
            onChange={(e) => setDefaultDays(Number(e.target.value))}
            className="border rounded-xl px-3 py-2 w-24 text-sm"
          />
          <button
            onClick={saveDefaultDays}
            disabled={savingDefault}
            className="px-3 py-2 rounded-xl bg-gray-800 text-white text-sm shadow hover:opacity-90 disabled:opacity-50"
          >
            {savingDefault ? "Kaydediliyor…" : "Kaydet"}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <input
              placeholder="Filtrele (id / device / partner / name)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="border rounded-xl px-3 py-2 w-80 text-sm"
            />
            <button
              onClick={fetchList}
              className="px-3 py-2 rounded-xl border text-sm shadow hover:bg-gray-50"
            >
              Yenile
            </button>
          </div>
        </div>
              
      </div>

      {loading && (
        <div className="text-sm font-semibold">Yükleniyor…</div>
      )}
      {error && (
        <div className="text-sm text-red-600">Hata: {error}</div>
      )}

      {!loading && !error && (
        <div className="p-4 rounded-2xl shadow bg-white overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="text-gray-500">
              <tr>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Stakeholder ID</th>
                <th className="p-2 text-left">Device</th>
                <th className="p-2 text-left">Partner</th>
                <th className="p-2 text-left">İlk Kayıt</th>
                <th className="p-2 text-left">Expires</th>
                <th className="p-2 text-left">Durum</th>
                <th className="p-2 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const dispName =
                  nameMap[r.stakeholderId] || r.stakeholderName || "—";
                const expMs = r.expiresAt ? Date.parse(r.expiresAt) : NaN;
                const isActive =
                  Number.isFinite(expMs) && expMs > now;

                return (
                  <tr
                    key={`${r.stakeholderId}-${r.deviceId}-${i}`}
                    className="border-t align-top"
                  >
                    <td className="p-2 text-sm">{dispName}</td>
                    <td className="p-2 font-mono text-xs">
                      {r.stakeholderId}
                    </td>
                    <td className="p-2 font-mono text-[11px] opacity-80 break-all max-w-[220px]">
                      {r.deviceId}
                    </td>
                    <td className="p-2 font-mono text-xs">
                      {r.partnerId || "—"}
                    </td>
                    <td className="p-2 text-xs">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleString()
                        : "—"}
                      {typeof r.daysSinceCreated === "number" && (
                        <div className="text-[11px] text-gray-600">
                          Toplam kullanım:{" "}
                          <span className="font-semibold">
                            {r.daysSinceCreated}
                          </span>{" "}
                          gün
                        </div>
                      )}
                    </td>
                    <td className="p-2 font-mono text-xs">
                      {r.expiresAt
                        ? new Date(r.expiresAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="p-2 text-xs">
                      <span
                        className={
                          isActive
                            ? "text-emerald-700 font-semibold"
                            : "text-amber-700 font-semibold"
                        }
                      >
                        {isActive ? "Aktif" : "Süresi dolmuş"}
                      </span>
                      {r.extensionRequested && (
                        <span className="ml-1 text-[11px] text-purple-700">
                          • Uzatma talebi
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() =>
                            extend7d(r.stakeholderId, r.deviceId)
                          }
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs hover:opacity-90"
                        >
                          +7 gün uzat
                        </button>
                        <button
                          onClick={() =>
                            closeTrial(r.stakeholderId, r.deviceId)
                          }
                          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs hover:opacity-90"
                        >
                          Trialı kapat
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td
                    className="p-3 text-gray-500 text-sm"
                    colSpan={8}
                  >
                    Kayıt yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
