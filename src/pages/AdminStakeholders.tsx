import { useEffect, useMemo, useState } from "react";
import { Preferences } from "@capacitor/preferences";
// Bu sayfa: "Stakeholder Çek" ve "Yayınla" akışını yapar.
// 1) testndbapi.med.kg GetAllStakeholders'dan JSON çeker
// 2) "Yayınla" ile istenmeyen alanları atar (taxNumber, address, parentName)
// 3) Minify + GZIP üretir ve indirilebilir hale getirir
// Not: GZIP için pako kullanıyoruz → npm i pako
import { gzip } from "pako";

const API_URL = "https://testndbapi.med.kg/api/TrackAndTrace/GetAllStakeholders";

// Settings'te tuttuğumuz anahtar adları (App.tsx ile uyumlu)
const PREF = {
  username: "ndb_username",
  password: "ndb_password",
  scope: "ndb_scope",
  grant: "ndb_grant",
  tokenUrl: "ndb_token_url",
};

const DEFAULTS = {
  tokenUrl: "https://testndbapi.med.kg/connect/token",
  scope: "",
  grant: "password" as const,
};

type Stakeholder = Record<string, any>;

type Sizes = {
  raw?: number;
  cleaned?: number;
  cleanedGzip?: number;
};

function human(n?: number) {
  if (n == null) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < units.length - 1) {
    x = x / 1024;
    i++;
  }
  return `${x.toFixed(1)} ${units[i]}`;
}

async function obtainTokenFromSettings(): Promise<string> {
  // Preferences -> tokenUrl, username, password, scope, grant
  const tokenUrl = (await Preferences.get({ key: PREF.tokenUrl })).value || DEFAULTS.tokenUrl;
  const username = (await Preferences.get({ key: PREF.username })).value || "";
  const password = (await Preferences.get({ key: PREF.password })).value || "";
  const scope = (await Preferences.get({ key: PREF.scope })).value || DEFAULTS.scope;
  const grant = ((await Preferences.get({ key: PREF.grant })).value || DEFAULTS.grant) as
    | "password"
    | "client_credentials";

  const body = new URLSearchParams();
  if (grant === "client_credentials") {
    body.set("grant_type", "client_credentials");
    if (scope) body.set("scope", scope);
  } else {
    body.set("grant_type", "password");
    body.set("username", username.trim());
    body.set("password", password.trim());
    if (scope) body.set("scope", scope);
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token alınamadı (HTTP ${res.status}) → ${text}`);
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}
  const tk = data?.access_token;
  if (!tk) throw new Error("Yanıtta access_token yok.");
  return tk;
}

export default function AdminStakeholders() {
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [records, setRecords] = useState<Stakeholder[] | null>(null);
  const [sizes, setSizes] = useState<Sizes>({});

  // Çekilen ham JSON'u indir butonu
  const rawJsonUrl = useMemo(() => {
    if (!records) return null;
    const blob = new Blob([JSON.stringify(records, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    return URL.createObjectURL(blob);
  }, [records]);

  // URL leak önleme: records değişince/ayrılınca eski URL'leri bırak
  useEffect(() => {
    return () => {
      if (rawJsonUrl) URL.revokeObjectURL(rawJsonUrl);
    };
  }, [rawJsonUrl]);

  const [publishUrlJson, setPublishUrlJson] = useState<string | null>(null);
  const [publishUrlGz, setPublishUrlGz] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (publishUrlJson) URL.revokeObjectURL(publishUrlJson);
      if (publishUrlGz) URL.revokeObjectURL(publishUrlGz);
    };
  }, [publishUrlJson, publishUrlGz]);

  // ✅ await yok; Promise zinciri kullanıldı
  const handleFetch = () => {
    setLoading(true);
    setError(null);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token.trim()) headers["Authorization"] = `Bearer ${token.trim()}`;

    fetch(API_URL, { headers })
      .then(async (resp) => {
        const raw = await resp.text();
        if (resp.status === 401) {
          throw new Error(
            "HTTP 401 — Yetkisiz. Token gerekli. 'Token Al (Settings'ten)' ile token çekin veya kutuya yapıştırın."
          );
        }
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} — ${resp.statusText} → ${raw}`);
        }

        let data: any = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {}

        const arr = Array.isArray(data)
          ? data
          : Array.isArray(data?.result)
          ? data.result
          : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.actionResult?.stakeholders)
          ? data.actionResult.stakeholders
          : [];

        if (!Array.isArray(arr)) {
          throw new Error("Beklenmeyen JSON formatı: dizi bulunamadı.");
        }

        setRecords(arr);
        setSizes((s) => ({ ...s, raw: new Blob([JSON.stringify(arr)]).size }));
      })
      .catch((e: any) => {
        setError(e?.message || "Bilinmeyen hata");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handlePublish = () => {
    if (!records) return;

    // 1) Alan temizleme
    const cleaned = records.map((r) => {
      const { taxNumber, address, parentName, ...rest } = r;
      return rest;
    });

    // 2) Minify JSON
    const jsonStr = JSON.stringify(cleaned);
    const jsonBlob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });

    // 3) GZIP
    const gzBytes = gzip(jsonStr); // Uint8Array
    const gzBlob = new Blob([gzBytes], { type: "application/gzip" });

    // Boyutlar
    setSizes((prev) => ({
      raw: prev.raw,
      cleaned: jsonBlob.size,
      cleanedGzip: gzBlob.size,
    }));

    // 4) İndir linkleri üret (eski URL'leri bırak)
    if (publishUrlJson) URL.revokeObjectURL(publishUrlJson);
    if (publishUrlGz) URL.revokeObjectURL(publishUrlGz);

    setPublishUrlJson(URL.createObjectURL(jsonBlob));
    setPublishUrlGz(URL.createObjectURL(gzBlob));
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Stakeholder Yönetimi</h1>
      <p className="text-sm opacity-80 mb-6">
        Kaynak: <code>{API_URL}</code>
      </p>

      <div className="grid gap-4">
        <div className="p-4 rounded-2xl shadow bg-white">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Bearer Token</label>
            <div className="flex gap-2">
              <input
                className="border rounded-xl px-3 py-2 focus:outline-none focus:ring w-full"
                placeholder="Token yapıştır ya da aşağıdan alın"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button
                onClick={async () => {
                  setTokenBusy(true);
                  try {
                    const tk = await obtainTokenFromSettings();
                    setToken(tk);
                  } catch (e: any) {
                    alert(e?.message || String(e));
                  } finally {
                    setTokenBusy(false);
                  }
                }}
                disabled={tokenBusy}
                className="px-3 py-2 rounded-xl bg-gray-800 text-white shadow hover:opacity-90 disabled:opacity-50"
                title="App Settings'te kayıtlı kullanıcı adı/şifre ile token al"
              >
                {tokenBusy ? "Alınıyor…" : "Token Al (Settings'ten)"}
              </button>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={handleFetch}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white shadow hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Çekiliyor…" : "Stakeholder Çek"}
              </button>
              {records && (
                <a
                  href={rawJsonUrl || undefined}
                  download={`stakeholders.raw.json`}
                  className="px-4 py-2 rounded-xl border shadow hover:bg-gray-50"
                >
                  Ham JSON'u indir
                </a>
              )}
            </div>
            {error && <div className="text-red-600 text-sm mt-2">Hata: {error}</div>}
          </div>
        </div>

        <div className="p-4 rounded-2xl shadow bg-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Durum</h2>
              <p className="text-sm opacity-70">
                {records ? `Kayıt sayısı: ${records.length}` : "Henüz veri çekilmedi."}
              </p>
            </div>
            <div className="text-sm">
              <div>
                Ham JSON: <span className="font-mono">{human(sizes.raw)}</span>
              </div>
              <div>
                Minified (temiz): <span className="font-mono">{human(sizes.cleaned)}</span>
              </div>
              <div>
                GZIP (minified): <span className="font-mono">{human(sizes.cleanedGzip)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-2xl shadow bg-white">
          <div className="flex items-center gap-3">
            <button
              onClick={handlePublish}
              disabled={!records}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white shadow hover:opacity-90 disabled:opacity-50"
            >
              Yayınla (Temizle + Minify + GZIP)
            </button>
            {publishUrlJson && (
              <a
                href={publishUrlJson}
                download={`stakeholders.min.json`}
                className="px-4 py-2 rounded-xl border shadow hover:bg-gray-50"
              >
                Minified JSON indir
              </a>
            )}
            {publishUrlGz && (
              <a
                href={publishUrlGz}
                download={`stakeholders.min.json.gz`}
                className="px-4 py-2 rounded-xl border shadow hover:bg-gray-50"
              >
                Minified JSON (GZIP) indir
              </a>
            )}
          </div>
          <p className="text-xs opacity-70 mt-2">
            Yayınla: <code>taxNumber</code>, <code>address</code>, <code>parentName</code> alanlarını
            çıkarır; kalanını JSON minified + GZIP olarak hazırlar.
          </p>
        </div>
      </div>
    </div>
  );
}
