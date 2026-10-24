import type { D1Database } from "./d1";

const AES_GCM_IV_BYTES = 12;
const MAX_TOKEN_LENGTH = 8_192;

type StoredDevelopmentToken = {
  token_iv: string;
  token_ciphertext: string;
  token_expires_at: number;
};

/**
 * Legt ausschließlich ein OSM-Entwicklungstoken ab. Der Sitzungsschlüssel wird
 * gehasht und das Token mit AES-GCM verschlüsselt, damit weder Cookie noch
 * verwendbarer OSM-Zugriff im Klartext in D1 stehen.
 */
export async function storeOSMDevelopmentToken(
  database: D1Database,
  sessionToken: string,
  accessToken: string,
  expiresAt: number,
  now: number,
  encryptionKey: CryptoKey,
  cryptoApi: Crypto = crypto,
): Promise<void> {
  if (!isSecret(sessionToken) || !isAccessToken(accessToken) || !isTimestamp(now) || !isTimestamp(expiresAt) || expiresAt <= now) {
    throw new Error("Ungültiger OSM-Entwicklungszugriff.");
  }

  try {
    const sessionHash = await sha256Hex(sessionToken, cryptoApi);
    // Ein gültiges App-Cookie darf nur zu einer aktiven Sitzung gehören. Der
    // Fremdschlüssel in D1 verhindert zusätzlich verwaiste Token bei Logout.
    const session = await database
      .prepare("SELECT session_hash FROM osm_sessions WHERE session_hash = ? AND expires_at > ?")
      .bind(sessionHash, now)
      .first<{ session_hash: string }>();
    if (!session || session.session_hash !== sessionHash) throw new Error("No active session");

    const iv = cryptoApi.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const ciphertext = await encryptToken(accessToken, sessionHash, expiresAt, iv, encryptionKey, cryptoApi);
    const result = await database
      .prepare(
        `INSERT INTO osm_development_tokens
          (session_hash, token_iv, token_ciphertext, token_expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_hash) DO UPDATE SET
          token_iv = excluded.token_iv,
          token_ciphertext = excluded.token_ciphertext,
          token_expires_at = excluded.token_expires_at,
          created_at = excluded.created_at`,
      )
      .bind(sessionHash, toBase64Url(iv), ciphertext, expiresAt, now)
      .run();
    if (!result.success || result.meta?.changes !== 1) throw new Error("D1 write failed");
  } catch {
    throw new Error("Der OSM-Entwicklungszugriff konnte nicht sicher gespeichert werden.");
  }
}

/** Gibt ein Entwicklungstoken nur für die zugehörige, noch gültige Sitzung zurück. */
export async function findOSMDevelopmentToken(
  database: D1Database,
  sessionToken: string,
  now: number,
  encryptionKey: CryptoKey,
  cryptoApi: Crypto = crypto,
): Promise<string | null> {
  if (!isSecret(sessionToken) || !isTimestamp(now)) return null;

  try {
    const sessionHash = await sha256Hex(sessionToken, cryptoApi);
    const row = await database
      .prepare(
        `SELECT token_iv, token_ciphertext, token_expires_at
         FROM osm_development_tokens
         WHERE session_hash = ? AND token_expires_at > ?
           AND EXISTS (SELECT 1 FROM osm_sessions WHERE session_hash = ? AND expires_at > ?)`,
      )
      .bind(sessionHash, now, sessionHash, now)
      .first<StoredDevelopmentToken>();
    if (!row) {
      await database
        .prepare("DELETE FROM osm_development_tokens WHERE session_hash = ? AND token_expires_at <= ?")
        .bind(sessionHash, now)
        .run();
      return null;
    }
    if (!isTimestamp(row.token_expires_at) || row.token_expires_at <= now) throw new Error("Invalid token expiry");

    const iv = fromBase64Url(row.token_iv);
    if (iv.byteLength !== AES_GCM_IV_BYTES) throw new Error("Invalid token IV");
    const token = await decryptToken(row.token_ciphertext, sessionHash, row.token_expires_at, iv, encryptionKey, cryptoApi);
    if (!isAccessToken(token)) throw new Error("Invalid decrypted token");
    return token;
  } catch {
    throw new Error("Der OSM-Entwicklungszugriff konnte nicht sicher gelesen werden.");
  }
}

/** Entfernt das Entwicklungstoken beim Logout oder beim Austausch der Sitzung. */
export async function deleteOSMDevelopmentToken(
  database: D1Database,
  sessionToken: string,
  cryptoApi: Crypto = crypto,
): Promise<void> {
  if (!isSecret(sessionToken)) return;
  try {
    const sessionHash = await sha256Hex(sessionToken, cryptoApi);
    const result = await database.prepare("DELETE FROM osm_development_tokens WHERE session_hash = ?").bind(sessionHash).run();
    if (!result.success) throw new Error("D1 delete failed");
  } catch {
    throw new Error("Der OSM-Entwicklungszugriff konnte nicht sicher gelöscht werden.");
  }
}

async function encryptToken(
  token: string,
  sessionHash: string,
  expiresAt: number,
  iv: Uint8Array,
  encryptionKey: CryptoKey,
  cryptoApi: Crypto,
): Promise<string> {
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad(sessionHash, expiresAt)) },
    encryptionKey,
    toArrayBuffer(new TextEncoder().encode(token)),
  );
  return toBase64Url(new Uint8Array(ciphertext));
}

async function decryptToken(
  ciphertext: string,
  sessionHash: string,
  expiresAt: number,
  iv: Uint8Array,
  encryptionKey: CryptoKey,
  cryptoApi: Crypto,
): Promise<string> {
  const plaintext = await cryptoApi.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad(sessionHash, expiresAt)) },
    encryptionKey,
    toArrayBuffer(fromBase64Url(ciphertext)),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

function aad(sessionHash: string, expiresAt: number): Uint8Array {
  return new TextEncoder().encode(`aedjaeger-osm-development-token.v1.${sessionHash}.${expiresAt}`);
}

function isSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function isAccessToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_LENGTH && /^[\x21-\x7E]+$/u.test(value);
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

async function sha256Hex(value: string, cryptoApi: Crypto): Promise<string> {
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
