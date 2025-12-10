import { getValidToken } from "./auth";
import { INQUIRY_URL } from "./config";

export async function inquireByGtinSN(gtin: string, serialNumber: string) {
  const token = await getValidToken();
  const res = await fetch(INQUIRY_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ gtin, serialNumber }),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no-op */ }
  if (!res.ok) throw new Error(`Sorgu hatası (${res.status}) → ${text}`);
  return json;
}
