import { describe, expect, it } from "vitest";
import type { D1Database, D1Result, D1Statement } from "../server/storage/analysisBudget";
import {
  consumeOSMOAuthTransaction,
  storeOSMOAuthTransaction,
  type OSMOAuthTransactionInput,
} from "../server/storage/osmOAuthTransactions";

const validInput: OSMOAuthTransactionInput = {
  state: "state-value-that-is-long-enough-to-pass-validation-123456",
  browserBinding: "browser-cookie-binding-value-is-long-enough-123456",
  verifier: "pkce-verifier-value-that-is-long-enough-to-pass-123456",
  nonce: "oidc-nonce-value-that-is-long-enough-to-pass-validation-123456",
  createdAt: 1_792_485_000_000,
};

function createDatabase(returnPayload = true) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  let storedRow: {
    stateHash: string;
    bindingHash: string;
    expiresAt: number;
    payload_iv: string;
    payload_ciphertext: string;
  } | null = null;
  let consumed = false;
  const database: D1Database = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement: D1Statement = {
        bind(...boundValues) {
          values = boundValues;
          return statement;
        },
        async run<T>() {
          calls.push({ query, values });
          if (query.includes("INSERT INTO osm_oauth_transactions")) {
            storedRow = {
              stateHash: String(values[0]),
              bindingHash: String(values[1]),
              expiresAt: Number(values[5]),
              payload_iv: String(values[2]),
              payload_ciphertext: String(values[3]),
            };
          }
          return { success: true, meta: { changes: 1 } } as D1Result<T>;
        },
        async first<T>() {
          calls.push({ query, values });
          if (
            consumed ||
            !returnPayload ||
            !storedRow ||
            storedRow.stateHash !== values[0] ||
            storedRow.bindingHash !== values[1] ||
            storedRow.expiresAt <= Number(values[2])
          ) return null;
          consumed = true;
          return { payload_iv: storedRow.payload_iv, payload_ciphertext: storedRow.payload_ciphertext } as T;
        },
      };
      return statement;
    },
  };
  return { database, calls };
}

async function createEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

describe("OSM OAuth transaction storage", () => {
  it("stores hashed state and browser binding with an encrypted short-lived payload", async () => {
    const { database, calls } = createDatabase();
    const key = await createEncryptionKey();

    await storeOSMOAuthTransaction(database, validInput, key);

    expect(calls).toHaveLength(2);
    expect(calls[0].query).toContain("DELETE FROM osm_oauth_transactions WHERE expires_at <= ?");
    const insert = calls[1];
    expect(insert.query).toContain("INSERT INTO osm_oauth_transactions");
    expect(insert.values[0]).not.toBe(validInput.state);
    expect(insert.values[1]).not.toBe(validInput.browserBinding);
    expect(insert.values[2]).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(insert.values[3]).not.toContain(validInput.verifier);
    expect(insert.values[3]).not.toContain(validInput.nonce);
    expect(insert.values[4]).toBe(validInput.createdAt);
    expect(insert.values[5]).toBe(validInput.createdAt + 600_000);
  });

  it("consumes and decrypts a transaction once using its browser binding", async () => {
    const { database, calls } = createDatabase();
    const key = await createEncryptionKey();
    await storeOSMOAuthTransaction(database, validInput, key);

    await expect(
      consumeOSMOAuthTransaction(database, validInput.state, validInput.browserBinding, validInput.createdAt + 1, key),
    ).resolves.toEqual({ verifier: validInput.verifier, nonce: validInput.nonce });
    await expect(
      consumeOSMOAuthTransaction(database, validInput.state, validInput.browserBinding, validInput.createdAt + 1, key),
    ).resolves.toBeNull();

    const deletion = calls[2];
    expect(deletion.query).toContain("DELETE FROM osm_oauth_transactions");
    expect(deletion.query).toContain("RETURNING payload_iv, payload_ciphertext");
    expect(deletion.values[0]).not.toBe(validInput.state);
    expect(deletion.values[1]).not.toBe(validInput.browserBinding);
    expect(deletion.values[2]).toBe(validInput.createdAt + 1);
  });

  it("returns no transaction at its expiry boundary", async () => {
    const { database } = createDatabase();
    const key = await createEncryptionKey();
    await storeOSMOAuthTransaction(database, validInput, key);

    await expect(
      consumeOSMOAuthTransaction(database, validInput.state, validInput.browserBinding, validInput.createdAt + 600_000, key),
    ).resolves.toBeNull();
  });

  it("does not consume a transaction when the browser-binding cookie differs", async () => {
    const { database } = createDatabase();
    const key = await createEncryptionKey();
    await storeOSMOAuthTransaction(database, validInput, key);

    await expect(
      consumeOSMOAuthTransaction(
        database,
        validInput.state,
        "different-browser-binding-value-is-long-enough-123456",
        validInput.createdAt + 1,
        key,
      ),
    ).resolves.toBeNull();
    await expect(
      consumeOSMOAuthTransaction(database, validInput.state, validInput.browserBinding, validInput.createdAt + 1, key),
    ).resolves.toEqual({ verifier: validInput.verifier, nonce: validInput.nonce });
  });

  it("fails closed and consumes the row when ciphertext cannot be authenticated", async () => {
    const { database } = createDatabase();
    const originalKey = await createEncryptionKey();
    const wrongKey = await createEncryptionKey();
    await storeOSMOAuthTransaction(database, validInput, originalKey);

    await expect(
      consumeOSMOAuthTransaction(database, validInput.state, validInput.browserBinding, validInput.createdAt + 1, wrongKey),
    ).rejects.toThrow("nicht sicher fortgesetzt");
    await expect(
      consumeOSMOAuthTransaction(database, validInput.state, validInput.browserBinding, validInput.createdAt + 1, originalKey),
    ).resolves.toBeNull();
  });

  it("rejects malformed transaction values before accessing D1", async () => {
    const { database, calls } = createDatabase();
    const key = await createEncryptionKey();

    await expect(storeOSMOAuthTransaction(database, { ...validInput, browserBinding: "short" }, key)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("hides D1 and decryption failures and consumes corrupted payloads", async () => {
    const database: D1Database = {
      prepare() {
        return {
          bind() {
            return this;
          },
          run<T>() {
            return Promise.reject(new Error("private D1 details")) as Promise<D1Result<T>>;
          },
          first<T>() {
            return Promise.reject(new Error("private D1 details")) as Promise<T | null>;
          },
        };
      },
    };
    const key = await createEncryptionKey();

    await expect(storeOSMOAuthTransaction(database, validInput, key)).rejects.toThrow("nicht sicher vorbereitet");
    await expect(
      consumeOSMOAuthTransaction(database, validInput.state, validInput.browserBinding, validInput.createdAt + 1, key),
    ).rejects.toThrow("nicht sicher fortgesetzt");
  });
});
