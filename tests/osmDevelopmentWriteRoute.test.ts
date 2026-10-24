import { describe, expect, it } from "vitest";
import { createOSMSession } from "../server/storage/osmSessions";
import { storeOSMDevelopmentToken } from "../server/storage/osmDevelopmentTokens";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";
import { importOAuthEncryptionKey } from "../server/auth/osmOAuth";
import { handleDevelopmentCheckDate } from "../server/osm/developmentWriteRoute";

const now = Date.UTC(2026, 9, 24, 12);
const sessionToken = "s".repeat(43);
const operationId = "f1234567-89ab-4cde-8fab-123456789abc";
const keySecret = "k".repeat(43);
const requestBody = {
  operation_id: operationId,
  confirmed: true,
  target: "node/42",
  expected_version: 3,
  expected_check_date: "2025-10-20",
  observed_on: "2026-10-24",
};

type SessionRow = { session_hash: string; osm_subject: string; osm_environment: string; expires_at: number };
type TokenRow = { session_hash: string; token_iv: string; token_ciphertext: string; token_expires_at: number };
type OperationRow = {
  session_hash: string; operation_id: string; request_hash: string; state: string;
  changeset_id: string | null; result_version: number | null; result_node_id: string | null; expires_at: number;
};

class MemoryD1 implements D1Database {
  sessions = new Map<string, SessionRow>();
  tokens = new Map<string, TokenRow>();
  operations = new Map<string, OperationRow>();

  prepare(query: string): D1Statement {
    const memory = this;
    let values: unknown[] = [];
    return {
      bind(...nextValues: unknown[]) { values = nextValues; return this; },
      async first<T>() { return memory.query<T>(query, values); },
      async run<T = unknown>() { return memory.execute<T>(query, values); },
      query: <T>(sql: string, params: unknown[]): T | null => {
        if (sql.includes("FROM osm_sessions") && sql.includes("osm_subject")) {
          const [hash, time] = params as [string, number];
          const row = this.sessions.get(hash);
          return row && row.expires_at > time ? { osm_subject: row.osm_subject, osm_environment: row.osm_environment } as T : null;
        }
        if (sql.includes("SELECT session_hash FROM osm_sessions")) {
          const [hash, time] = params as [string, number];
          const row = this.sessions.get(hash);
          return row && row.expires_at > time ? { session_hash: hash } as T : null;
        }
        if (sql.includes("FROM osm_development_tokens")) {
          const [hash, tokenTime, activeHash, sessionTime] = params as [string, number, string, number];
          const token = this.tokens.get(hash);
          const session = this.sessions.get(activeHash);
          return token && token.token_expires_at > tokenTime && session && session.expires_at > sessionTime
            ? { token_iv: token.token_iv, token_ciphertext: token.token_ciphertext, token_expires_at: token.token_expires_at } as T
            : null;
        }
        if (sql.includes("FROM osm_development_write_operations")) {
          const [sessionHash, id, time] = params as [string, string, number];
          const row = this.operations.get(`${sessionHash}:${id}`);
          if (!row || row.expires_at <= time) return null;
          const { request_hash, state, changeset_id, result_version, result_node_id } = row;
          return { request_hash, state, changeset_id, result_version, result_node_id } as T;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      execute: <T>(sql: string, params: unknown[]): D1Result<T> => {
        if (sql.startsWith("DELETE FROM osm_sessions WHERE expires_at")) return { success: true, meta: { changes: 0 } };
        if (sql.startsWith("INSERT INTO osm_sessions")) {
          const [hash, subject, env, _created, expires] = params as [string, string, string, number, number];
          this.sessions.set(hash, { session_hash: hash, osm_subject: subject, osm_environment: env, expires_at: expires });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO osm_development_tokens")) {
          const [hash, iv, cipher, expires, _created] = params as [string, string, string, number, number];
          this.tokens.set(hash, { session_hash: hash, token_iv: iv, token_ciphertext: cipher, token_expires_at: expires });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM osm_development_tokens")) {
          this.tokens.delete(params[0] as string);
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM osm_development_write_operations")) {
          const [hash, time] = params as [string, number];
          for (const [id, row] of this.operations) if (row.session_hash === hash && row.expires_at <= time) this.operations.delete(id);
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT OR IGNORE INTO osm_development_write_operations")) {
          const [hash, id, requestHash, _created, _updated, expires] = params as [string, string, string, number, number, number];
          const key = `${hash}:${id}`;
          if (this.operations.has(key)) return { success: true, meta: { changes: 0 } };
          this.operations.set(key, { session_hash: hash, operation_id: id, request_hash: requestHash, state: "started", changeset_id: null, result_version: null, result_node_id: null, expires_at: expires });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("SET state = 'uploading'")) {
          const [_updated, hash, id, time] = params as [number, string, string, number];
          const row = this.operations.get(`${hash}:${id}`);
          if (!row || row.state !== "changeset-created" || row.expires_at <= time) return { success: true, meta: { changes: 0 } };
          row.state = "uploading"; return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("SET state = ?, changeset_id = COALESCE")) {
          const [state, changesetId, resultVersion, resultNodeId, _updated, hash, id] = params as [string, string | null, number | null, string | null, number, string, string];
          const row = this.operations.get(`${hash}:${id}`);
          if (!row) return { success: true, meta: { changes: 0 } };
          row.state = state;
          if (changesetId !== null) row.changeset_id = changesetId;
          if (resultVersion !== null) row.result_version = resultVersion;
          if (resultNodeId !== null) row.result_node_id = resultNodeId;
          return { success: true, meta: { changes: 1 } };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as unknown as D1Statement;
  }

  query<T>(sql: string, params: unknown[]): T | null {
    if (sql.includes("FROM osm_sessions") && sql.includes("osm_subject")) {
      const [hash, time] = params as [string, number];
      const row = this.sessions.get(hash);
      return row && row.expires_at > time ? { osm_subject: row.osm_subject, osm_environment: row.osm_environment } as T : null;
    }
    if (sql.includes("SELECT session_hash FROM osm_sessions")) {
      const [hash, time] = params as [string, number];
      const row = this.sessions.get(hash);
      return row && row.expires_at > time ? { session_hash: hash } as T : null;
    }
    if (sql.includes("FROM osm_development_tokens")) {
      const [hash, tokenTime, activeHash, sessionTime] = params as [string, number, string, number];
      const token = this.tokens.get(hash);
      const session = this.sessions.get(activeHash);
      return token && token.token_expires_at > tokenTime && session && session.expires_at > sessionTime
        ? { token_iv: token.token_iv, token_ciphertext: token.token_ciphertext, token_expires_at: token.token_expires_at } as T
        : null;
    }
    if (sql.includes("FROM osm_development_write_operations")) {
      const [sessionHash, id, time] = params as [string, string, number];
      const row = this.operations.get(`${sessionHash}:${id}`);
      if (!row || row.expires_at <= time) return null;
      const { request_hash, state, changeset_id, result_version, result_node_id } = row;
      return { request_hash, state, changeset_id, result_version, result_node_id } as T;
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  execute<T>(sql: string, params: unknown[]): D1Result<T> {
    if (sql.startsWith("DELETE FROM osm_sessions WHERE expires_at")) return { success: true, meta: { changes: 0 } };
    if (sql.startsWith("INSERT INTO osm_sessions")) {
      const [hash, subject, env, _created, expires] = params as [string, string, string, number, number];
      this.sessions.set(hash, { session_hash: hash, osm_subject: subject, osm_environment: env, expires_at: expires });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO osm_development_tokens")) {
      const [hash, iv, cipher, expires, _created] = params as [string, string, string, number, number];
      this.tokens.set(hash, { session_hash: hash, token_iv: iv, token_ciphertext: cipher, token_expires_at: expires });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM osm_development_tokens")) {
      this.tokens.delete(params[0] as string);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM osm_development_write_operations")) {
      const [hash, time] = params as [string, number];
      for (const [id, row] of this.operations) if (row.session_hash === hash && row.expires_at <= time) this.operations.delete(id);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT OR IGNORE INTO osm_development_write_operations")) {
      const [hash, id, requestHash, _created, _updated, expires] = params as [string, string, string, number, number, number];
      const key = `${hash}:${id}`;
      if (this.operations.has(key)) return { success: true, meta: { changes: 0 } };
      this.operations.set(key, { session_hash: hash, operation_id: id, request_hash: requestHash, state: "started", changeset_id: null, result_version: null, result_node_id: null, expires_at: expires });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET state = 'uploading'")) {
      const [_updated, hash, id, time] = params as [number, string, string, number];
      const row = this.operations.get(`${hash}:${id}`);
      if (!row || row.state !== "changeset-created" || row.expires_at <= time) return { success: true, meta: { changes: 0 } };
      row.state = "uploading"; return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET state = ?, changeset_id = COALESCE")) {
      const [state, changesetId, resultVersion, resultNodeId, _updated, hash, id] = params as [string, string | null, number | null, string | null, number, string, string];
      const row = this.operations.get(`${hash}:${id}`);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.state = state;
      if (changesetId !== null) row.changeset_id = changesetId;
      if (resultVersion !== null) row.result_version = resultVersion;
      if (resultNodeId !== null) row.result_node_id = resultNodeId;
      return { success: true, meta: { changes: 1 } };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

async function setupDatabase(environmentName: "development" | "production" = "development"): Promise<MemoryD1> {
  const database = new MemoryD1();
  await createOSMSession(database, sessionToken, "test-subject", now - 1_000, environmentName);
  const key = await importOAuthEncryptionKey(keySecret);
  await storeOSMDevelopmentToken(database, sessionToken, "dev-bearer-token", now + 60 * 60 * 1_000, now, key);
  return database;
}

function makeRequest(payload: unknown = requestBody): Request {
  return new Request("https://aedjaeger.example/api/osm/development/check-date", {
    method: "POST",
    headers: { Cookie: `aedjaeger_osm_session=${sessionToken}`, "Content-Type": "application/json", Origin: "https://aedjaeger.example" },
    body: JSON.stringify(payload),
  });
}

function makeFetch(options: { appliedAfterUploadFailure?: boolean; conflictVersion?: number } = {}) {
  let version = options.conflictVersion ?? 3;
  let checkDate = "2025-10-20";
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  let failAfterUpload = options.appliedAfterUploadFailure ?? false;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : undefined;
    calls.push({ method, url, body });
    if (url.endsWith("/api/0.6/node/42.json")) {
      return Response.json({ version: "0.6", elements: [{ type: "node", id: 42, lat: 52.52, lon: 13.4, version, tags: { emergency: "defibrillator", name: "Clinic & hall", check_date: checkDate } }] });
    }
    if (url.endsWith("/api/0.6/changeset/create")) return new Response("77", { status: 200 });
    if (url.endsWith("/api/0.6/changeset/77/upload")) {
      expect(body).toContain('<tag k="check_date" v="2026-10-24"/>');
      expect(body).toContain('<tag k="name" v="Clinic &amp; hall"/>');
      if (failAfterUpload) {
        failAfterUpload = false;
        version = 4;
        checkDate = "2026-10-24";
        throw new Error("simulated connection loss after server accepted the write");
      }
      version = 4;
      checkDate = "2026-10-24";
      return new Response('<diffResult><node old_id="42" new_id="42" new_version="4"/></diffResult>', { status: 200 });
    }
    if (url.endsWith("/api/0.6/changeset/77/close")) return new Response(null, { status: 200 });
    throw new Error(`Unexpected OSM API request: ${method} ${url}`);
  };
  return { fetcher, calls };
}

const environment = { OSM_DEV_WRITES_ENABLED: "true", OSM_OAUTH_ENCRYPTION_KEY: keySecret };

describe("OSM development check-date writer", () => {
  it("updates only check_date in a confirmed test-server node and completes duplicate requests idempotently", async () => {
    const DB = await setupDatabase();
    const { fetcher, calls } = makeFetch();
    const workerEnvironment = { ...environment, DB };
    const dependencies = { now: () => now, fetch: fetcher };

    const first = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "complete", version: 4 });
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(1);
    expect(calls.find((call) => call.url.endsWith("/upload"))?.body).toContain('<tag k="emergency" v="defibrillator"/>');

    const duplicate = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ status: "complete", version: 4 });
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(1);
  });

  it("refuses production sessions before calling any OSM endpoint", async () => {
    const DB = await setupDatabase("production");
    let calls = 0;
    const response = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, { now: () => now, fetch: async () => { calls++; return new Response(); } });
    expect(response.status).toBe(403);
    expect(calls).toBe(0);
  });

  it("rejects stale OSM versions before opening a changeset", async () => {
    const DB = await setupDatabase();
    const { fetcher, calls } = makeFetch({ conflictVersion: 4 });
    const response = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, { now: () => now, fetch: fetcher });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "version_conflict" });
    expect(calls.some((call) => call.url.endsWith("/changeset/create"))).toBe(false);
  });

  it("reconciles a lost upload response without creating a duplicate edit", async () => {
    const DB = await setupDatabase();
    const { fetcher, calls } = makeFetch({ appliedAfterUploadFailure: true });
    const workerEnvironment = { ...environment, DB };
    const dependencies = { now: () => now, fetch: fetcher };
    const first = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ status: "uncertain" });

    const retry = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: "complete", version: 4 });
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(1);
  });

  it("keeps an unapplied timeout uncertain and never retries the write automatically", async () => {
    const DB = await setupDatabase();
    const { fetcher, calls } = makeFetch();
    let shouldFail = true;
    const fetchWithTimeout: typeof fetch = async (input, init = {}) => {
      if (String(input).endsWith("/upload") && shouldFail) { shouldFail = false; throw new Error("network failed"); }
      return fetcher(input, init);
    };
    const workerEnvironment = { ...environment, DB };
    const dependencies = { now: () => now, fetch: fetchWithTimeout };
    const first = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(first.status).toBe(202);
    const retry = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(retry.status).toBe(202);
    expect(await retry.json()).toEqual({ status: "uncertain" });
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(0);
  });

  it("fails closed when the test-write switch is off or the proposal was not confirmed", async () => {
    const DB = await setupDatabase();
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return new Response(); };
    const disabled = await handleDevelopmentCheckDate(makeRequest(), { ...environment, OSM_DEV_WRITES_ENABLED: "false", DB }, { now: () => now, fetch: fetcher });
    const unconfirmed = await handleDevelopmentCheckDate(makeRequest({ ...requestBody, confirmed: false }), { ...environment, DB }, { now: () => now, fetch: fetcher });
    expect(disabled.status).toBe(503);
    expect(unconfirmed.status).toBe(400);
    expect(calls).toBe(0);
  });
});
