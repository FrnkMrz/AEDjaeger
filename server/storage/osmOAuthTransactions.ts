import type { D1Database } from "./d1";
import type { OSMEnvironment } from "../auth/osmProvider";

const TRANSACTION_LIFETIME_MS = 10 * 60 * 1_000;
const AES_GCM_IV_BYTES = 12;

export type OSMOAuthTransactionPayload = {
  verifier: string;
  nonce: string;
  environment: OSMEnvironment;
};

export type OSMOAuthTransactionInput = {
  verifier: string;
  nonce: string;
  environment?: OSMEnvironment;
  state: string;
  browserBinding: string;
  createdAt: number;
};

type EncryptedPayload = {
  payload_iv: string;
  payload_ciphertext: string;
};

/**
 * Speichert State und Browser-Cookie nur als Hash. PKCE-Verifier und OIDC-Nonce
 * werden mit einem serverseitigen AES-GCM-Schlüssel verschlüsselt, weil der
 * Callback sie einmal benötigt, sie aber nicht in Klartext in D1 gehören.
 */
export async function storeOSMOAuthTransaction(
  database: D1Database,
  input: OSMOAuthTransactionInput,
  encryptionKey: CryptoKey,
  cryptoApi: Crypto = crypto,
): Promise<void> {
  validateInput(input);
  try {
    const stateHash = await sha256Hex(input.state, cryptoApi);
    const bindingHash = await sha256Hex(input.browserBinding, cryptoApi);
    const iv = cryptoApi.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const encrypted = await encryptPayload(
      { verifier: input.verifier, nonce: input.nonce, environment: input.environment ?? "production" },
      iv,
      `${stateHash}.${bindingHash}`,
      encryptionKey,
      cryptoApi,
    );
    const expiresAt = input.createdAt + TRANSACTION_LIFETIME_MS;

    // Räumt verlassene Vorgänge bei einem neuen Login auf, damit abgelaufene
    // Zeilen nicht liegen bleiben, wenn jemand die OSM-Freigabe schließt.
    const cleanup = await database
      .prepare("DELETE FROM osm_oauth_transactions WHERE expires_at <= ?")
      .bind(input.createdAt)
      .run();
    if (!cleanup.success) throw new Error("D1 cleanup failed");

    const result = await database
      .prepare(
        `INSERT INTO osm_oauth_transactions
          (state_hash, browser_binding_hash, payload_iv, payload_ciphertext, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(stateHash, bindingHash, toBase64Url(iv), encrypted, input.createdAt, expiresAt)
      .run();

    if (!result.success || result.meta?.changes !== 1) {
      throw new Error("D1 write failed");
    }
  } catch {
    throw new Error("Die OSM-Anmeldung konnte nicht sicher vorbereitet werden.");
  }
}

/**
 * Löscht einen passenden, noch gültigen Vorgang atomar vor der Rückgabe seiner
 * Geheimnisse. Falsches Cookie, abgelaufener State und erneuter Callback ergeben null.
 */
export async function consumeOSMOAuthTransaction(
  database: D1Database,
  state: string,
  browserBinding: string,
  now: number,
  encryptionKey: CryptoKey,
  cryptoApi: Crypto = crypto,
): Promise<OSMOAuthTransactionPayload | null> {
  if (!isOAuthToken(state) || !isOAuthToken(browserBinding) || !Number.isSafeInteger(now) || now < 0) {
    return null;
  }

  try {
    const stateHash = await sha256Hex(state, cryptoApi);
    const bindingHash = await sha256Hex(browserBinding, cryptoApi);
    let encryptedPayload: EncryptedPayload | null;

    // DELETE ... RETURNING ist ein SQLite-Schritt: Zwei parallele Rücksprünge
    // können den Verifier nicht beide abrufen. D1 first() liefert die Ergebniszeile.
    encryptedPayload = await database
      .prepare(
        `DELETE FROM osm_oauth_transactions
         WHERE state_hash = ? AND browser_binding_hash = ? AND expires_at > ?
         RETURNING payload_iv, payload_ciphertext`,
      )
      .bind(stateHash, bindingHash, now)
      .first<EncryptedPayload>();

    if (!encryptedPayload || typeof encryptedPayload.payload_iv !== "string" || typeof encryptedPayload.payload_ciphertext !== "string") {
      return null;
    }

    const iv = fromBase64Url(encryptedPayload.payload_iv);
    if (iv.length !== AES_GCM_IV_BYTES) throw new Error("Invalid IV");

    const plaintext = await cryptoApi.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        // Bindet den Chiffretext an die Zeilenkennungen. Kopieren zwischen D1-
        // Zeilen schlägt dadurch bei der Authentizitätsprüfung fehl.
        additionalData: toArrayBuffer(new TextEncoder().encode(`${stateHash}.${bindingHash}`)),
      },
      encryptionKey,
      toArrayBuffer(fromBase64Url(encryptedPayload.payload_ciphertext)),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    if (!isPayload(payload)) throw new Error("Invalid payload");
    return { verifier: payload.verifier, nonce: payload.nonce, environment: payload.environment ?? "production" };
  } catch {
    // Der Eintrag ist bereits verbraucht. Beschädigte oder teilweise entschlüsselte
    // Daten werden nicht erneut versucht; ein neuer Login kann sicher starten.
    throw new Error("Die OSM-Anmeldung konnte nicht sicher fortgesetzt werden.");
  }
}

function validateInput(input: OSMOAuthTransactionInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Ungültige OSM-Anmeldung.");
  }
  if (
    !isOAuthToken(input.state) ||
    !isOAuthToken(input.browserBinding) ||
    !isVerifier(input.verifier) ||
    !isOAuthToken(input.nonce) ||
    (input.environment !== undefined && input.environment !== "production" && input.environment !== "development") ||
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt < 0 ||
    input.createdAt > Number.MAX_SAFE_INTEGER - TRANSACTION_LIFETIME_MS
  ) {
    throw new Error("Ungültige OSM-Anmeldung.");
  }
}

function isPayload(value: unknown): value is OSMOAuthTransactionPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return isVerifier(payload.verifier) && isOAuthToken(payload.nonce) &&
    (payload.environment === undefined || payload.environment === "production" || payload.environment === "development");
}

function isOAuthToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(value);
}

function isVerifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9._~-]+$/u.test(value);
}

async function encryptPayload(
  payload: OSMOAuthTransactionPayload,
  iv: Uint8Array,
  additionalData: string,
  encryptionKey: CryptoKey,
  cryptoApi: Crypto,
): Promise<string> {
  const encrypted = await cryptoApi.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(new TextEncoder().encode(additionalData)),
    },
    encryptionKey,
    toArrayBuffer(new TextEncoder().encode(JSON.stringify(payload))),
  );
  return toBase64Url(new Uint8Array(encrypted));
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
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
