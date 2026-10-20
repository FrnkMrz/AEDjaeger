const OSM_AUTHORIZATION_ENDPOINT = "https://www.openstreetmap.org/oauth2/authorize";
const OSM_LOGIN_SCOPE = "openid";
const RANDOM_BYTES = 32;

export type PkceTransaction = {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
};

export type OSMCallbackResult =
  | { ok: true; code: string }
  | { ok: false; reason: "invalid_state" | "authorization_denied" | "invalid_response" };

// Diese Helfer bereiten OAuth-Nachrichten nur vor und prüfen sie. Für einen
// echten Login muss der Worker die Transaktion serverseitig speichern und
// einmalig verbrauchen, den Code einlösen und die OIDC-Identität prüfen.

/**
 * Erzeugt einmalige OAuth-Werte mit der Web Crypto API der Workers.
 * Der Aufrufer muss die Transaktion serverseitig speichern, an den startenden
 * Browser binden, kurz befristen und bei der Rückkehr genau einmal verbrauchen.
 */
export async function createPkceTransaction(cryptoApi: Crypto = crypto): Promise<PkceTransaction> {
  const verifier = randomBase64Url(cryptoApi);
  const state = randomBase64Url(cryptoApi);
  const nonce = randomBase64Url(cryptoApi);
  const challenge = await createCodeChallenge(verifier, cryptoApi);
  return { state, nonce, verifier, challenge };
}

/** PKCE S256 bildet den SHA-256-Hash ohne Padding als base64url ab. */
export async function createCodeChallenge(verifier: string, cryptoApi: Crypto = crypto): Promise<string> {
  if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9._~-]+$/u.test(verifier)) {
    throw new Error("Ungültiger PKCE-Verifier.");
  }

  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

/** Baut die feste OSM-Anmelde-URL; Endpunkt und Scope sind nicht frei wählbar. */
export function buildOSMAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  transaction: PkceTransaction;
}): URL {
  if (typeof input.clientId !== "string" || input.clientId.trim().length === 0 || input.clientId.length > 256) {
    throw new Error("Die OSM-Anmeldung ist nicht korrekt konfiguriert.");
  }

  const redirectUri = validateRedirectUri(input.redirectUri);
  if (!isOAuthValue(input.transaction.state) || !isOAuthValue(input.transaction.nonce) || !isOAuthValue(input.transaction.challenge)) {
    throw new Error("Ungültige OAuth-Transaktion.");
  }

  const authorizationUrl = new URL(OSM_AUTHORIZATION_ENDPOINT);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", input.clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("scope", OSM_LOGIN_SCOPE);
  authorizationUrl.searchParams.set("state", input.transaction.state);
  authorizationUrl.searchParams.set("nonce", input.transaction.nonce);
  authorizationUrl.searchParams.set("code_challenge", input.transaction.challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  return authorizationUrl;
}

/** Prüft den Rücksprung gegen den einmalig gespeicherten State vor Code-Verwendung. */
export function validateOSMAuthorizationCallback(callbackUrl: URL, expectedState: string): OSMCallbackResult {
  if (!isOAuthValue(expectedState)) return { ok: false, reason: "invalid_state" };

  const states = callbackUrl.searchParams.getAll("state");
  if (states.length !== 1 || !constantTimeEqual(states[0], expectedState)) {
    return { ok: false, reason: "invalid_state" };
  }

  const errors = callbackUrl.searchParams.getAll("error");
  if (errors.length > 0) return { ok: false, reason: "authorization_denied" };

  const codes = callbackUrl.searchParams.getAll("code");
  if (codes.length !== 1 || codes[0].length === 0 || codes[0].length > 2_048) {
    return { ok: false, reason: "invalid_response" };
  }

  return { ok: true, code: codes[0] };
}

function randomBase64Url(cryptoApi: Crypto): string {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(RANDOM_BYTES));
  return toBase64Url(bytes);
}

/** Erzeugt ein gleich starkes, nicht erratbares Cookie-Geheimnis. */
export function createOAuthSecret(cryptoApi: Crypto = crypto): string {
  return randomBase64Url(cryptoApi);
}

/** Importiert genau 32 zufällige Bytes aus einem Worker-Secret als AES-GCM-Schlüssel. */
export async function importOAuthEncryptionKey(secret: string, cryptoApi: Crypto = crypto): Promise<CryptoKey> {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(secret)) {
    throw new Error("Der OSM-Anmeldeschlüssel ist nicht korrekt konfiguriert.");
  }

  const binary = atob(secret.replaceAll("-", "+").replaceAll("_", "/") + "=");
  const raw = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (raw.length !== 32) throw new Error("Der OSM-Anmeldeschlüssel ist nicht korrekt konfiguriert.");

  return cryptoApi.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function validateRedirectUri(value: string): string {
  let redirectUri: URL;
  try {
    redirectUri = new URL(value);
  } catch {
    throw new Error("Die OSM-Anmeldung benötigt eine gültige Rücksprungadresse.");
  }

  const isSecure = redirectUri.protocol === "https:";
  const isLoopbackDevelopment = redirectUri.protocol === "http:" && redirectUri.hostname === "127.0.0.1";
  if ((!isSecure && !isLoopbackDevelopment) || redirectUri.username || redirectUri.password || redirectUri.hash) {
    throw new Error("Die OSM-Rücksprungadresse muss HTTPS verwenden.");
  }

  return redirectUri.toString();
}

function isOAuthValue(value: unknown): value is string {
  return typeof value === "string" && value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(value);
}

/** Vergleicht den State ohne Abbruch beim ersten abweichenden Zeichen. */
function constantTimeEqual(actual: string | null, expected: string): boolean {
  if (actual === null) return false;

  let difference = actual.length ^ expected.length;
  const comparedLength = Math.max(actual.length, expected.length);
  for (let index = 0; index < comparedLength; index += 1) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}
