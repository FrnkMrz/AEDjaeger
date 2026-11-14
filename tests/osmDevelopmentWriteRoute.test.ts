import { describe, expect, it } from "vitest";
import { createOSMSession } from "../server/storage/osmSessions";
import { storeOSMDevelopmentToken } from "../server/storage/osmDevelopmentTokens";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";
import { importOAuthEncryptionKey } from "../server/auth/osmOAuth";
import { hashOSMDevelopmentWriteOwner, hashOSMDevelopmentWriteValue } from "../server/storage/osmDevelopmentWriteOperations";
import { handleDevelopmentCheckDate } from "../server/osm/developmentWriteRoute";

const now = Date.UTC(2026, 9, 24, 12);
const sessionToken = "s".repeat(43);
const rotatedSessionToken = "r".repeat(43);
const operationId = "f1234567-89ab-4cde-8fab-123456789abc";
const keySecret = "k".repeat(43);
const requestBody = {
  recovery_identity: await hashOSMDevelopmentWriteOwner({ subject: "test-subject", environment: "development" }, keySecret),
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
  owner_hash: string; operation_id: string; request_hash: string; state: string;
  changeset_id: string | null; result_version: number | null; result_node_id: string | null; updated_at: number; expires_at: number;
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
          const { request_hash, state, changeset_id, result_version, result_node_id, updated_at } = row;
          return { request_hash, state, changeset_id, result_version, result_node_id, updated_at } as T;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      execute: <T>(sql: string, params: unknown[]): D1Result<T> => {
        if (sql.startsWith("UPDATE osm_development_write_operations SET owner_hash")) return { success: true, meta: { changes: 0 } };
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
          const [time] = params as [number];
          for (const [id, row] of this.operations) if (row.expires_at <= time) this.operations.delete(id);
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT OR IGNORE INTO osm_development_write_operations")) {
          const [hash, id, requestHash, _created, _updated, expires] = params as [string, string, string, number, number, number];
          const key = `${hash}:${id}`;
          if (this.operations.has(key)) return { success: true, meta: { changes: 0 } };
          this.operations.set(key, { owner_hash: hash, operation_id: id, request_hash: requestHash, state: "started", changeset_id: null, result_version: null, result_node_id: null, updated_at: _updated, expires_at: expires });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("SET state = 'uploading'")) {
          const [_updated, hash, id, time] = params as [number, string, string, number];
          const row = this.operations.get(`${hash}:${id}`);
          if (!row || row.state !== "changeset-created" || row.expires_at <= time) return { success: true, meta: { changes: 0 } };
          row.state = "uploading"; return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("state IN ('uploading', 'uncertain')")) {
          const [updated, hash, id, changeset, time] = params as [number, string, string, string, number];
          const row = this.operations.get(hash + ":" + id);
          if (!row || row.changeset_id !== changeset || !["uploading", "uncertain"].includes(row.state) || row.expires_at <= time) {
            return { success: true, meta: { changes: 0 } };
          }
          row.state = "failed";
          row.updated_at = updated;
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("SET state = ?, changeset_id = COALESCE")) {
          const [state, changesetId, resultVersion, resultNodeId, _updated, hash, id] = params as [string, string | null, number | null, string | null, number, string, string];
          const row = this.operations.get(`${hash}:${id}`);
          if (!row) return { success: true, meta: { changes: 0 } };
          row.state = state;
          if (changesetId !== null) row.changeset_id = changesetId;
          if (resultVersion !== null) row.result_version = resultVersion;
          if (resultNodeId !== null) row.result_node_id = resultNodeId;
          row.updated_at = _updated;
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
      const { request_hash, state, changeset_id, result_version, result_node_id, updated_at } = row;
      return { request_hash, state, changeset_id, result_version, result_node_id, updated_at } as T;
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  execute<T>(sql: string, params: unknown[]): D1Result<T> {
    if (sql.startsWith("UPDATE osm_development_write_operations SET owner_hash")) return { success: true, meta: { changes: 0 } };
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
      const [time] = params as [number];
      for (const [id, row] of this.operations) if (row.expires_at <= time) this.operations.delete(id);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT OR IGNORE INTO osm_development_write_operations")) {
      const [hash, id, requestHash, _created, _updated, expires] = params as [string, string, string, number, number, number];
      const key = `${hash}:${id}`;
      if (this.operations.has(key)) return { success: true, meta: { changes: 0 } };
      this.operations.set(key, { owner_hash: hash, operation_id: id, request_hash: requestHash, state: "started", changeset_id: null, result_version: null, result_node_id: null, updated_at: _updated, expires_at: expires });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET state = 'uploading'")) {
      const [_updated, hash, id, time] = params as [number, string, string, number];
      const row = this.operations.get(`${hash}:${id}`);
      if (!row || row.state !== "changeset-created" || row.expires_at <= time) return { success: true, meta: { changes: 0 } };
      row.state = "uploading"; return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("state IN ('uploading', 'uncertain')")) {
      const [updated, hash, id, changeset, time] = params as [number, string, string, string, number];
      const row = this.operations.get(hash + ":" + id);
      if (!row || row.changeset_id !== changeset || !["uploading", "uncertain"].includes(row.state) || row.expires_at <= time) {
        return { success: true, meta: { changes: 0 } };
      }
      row.state = "failed";
      row.updated_at = updated;
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET state = ?, changeset_id = COALESCE")) {
      const [state, changesetId, resultVersion, resultNodeId, _updated, hash, id] = params as [string, string | null, number | null, string | null, number, string, string];
      const row = this.operations.get(`${hash}:${id}`);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.state = state;
      if (changesetId !== null) row.changeset_id = changesetId;
      if (resultVersion !== null) row.result_version = resultVersion;
      if (resultNodeId !== null) row.result_node_id = resultNodeId;
      row.updated_at = _updated;
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

function makeRequest(payload: unknown = requestBody, token = sessionToken): Request {
  return new Request("https://aedjaeger.example/api/osm/development/check-date", {
    method: "POST",
    headers: { Cookie: `aedjaeger_osm_session=${token}`, "Content-Type": "application/json", Origin: "https://aedjaeger.example" },
    body: JSON.stringify(payload),
  });
}

function makeFetch(options: {
  appliedAfterUploadFailure?: boolean;
  changesetCloseConflict?: "closed" | "open";
  malformedChangesetDownloads?: string[];
  changesetOpenFailure?: boolean;
  conflictVersion?: number;
  observedOn?: string;
  missingNode?: boolean;
} = {}) {
  let version = options.conflictVersion ?? 3;
  let checkDate = "2025-10-20";
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  let failAfterUpload = options.appliedAfterUploadFailure ?? false;
  let uploadApplied = false;
  const malformedDownloads = [...(options.malformedChangesetDownloads ?? [])];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : undefined;
    calls.push({ method, url, body });
    if (options.missingNode && url.endsWith("/api/0.6/node/42.json")) return new Response("Not Found", { status: 404 });
    if (url.endsWith("/api/0.6/node/42.json")) {
      return Response.json({ version: "0.6", elements: [{ type: "node", id: 42, lat: 52.52, lon: 13.4, version, tags: { emergency: "defibrillator", name: "Clinic & hall", check_date: checkDate } }] });
    }
    if (url.endsWith("/api/0.6/changeset/create")) {
      return options.changesetOpenFailure ? new Response("unavailable", { status: 503 }) : new Response("77", { status: 200 });
    }
    if (url.endsWith("/api/0.6/changeset/77/upload")) {
      expect(body).toContain(`<tag k="check_date" v="${options.observedOn ?? "2026-10-24"}"/>`);
      expect(body).toContain('<tag k="name" v="Clinic &amp; hall"/>');
      if (failAfterUpload) {
        failAfterUpload = false;
        uploadApplied = true;
        version = 4;
        checkDate = options.observedOn ?? "2026-10-24";
        throw new Error("simulated connection loss after server accepted the write");
      }
      uploadApplied = true;
      version = 4;
      checkDate = options.observedOn ?? "2026-10-24";
      return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<diffResult generator="OpenStreetMap server" version="0.6">\n <node old_id="42" new_id="42" new_version="4"/>\n</diffResult>\n', { status: 200 });
    }
    if (url.endsWith("/api/0.6/changeset/77/close")) {
      return options.changesetCloseConflict ? new Response("conflict", { status: 409 }) : new Response(null, { status: 200 });
    }
    if (url.endsWith("/api/0.6/changeset/77")) {
      return Response.json({ changeset: { id: "77", open: options.changesetCloseConflict === "open" } });
    }
    if (url.endsWith("/api/0.6/changeset/77/download")) {
      if (!uploadApplied) return new Response('<osmChange version="0.6"><create/><modify/><delete/></osmChange>', { status: 200 });
      if (malformedDownloads.length > 0) return new Response(malformedDownloads.shift(), { status: 200 });
      const download = '<osmChange version="0.6"><modify><node id="42" changeset="77" version="' + version
        + '"><tag k="emergency" v="defibrillator"/><tag k="check_date" v="' + checkDate
        + '"/></node></modify></osmChange>';
      return new Response(download, { status: 200 });
    }
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

  it("uses a fresh targeted OSM node read when the static AED index has no version", async () => {
    const DB = await setupDatabase();
    const { fetcher, calls } = makeFetch();
    const { expected_version: _ignored, ...versionlessRequest } = requestBody;
    const response = await handleDevelopmentCheckDate(makeRequest(versionlessRequest), { ...environment, DB }, { now: () => now, fetch: fetcher });
    expect(response.status).toBe(200);
    expect(calls[0].url).toMatch(/\/api\/0\.6\/node\/42\.json$/u);
    expect(calls.find((call) => call.url.endsWith("/upload"))?.body).toContain('<tag k="check_date" v="2026-10-24"/>');
  });

  it("writes a confirmed historical observation date from an older photo", async () => {
    const DB = await setupDatabase();
    const historicalDate = "2026-10-21";
    const { fetcher, calls } = makeFetch({ observedOn: historicalDate });
    const response = await handleDevelopmentCheckDate(
      makeRequest({ ...requestBody, observed_on: historicalDate }),
      { ...environment, DB },
      { now: () => now, fetch: fetcher },
    );
    expect(response.status).toBe(200);
    expect(calls.find((call) => call.url.endsWith("/upload"))?.body).toContain(`<tag k="check_date" v="${historicalDate}"/>`);
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

  it("reports a node that does not exist on the test server as a definite failure, without opening a changeset", async () => {
    // Typisch für einen AED aus dem Archiv des echten OSM: Die Entwicklungsinstanz hat eine eigene Datenbank.
    const DB = await setupDatabase();
    const { fetcher, calls } = makeFetch({ missingNode: true });
    const first = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, { now: () => now, fetch: fetcher });
    expect(first.status).toBe(404);
    expect(await first.json()).toEqual({ error: "target_not_found" });
    expect(calls.some((call) => call.url.endsWith("/changeset/create"))).toBe(false);
    // Eine Wiederholung mit derselben Vorgangsnummer ergibt dieselbe endgültige Antwort und öffnet nichts.
    const retry = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, { now: () => now, fetch: fetcher });
    expect(retry.status).toBe(502);
    expect(await retry.json()).toEqual({ error: "write_failed" });
    expect(calls.some((call) => call.url.endsWith("/changeset/create"))).toBe(false);
  });

  it("removes expired operation rows even when their owner is inactive", async () => {
    const DB = await setupDatabase();
    DB.operations.set(`inactive-owner:${operationId}`, {
      owner_hash: "c".repeat(64), operation_id: operationId, request_hash: "d".repeat(64), state: "complete",
      changeset_id: "77", result_version: 4, result_node_id: null, updated_at: now - 100_000, expires_at: now - 1,
    });
    const { fetcher } = makeFetch();

    const response = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, { now: () => now, fetch: fetcher });

    expect(response.status).toBe(200);
    expect(DB.operations.has(`inactive-owner:${operationId}`)).toBe(false);
  });

  it("reconciles a lost upload response without creating a duplicate edit", async () => {
    const DB = await setupDatabase();
    await createOSMSession(DB, rotatedSessionToken, "test-subject", now, "development");
    const key = await importOAuthEncryptionKey(keySecret);
    await storeOSMDevelopmentToken(DB, rotatedSessionToken, "replacement-dev-bearer-token", now + 60 * 60 * 1_000, now, key);
    const { fetcher, calls } = makeFetch({ appliedAfterUploadFailure: true, changesetCloseConflict: "closed" });
    const workerEnvironment = { ...environment, DB };
    const dependencies = { now: () => now, fetch: fetcher };
    const first = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ status: "uncertain" });

    const retry = await handleDevelopmentCheckDate(makeRequest(requestBody, rotatedSessionToken), workerEnvironment, dependencies);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: "complete", version: 4 });
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(1);
    expect(calls.some((call) => call.url.endsWith("/changeset/77/download"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/changeset/77") && call.method === "GET")).toBe(true);
  });

  it("reconciles an uncertain operation after the same OSM test account gets a new session", async () => {
    const DB = await setupDatabase();
    await createOSMSession(DB, rotatedSessionToken, "test-subject", now, "development");
    const key = await importOAuthEncryptionKey(keySecret);
    await storeOSMDevelopmentToken(DB, rotatedSessionToken, "replacement-dev-bearer-token", now + 60 * 60 * 1_000, now, key);
    const { fetcher, calls } = makeFetch({ appliedAfterUploadFailure: true, changesetCloseConflict: "closed" });
    const dependencies = { now: () => now, fetch: fetcher };
    const first = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, dependencies);
    expect(first.status).toBe(202);

    const resumed = await handleDevelopmentCheckDate(makeRequest(requestBody, rotatedSessionToken), { ...environment, DB }, dependencies);
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ status: "complete", version: 4 });
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(1);
  });

  it("replays a pre-account-binding operation hash after the same account gets a new session", async () => {
    const DB = await setupDatabase();
    await createOSMSession(DB, rotatedSessionToken, "test-subject", now, "development");
    const key = await importOAuthEncryptionKey(keySecret);
    await storeOSMDevelopmentToken(DB, rotatedSessionToken, "replacement-dev-bearer-token", now + 60 * 60 * 1_000, now, key);
    const ownerHash = await hashOSMDevelopmentWriteOwner({ subject: "test-subject", environment: "development" }, keySecret);
    const oldPayloadHash = await hashOSMDevelopmentWriteValue(JSON.stringify({ ...requestBody, recovery_identity: undefined }));
    const { fetcher, calls } = makeFetch({ appliedAfterUploadFailure: true, changesetCloseConflict: "closed" });
    const first = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, { now: () => now, fetch: fetcher });
    expect(first.status).toBe(202);
    const legacyOperation = DB.operations.get(`${ownerHash}:${operationId}`);
    expect(legacyOperation).toBeDefined();
    // This is the payload hash persisted by the release before recovery_identity existed.
    legacyOperation!.request_hash = oldPayloadHash;

    const retry = await handleDevelopmentCheckDate(makeRequest(requestBody, rotatedSessionToken), { ...environment, DB }, { now: () => now, fetch: fetcher });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: "complete", version: 4 });
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(1);
  });

  it("rejects a recovery identity from another OSM account before contacting OSM", async () => {
    const DB = await setupDatabase();
    const otherSession = "o".repeat(43);
    await createOSMSession(DB, otherSession, "another-test-subject", now, "development");
    const key = await importOAuthEncryptionKey(keySecret);
    await storeOSMDevelopmentToken(DB, otherSession, "another-dev-bearer-token", now + 60 * 60 * 1_000, now, key);
    const { fetcher, calls } = makeFetch();

    const response = await handleDevelopmentCheckDate(makeRequest(requestBody, otherSession), { ...environment, DB }, { now: () => now, fetch: fetcher });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "recovery_identity_mismatch" });
    expect(calls).toHaveLength(0);
    expect(DB.operations.size).toBe(0);
  });

  it("retires an unapplied timeout after closing and confirming an empty changeset", async () => {
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
    expect(retry.status).toBe(502);
    expect(await retry.json()).toEqual({ error: "write_failed" });
    const duplicate = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(duplicate.status).toBe(502);
    expect(await duplicate.json()).toEqual({ error: "write_failed" });
    expect(calls.some((call) => call.url.endsWith("/changeset/77/close"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/changeset/77/download"))).toBe(true);
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(0);
  });

  it("marks a failed changeset-open request as failed without uploading", async () => {
    const DB = await setupDatabase();
    const { fetcher, calls } = makeFetch({ changesetOpenFailure: true });
    const dependencies = { now: () => now, fetch: fetcher };
    const first = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, dependencies);
    expect(first.status).toBe(502);
    expect(await first.json()).toEqual({ error: "write_failed" });
    const duplicate = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, dependencies);
    expect(duplicate.status).toBe(502);
    expect(await duplicate.json()).toEqual({ error: "write_failed" });
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(0);
    expect(calls.some((call) => call.url.endsWith("/changeset/77/close"))).toBe(false);
  });

  it("keeps the request uncertain when a 409 does not confirm that the changeset is closed", async () => {
    const DB = await setupDatabase();
    const { fetcher, calls } = makeFetch({ appliedAfterUploadFailure: true, changesetCloseConflict: "open" });
    const dependencies = { now: () => now, fetch: fetcher };
    const first = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, dependencies);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ status: "uncertain" });
    const retry = await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, dependencies);
    expect(retry.status).toBe(202);
    expect(await retry.json()).toEqual({ status: "uncertain" });
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(1);
  });

  it.each([
    ["empty HTTP 200 body", ""],
    ["truncated XML", '<osmChange version="0.6"><modify><node id="42" changeset="77" version="4">'],
    ["mismatched closing tag", '<osmChange version="0.6"><modify></create></osmChange>'],
  ])("keeps an uncertain write recoverable after a %s changeset download", async (_label, download) => {
    const DB = await setupDatabase();
    const { fetcher, calls } = makeFetch({
      appliedAfterUploadFailure: true,
      changesetCloseConflict: "closed",
      malformedChangesetDownloads: [download],
    });
    const dependencies = { now: () => now, fetch: fetcher };
    const workerEnvironment = { ...environment, DB };

    const first = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ status: "uncertain" });

    const malformedRecovery = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(malformedRecovery.status).toBe(202);
    expect(await malformedRecovery.json()).toEqual({ status: "uncertain" });

    const laterRecovery = await handleDevelopmentCheckDate(makeRequest(), workerEnvironment, dependencies);
    expect(laterRecovery.status).toBe(200);
    expect(await laterRecovery.json()).toMatchObject({ status: "complete", version: 4 });
    expect(calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(1);
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

// ---------------------------------------------------------------------------------------------------------------
// Detailangaben ergänzen (Etappe P4): nur Fehlendes, nie Überschreiben
// ---------------------------------------------------------------------------------------------------------------

/** Liest die Tags aus dem Upload-XML und macht aus den XML-Zeichen wieder Text. */
function tagsFromUpload(xml: string): Record<string, string> {
  const decode = (value: string) => value.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const tags: Record<string, string> = {};
  for (const match of xml.matchAll(/<tag k="([^"]*)" v="([^"]*)"\/>/gu)) tags[decode(match[1])] = decode(match[2]);
  return tags;
}

/**
 * Ein kleiner Testserver-Ersatz mit veränderlichem Zustand: Der AED (Knoten 42) hat Tags und eine Version.
 * Ein erfolgreicher Upload übernimmt die Tags aus dem XML und erhöht die Version, wie der echte Testserver.
 */
function makeStatefulFetch(options: { tags?: Record<string, string>; version?: number; loseUploadResponse?: boolean; failBeforeApply?: boolean } = {}) {
  const state = { version: options.version ?? 3, tags: { emergency: "defibrillator", name: "Rathaus", fixme: "Eingang prüfen", check_date: "2025-10-20", ...(options.tags ?? {}) } as Record<string, string> };
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const changesetBodies: string[] = [];
  let loseUpload = options.loseUploadResponse ?? false;
  let failBeforeApply = options.failBeforeApply ?? false;
  let uploadApplied = false;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input); const method = init.method ?? "GET"; const body = typeof init.body === "string" ? init.body : undefined;
    calls.push({ method, url, body });
    if (url.endsWith("/api/0.6/node/42.json")) {
      return Response.json({ version: "0.6", elements: [{ type: "node", id: 42, lat: 52.52, lon: 13.4, version: state.version, tags: state.tags }] });
    }
    if (url.endsWith("/api/0.6/changeset/create")) { changesetBodies.push(body ?? ""); return new Response("77", { status: 200 }); }
    if (url.endsWith("/api/0.6/changeset/77/upload")) {
      if (failBeforeApply) { failBeforeApply = false; throw new Error("network failed before the server applied the write"); }
      expect(body).toContain(`version="${state.version}"`);
      state.tags = tagsFromUpload(body ?? "");
      state.version += 1;
      uploadApplied = true;
      if (loseUpload) { loseUpload = false; throw new Error("connection lost after the server applied the write"); }
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<diffResult generator="OpenStreetMap server" version="0.6">\n <node old_id="42" new_id="42" new_version="${state.version}"/>\n</diffResult>\n`, { status: 200 });
    }
    if (url.endsWith("/api/0.6/changeset/77/close")) return new Response(null, { status: 200 });
    if (url.endsWith("/api/0.6/changeset/77/download")) {
      if (!uploadApplied) return new Response('<osmChange version="0.6"><create/><modify/><delete/></osmChange>', { status: 200 });
      const tags = Object.entries(state.tags).map(([key, value]) => '<tag k="' + key + '" v="' + value + '"/>').join("");
      const download = '<osmChange version="0.6"><modify><node id="42" changeset="77" version="' + state.version + '">' + tags + '</node></modify></osmChange>';
      return new Response(download, { status: 200 });
    }
    throw new Error(`Unexpected OSM API request: ${method} ${url}`);
  };
  return { fetcher, calls, state, changesetBodies, get uploads() { return calls.filter((call) => call.url.endsWith("/upload")); } };
}

const detailsRequest = { ...requestBody, details: { "defibrillator:location": "Foyer links", access: "customers", indoor: "yes", level: "0" } };

describe("OSM development writer: adding missing details", () => {
  it("adds only the requested details, keeps every other tag, and says so in the changeset comment", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch();
    const response = await handleDevelopmentCheckDate(makeRequest(detailsRequest), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "complete", version: 4 });
    expect(api.uploads).toHaveLength(1);
    // Alle bisherigen Tags bleiben (auch fremde wie name und fixme), neu sind das Prüfdatum und die Details.
    expect(api.state.tags).toEqual({
      emergency: "defibrillator", name: "Rathaus", fixme: "Eingang prüfen", check_date: "2026-10-24",
      "defibrillator:location": "Foyer links", access: "customers", indoor: "yes", level: "0",
    });
    expect(api.changesetBodies[0]).toContain("missing details added");
  });

  it("still uses the plain check-date comment when no details are sent", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch();
    expect((await handleDevelopmentCheckDate(makeRequest(), { ...environment, DB }, { now: () => now, fetch: api.fetcher })).status).toBe(200);
    expect(api.changesetBodies[0]).toContain("presence checked on site");
    expect(api.changesetBodies[0]).not.toContain("details");
  });

  it("writes the details even when the check date already has the observation date", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { check_date: "2026-10-24" } });
    const response = await handleDevelopmentCheckDate(makeRequest({ ...detailsRequest, expected_check_date: "2026-10-24" }), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(200);
    // Kein „schon aktuell“: Es gab ja etwas zu schreiben.
    expect(await response.json()).not.toHaveProperty("already_current");
    expect(api.uploads).toHaveLength(1);
    expect(api.state.tags.access).toBe("customers");
  });

  it("never overwrites: a requested key that now exists on the node ends in a conflict without any write", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "private" } });
    const response = await handleDevelopmentCheckDate(makeRequest(detailsRequest), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "version_conflict" });
    expect(api.calls.some((call) => call.url.endsWith("/changeset/create"))).toBe(false);
    expect(api.state.tags.access).toBe("private");
  });

  it("stops when someone else changed the object since the person saw it", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ version: 4 });
    const response = await handleDevelopmentCheckDate(makeRequest(detailsRequest), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(409);
    expect(api.calls.some((call) => call.url.endsWith("/changeset/create"))).toBe(false);
  });

  it("stops when a newer check date exists, even with details", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { check_date: "2026-11-01" } });
    const response = await handleDevelopmentCheckDate(makeRequest({ ...detailsRequest, expected_check_date: "2026-11-01" }), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "newer_check_date_exists" });
    expect(api.uploads).toHaveLength(0);
  });

  it("rejects malformed or unapproved detail requests before calling OSM", async () => {
    const { expected_version: _omitted, ...withoutVersion } = detailsRequest;
    const bad: Array<[string, unknown]> = [
      ["details without the seen version", withoutVersion],
      ["access code key", { ...requestBody, details: { "defibrillator:code": "1234" } }],
      ["protected tag", { ...requestBody, details: { check_date: "2020-01-01" } }],
      ["name tag", { ...requestBody, details: { name: "Falsch" } }],
      ["invalid access value", { ...requestBody, details: { access: "permissive" } }],
      ["too long text", { ...requestBody, details: { description: "x".repeat(256) } }],
      ["control character inside", { ...requestBody, details: { operator: "Stadt\nwerke" } }],
      ["empty details", { ...requestBody, details: {} }],
      ["array", { ...requestBody, details: [] }],
      ["null", { ...requestBody, details: null }],
      ["non-text value", { ...requestBody, details: { level: 1 } }],
      ["unknown top-level field", { ...detailsRequest, extra: true }],
    ];
    for (const [label, body] of bad) {
      const DB = await setupDatabase(); const api = makeStatefulFetch();
      const response = await handleDevelopmentCheckDate(makeRequest(body), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
      expect(response.status, label).toBe(400);
      expect(api.calls, label).toEqual([]);
    }
  });

  it("reconciles a lost upload response for a details-only change (check date unchanged) without a second edit", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { check_date: "2026-10-24" }, loseUploadResponse: true });
    const body = { ...detailsRequest, expected_check_date: "2026-10-24" };
    const dependencies = { now: () => now, fetch: api.fetcher };
    const first = await handleDevelopmentCheckDate(makeRequest(body), { ...environment, DB }, dependencies);
    expect(first.status).toBe(202);
    const retry = await handleDevelopmentCheckDate(makeRequest(body), { ...environment, DB }, dependencies);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: "complete", version: 4 });
    expect(api.uploads).toHaveLength(1);
  });

  it("retires a failed details upload after confirming that the changeset is empty", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ failBeforeApply: true });
    const dependencies = { now: () => now, fetch: api.fetcher };
    expect((await handleDevelopmentCheckDate(makeRequest(detailsRequest), { ...environment, DB }, dependencies)).status).toBe(202);
    const retry = await handleDevelopmentCheckDate(makeRequest(detailsRequest), { ...environment, DB }, dependencies);
    expect(retry.status).toBe(502);
    expect(await retry.json()).toEqual({ error: "write_failed" });
    expect(api.state.tags.access).toBeUndefined();
  });

  it("does not take a foreign edit for its own when retiring an empty changeset", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ failBeforeApply: true });
    const dependencies = { now: () => now, fetch: api.fetcher };
    expect((await handleDevelopmentCheckDate(makeRequest(detailsRequest), { ...environment, DB }, dependencies)).status).toBe(202);
    // Jemand anderes ändert das Objekt (neue Version, anderes Prüfdatum, andere Werte).
    api.state.version = 4; api.state.tags = { ...api.state.tags, check_date: "2026-10-24", access: "yes" };
    const retry = await handleDevelopmentCheckDate(makeRequest(detailsRequest), { ...environment, DB }, dependencies);
    expect(retry.status).toBe(502);
    expect(await retry.json()).toEqual({ error: "write_failed" });
    // Nur der ursprüngliche, gescheiterte Versuch: Die Wiederholung schreibt nichts und überschreibt den fremden Wert nicht.
    expect(api.uploads).toHaveLength(1);
    expect(api.state.tags.access).toBe("yes");
  });

  it("rejects the same operation id with different details", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch();
    const dependencies = { now: () => now, fetch: api.fetcher };
    expect((await handleDevelopmentCheckDate(makeRequest(detailsRequest), { ...environment, DB }, dependencies)).status).toBe(200);
    const changed = await handleDevelopmentCheckDate(makeRequest({ ...requestBody, details: { access: "private" } }), { ...environment, DB }, dependencies);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ error: "operation_id_conflict" });
    expect(api.uploads).toHaveLength(1);
  });

  it("completes a duplicate request idempotently without a second upload", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch();
    const dependencies = { now: () => now, fetch: api.fetcher };
    expect((await handleDevelopmentCheckDate(makeRequest(detailsRequest), { ...environment, DB }, dependencies)).status).toBe(200);
    const duplicate = await handleDevelopmentCheckDate(makeRequest(detailsRequest), { ...environment, DB }, dependencies);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ status: "complete", version: 4 });
    expect(api.uploads).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Bestehende Detailwerte korrigieren (Etappe P5): nur mit Betreiber-Schalter, Vorwert-Prüfung und Bestätigung
// ---------------------------------------------------------------------------------------------------------------

const correctionEnvironment = { ...environment, OSM_DETAIL_CORRECTIONS_ENABLED: "true" };
const correctionRequest = { ...requestBody, details: { access: "yes" }, expected_before: { access: "private" }, confirmed_corrections: true };

describe("OSM development writer: correcting existing details", () => {
  it("replaces only the confirmed old value, keeps every other tag, and says so in the changeset comment", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "private", operator: "Stadtwerke" } });
    const response = await handleDevelopmentCheckDate(makeRequest(correctionRequest), { ...correctionEnvironment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "complete", version: 4 });
    expect(api.state.tags).toEqual({
      emergency: "defibrillator", name: "Rathaus", fixme: "Eingang prüfen", check_date: "2026-10-24", access: "yes", operator: "Stadtwerke",
    });
    expect(api.changesetBodies[0]).toContain("added and corrected");
  });

  it("combines additions and corrections in one upload", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "private" } });
    const body = { ...requestBody, details: { "defibrillator:location": "Foyer", access: "yes" }, expected_before: { access: "private" }, confirmed_corrections: true };
    const response = await handleDevelopmentCheckDate(makeRequest(body), { ...correctionEnvironment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(200);
    expect(api.uploads).toHaveLength(1);
    expect(api.state.tags).toMatchObject({ "defibrillator:location": "Foyer", access: "yes" });
  });

  it("can replace a value the form does not know, such as access=permissive", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "permissive" } });
    const body = { ...correctionRequest, expected_before: { access: "permissive" } };
    expect((await handleDevelopmentCheckDate(makeRequest(body), { ...correctionEnvironment, DB }, { now: () => now, fetch: api.fetcher })).status).toBe(200);
    expect(api.state.tags.access).toBe("yes");
  });

  it("refuses corrections while the operator switch is off, before any OSM call", async () => {
    for (const env of [environment, { ...environment, OSM_DETAIL_CORRECTIONS_ENABLED: "false" }, { ...environment, OSM_DETAIL_CORRECTIONS_ENABLED: "TRUE" }]) {
      const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "private" } });
      const response = await handleDevelopmentCheckDate(makeRequest(correctionRequest), { ...env, DB }, { now: () => now, fetch: api.fetcher });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "corrections_disabled" });
      expect(api.calls).toEqual([]);
      expect(api.state.tags.access).toBe("private");
    }
  });

  it("keeps additions working while the corrections switch is off", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch();
    const response = await handleDevelopmentCheckDate(makeRequest({ ...requestBody, details: { access: "yes" } }), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(200);
  });

  it("stops when someone changed the old value since the person saw it", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "customers" } });
    const response = await handleDevelopmentCheckDate(makeRequest(correctionRequest), { ...correctionEnvironment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "version_conflict" });
    expect(api.calls.some((call) => call.url.endsWith("/changeset/create"))).toBe(false);
    expect(api.state.tags.access).toBe("customers");
  });

  it("stops when the value to correct has been removed in the meantime", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: {} });
    const response = await handleDevelopmentCheckDate(makeRequest(correctionRequest), { ...correctionEnvironment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(409);
    expect(api.uploads).toHaveLength(0);
  });

  it("never overwrites an addition: a key that appeared in the meantime ends in a conflict", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "private", operator: "Jemand anderes" } });
    const body = { ...requestBody, details: { access: "yes", operator: "Meiner" }, expected_before: { access: "private" }, confirmed_corrections: true };
    const response = await handleDevelopmentCheckDate(makeRequest(body), { ...correctionEnvironment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(409);
    expect(api.state.tags).toMatchObject({ access: "private", operator: "Jemand anderes" });
  });

  it("stops when the object version changed", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "private" }, version: 4 });
    expect((await handleDevelopmentCheckDate(makeRequest(correctionRequest), { ...correctionEnvironment, DB }, { now: () => now, fetch: api.fetcher })).status).toBe(409);
    expect(api.uploads).toHaveLength(0);
  });

  it("rejects malformed or unconfirmed correction requests before calling OSM", async () => {
    const { expected_version: _omitted, ...withoutVersion } = correctionRequest;
    const bad: Array<[string, unknown]> = [
      ["no explicit confirmation", { ...correctionRequest, confirmed_corrections: undefined }],
      ["confirmation false", { ...correctionRequest, confirmed_corrections: false }],
      ["confirmation only", { ...requestBody, details: { access: "yes" }, confirmed_corrections: true }],
      ["old values without details", { ...requestBody, expected_before: { access: "private" }, confirmed_corrections: true }],
      ["no seen version", withoutVersion],
      ["old value for a key that is not changed", { ...correctionRequest, expected_before: { access: "private", operator: "Alt" } }],
      ["correction without a real difference", { ...correctionRequest, expected_before: { access: "yes" } }],
      ["empty old values", { ...correctionRequest, expected_before: {} }],
      ["empty old text", { ...correctionRequest, expected_before: { access: "" } }],
      ["non-text old value", { ...correctionRequest, expected_before: { access: 1 } }],
      ["old values as array", { ...correctionRequest, expected_before: [] }],
      ["old value with control character", { ...correctionRequest, expected_before: { access: "pri\nvate" } }],
      ["old value too long", { ...correctionRequest, expected_before: { access: "x".repeat(256) } }],
      ["deleting through an empty value", { ...correctionRequest, details: { access: "" } }],
      ["unapproved key", { ...requestBody, details: { "defibrillator:code": "1" }, expected_before: { "defibrillator:code": "2" }, confirmed_corrections: true }],
    ];
    for (const [label, body] of bad) {
      const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "private", operator: "Alt" } });
      const response = await handleDevelopmentCheckDate(makeRequest(body), { ...correctionEnvironment, DB }, { now: () => now, fetch: api.fetcher });
      expect(response.status, label).toBe(400);
      expect(api.calls, label).toEqual([]);
    }
  });

  it("reconciles a lost upload response for a correction without a second edit", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "private", check_date: "2026-10-24" }, loseUploadResponse: true });
    const body = { ...correctionRequest, expected_check_date: "2026-10-24" };
    const dependencies = { now: () => now, fetch: api.fetcher };
    expect((await handleDevelopmentCheckDate(makeRequest(body), { ...correctionEnvironment, DB }, dependencies)).status).toBe(202);
    const retry = await handleDevelopmentCheckDate(makeRequest(body), { ...correctionEnvironment, DB }, dependencies);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: "complete", version: 4 });
    expect(api.uploads).toHaveLength(1);
  });

  it("retires a failed correction after confirming that the changeset is empty", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "private" }, failBeforeApply: true });
    const dependencies = { now: () => now, fetch: api.fetcher };
    expect((await handleDevelopmentCheckDate(makeRequest(correctionRequest), { ...correctionEnvironment, DB }, dependencies)).status).toBe(202);
    const retry = await handleDevelopmentCheckDate(makeRequest(correctionRequest), { ...correctionEnvironment, DB }, dependencies);
    expect(retry.status).toBe(502);
    expect(await retry.json()).toEqual({ error: "write_failed" });
    expect(api.uploads).toHaveLength(1);
    expect(api.state.tags.access).toBe("private");
  });

  it("rejects the same operation id with different old values", async () => {
    const DB = await setupDatabase(); const api = makeStatefulFetch({ tags: { access: "private" } });
    const dependencies = { now: () => now, fetch: api.fetcher };
    expect((await handleDevelopmentCheckDate(makeRequest(correctionRequest), { ...correctionEnvironment, DB }, dependencies)).status).toBe(200);
    const changed = await handleDevelopmentCheckDate(makeRequest({ ...correctionRequest, expected_before: { access: "customers" } }), { ...correctionEnvironment, DB }, dependencies);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ error: "operation_id_conflict" });
  });
});
