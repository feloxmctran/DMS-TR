import { saveToken, loadCreds, getTokenIfValid } from "./authStore";
import { TOKEN_URL } from "./config";

export async function getValidToken(): Promise<string> {
  const cached = await getTokenIfValid();
  if (cached) return cached;

  const { username, password, clientId, clientSecret, scope, grant } = await loadCreds();
  const body = new URLSearchParams();

  if ((grant || "password") === "client_credentials") {
    body.set("grant_type", "client_credentials");
    if (clientId) body.set("client_id", clientId);
    if (clientSecret) body.set("client_secret", clientSecret);
    if (scope) body.set("scope", scope);
  } else {
    body.set("grant_type", "password");
    body.set("username", username);
    body.set("password", password);
    if (clientId) body.set("client_id", clientId);
    if (clientSecret) body.set("client_secret", clientSecret);
    if (scope) body.set("scope", scope);
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const txt = await res.text();
  let data: any;
  try { data = JSON.parse(txt); } catch { data = {}; }

  if (!res.ok) throw new Error(`Token alınamadı (${res.status}) → ${txt}`);

  const token = data?.access_token;
  const exp = Number(data?.expires_in || 0);
  if (!token) throw new Error("Yanıtta access_token yok.");
  await saveToken(token, exp);
  return token;
}
