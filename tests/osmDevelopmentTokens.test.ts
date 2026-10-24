import { describe, expect, it } from "vitest";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";
import {
  deleteOSMDevelopmentToken,
  findOSMDevelopmentToken,
  storeOSMDevelopmentToken,
} from "../server/storage/osmDevelopmentTokens";

const now = 1_800_000_000_000;
const sessionToken = "a".repeat(43);
const accessToken = "osm-dev-access-token-do-not-store-in-plain-text";

function createDatabase() {
  const sessions = new Map<string, number>();
  const tokens = new Map<string, {
    token_iv: string;
    token_ciphertext: string;
    token_expires_at: number;
    created_at: number;
  }>();
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const database: D1Database = {
    prepare(query: string): D1Statement {
      let values: unknown[] = [];
      const statement: D1Statement = {
        bind(...boundValues) { values = boundValues; return statement; },
        async run<T>() {
          calls.push({ query, values });
          if (query.includes("INSERT INTO osm_development_tokens")) {
            const [hash, token_iv, token_ciphertext, token_expires_at, created_at] = values;
            tokens.set(String(hash), {
              token_iv: String(token_iv),
              token_ciphertext: String(token_ciphertext),
              token_expires_at: Number(token_expires_at),
              created_at: Number(created_at),
            });
            return { success: true, meta: { changes: 1 } } as D1Result<T>;
          }
          if (query.includes("DELETE FROM osm_development_tokens")) {
            return { success: true, meta: { changes: Number(tokens.delete(String(values[0]))) } } as D1Result<T>;
          }
          throw new Error(`Unexpected D1 query: ${query}`);
        },
        async first<T>() {
          calls.push({ query, values });
          const hash = String(values[0]);
          if (query.includes("FROM osm_sessions")) {
            const expiresAt = sessions.get(hash);
            return expiresAt !== undefined && expiresAt > Number(values[1]) ? { session_hash: hash } as T : null;
          }
          if (query.includes("FROM osm_development_tokens")) {
            const token = tokens.get(hash);
            const sessionExpiresAt = sessions.get(hash);
            if (
              !token ||
              token.token_expires_at <= Number(values[1]) ||
              sessionExpiresAt === undefined ||
              sessionExpiresAt <= Number(values[3])
            ) return null;
            return {
              token_iv: token.token_iv,
              token_ciphertext: token.token_ciphertext,
              token_expires_at: token.token_expires_at,
            } as T;
          }
          throw new Error(`Unexpected D1 query: ${query}`);
        },
      };
      return statement;
    },
  };
  return { database, sessions, tokens, calls };
}

async function encryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

describe("OSM development token vault", () => {
  it("stores the token encrypted and returns it only to the active session", async () => {
    const { database, sessions, tokens, calls } = createDatabase();
    const hash = await sha256(sessionToken);
    sessions.set(hash, now + 60_000);
    const key = await encryptionKey();

    await storeOSMDevelopmentToken(database, sessionToken, accessToken, now + 30_000, now, key);

    const row = tokens.get(hash);
    expect(row).toBeDefined();
    expect(row?.token_ciphertext).not.toContain(accessToken);
    expect(calls.some((call) => call.values.includes(accessToken))).toBe(false);
    await expect(findOSMDevelopmentToken(database, sessionToken, now + 1, key)).resolves.toBe(accessToken);
    await expect(findOSMDevelopmentToken(database, "b".repeat(43), now + 1, key)).resolves.toBeNull();
  });

  it("replaces a stored token and does not return it after its expiry", async () => {
    const { database, sessions, tokens } = createDatabase();
    const hash = await sha256(sessionToken);
    sessions.set(hash, now + 60_000);
    const key = await encryptionKey();
    await storeOSMDevelopmentToken(database, sessionToken, accessToken, now + 30_000, now, key);
    await storeOSMDevelopmentToken(database, sessionToken, "replacement-token", now + 20_000, now + 1, key);

    await expect(findOSMDevelopmentToken(database, sessionToken, now + 20_000, key)).resolves.toBeNull();
    expect(tokens.has(hash)).toBe(false);
  });

  it("rejects decryption with a different key and deletes a token on logout", async () => {
    const { database, sessions, tokens } = createDatabase();
    const hash = await sha256(sessionToken);
    sessions.set(hash, now + 60_000);
    const key = await encryptionKey();
    await storeOSMDevelopmentToken(database, sessionToken, accessToken, now + 30_000, now, key);

    await expect(findOSMDevelopmentToken(database, sessionToken, now + 1, await encryptionKey())).rejects.toThrow("nicht sicher gelesen");
    await deleteOSMDevelopmentToken(database, sessionToken);
    expect(tokens.has(hash)).toBe(false);
  });

  it("rejects malformed values before touching D1", async () => {
    const database: D1Database = { prepare: () => { throw new Error("database should not be used"); } };
    const key = await encryptionKey();

    await expect(storeOSMDevelopmentToken(database, "short", accessToken, now + 1, now, key)).rejects.toThrow("Ungültiger");
    await expect(storeOSMDevelopmentToken(database, sessionToken, "bad\nvalue", now + 1, now, key)).rejects.toThrow("Ungültiger");
    await expect(findOSMDevelopmentToken(database, "short", now, key)).resolves.toBeNull();
  });
});

async function sha(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
