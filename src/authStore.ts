import { Preferences } from "@capacitor/preferences";

const K = {
  username: "ndb_username",
  password: "ndb_password",
  clientId: "ndb_client_id",
  clientSecret: "ndb_client_secret",
  scope: "ndb_scope",
  grant: "ndb_grant",
  token: "ndb_token",
  tokenExp: "ndb_token_exp",
};

export async function saveCreds({ username, password, clientId, clientSecret, scope, grant }:{
  username?: string; password?: string; clientId?: string; clientSecret?: string; scope?: string; grant?: string;
}) {
  if (username != null) await Preferences.set({ key: K.username, value: username });
  if (password != null) await Preferences.set({ key: K.password, value: password });
  if (clientId != null) await Preferences.set({ key: K.clientId, value: clientId });
  if (clientSecret != null) await Preferences.set({ key: K.clientSecret, value: clientSecret });
  if (scope != null) await Preferences.set({ key: K.scope, value: scope });
  if (grant != null) await Preferences.set({ key: K.grant, value: grant });
  // tokenları sıfırla ki yeni ayarlarla tekrar alınsın
  await Preferences.remove({ key: K.token });
  await Preferences.remove({ key: K.tokenExp });
}

export async function loadCreds() {
  const g = async (key:string) => (await Preferences.get({ key })).value || "";
  return {
    username: await g(K.username),
    password: await g(K.password),
    clientId: await g(K.clientId),
    clientSecret: await g(K.clientSecret),
    scope: await g(K.scope),
    grant: (await g(K.grant)) || "password",
  };
}

export async function saveToken(token:string, expiresInSec:number) {
  const exp = Date.now() + expiresInSec * 1000 - 30000; // 30 sn erken
  await Preferences.set({ key: K.token, value: token });
  await Preferences.set({ key: K.tokenExp, value: String(exp) });
}

export async function getTokenIfValid() {
  const { value: t } = await Preferences.get({ key: K.token });
  const { value: e } = await Preferences.get({ key: K.tokenExp });
  if (!t || !e) return null;
  if (Date.now() >= Number(e)) return null;
  return t;
}
