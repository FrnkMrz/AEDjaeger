import { describe, expect, it } from "vitest";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";
import { createOSMSession } from "../server/storage/osmSessions";
import { storeOSMDevelopmentToken } from "../server/storage/osmDevelopmentTokens";
import { importOAuthEncryptionKey } from "../server/auth/osmOAuth";
import { handleDevelopmentCreateNode } from "../server/osm/developmentCreateNodeRoute";

const now = Date.UTC(2026, 9, 24, 12);
const cookieToken = "s".repeat(43);
const encryptionSecret = "k".repeat(43);
const operationId = "f1234567-89ab-4cde-8fab-123456789abc";
const input = { operation_id: operationId, confirmed: true, latitude: 52.52, longitude: 13.405, observed_on: "2026-10-24", location_description: "Near main entrance" };

type SessionRow = { session_hash: string; osm_subject: string; osm_environment: string; expires_at: number };
type TokenRow = { session_hash: string; token_iv: string; token_ciphertext: string; token_expires_at: number };
type OperationRow = { session_hash: string; operation_id: string; request_hash: string; state: string; changeset_id: string | null; result_version: number | null; result_node_id: string | null; updated_at: number; expires_at: number };

class MemoryD1 implements D1Database {
  sessions = new Map<string, SessionRow>();
  tokens = new Map<string, TokenRow>();
  operations = new Map<string, OperationRow>();
  failChangesetRecord = false;

  prepare(query: string): D1Statement {
    const database = this;
    let values: unknown[] = [];
    return {
      bind(...next: unknown[]) { values = next; return this; },
      async first<T>() { return database.query<T>(query, values); },
      async run<T = unknown>() { return database.execute<T>(query, values); },
    } as unknown as D1Statement;
  }

  query<T>(sql: string, values: unknown[]): T | null {
    if (sql.includes("FROM osm_sessions") && sql.includes("osm_subject")) {
      const [hash, time] = values as [string, number]; const row = this.sessions.get(hash);
      return row && row.expires_at > time ? { osm_subject: row.osm_subject, osm_environment: row.osm_environment } as T : null;
    }
    if (sql.includes("FROM osm_sessions") && sql.includes("SELECT session_hash")) {
      const [hash, time] = values as [string, number]; const row = this.sessions.get(hash);
      return row && row.expires_at > time ? { session_hash: hash } as T : null;
    }
    if (sql.includes("FROM osm_development_tokens")) {
      const [hash, tokenTime, activeHash, sessionTime] = values as [string, number, string, number];
      const token = this.tokens.get(hash); const session = this.sessions.get(activeHash);
      return token && token.token_expires_at > tokenTime && session && session.expires_at > sessionTime
        ? { token_iv: token.token_iv, token_ciphertext: token.token_ciphertext, token_expires_at: token.token_expires_at } as T : null;
    }
    if (sql.includes("FROM osm_development_write_operations")) {
      const [hash, id, time] = values as [string, string, number]; const row = this.operations.get(`${hash}:${id}`);
      if (!row || row.expires_at <= time) return null;
      return { request_hash: row.request_hash, state: row.state, changeset_id: row.changeset_id, result_version: row.result_version, result_node_id: row.result_node_id, updated_at: row.updated_at } as T;
    }
    throw new Error(`Unexpected D1 query: ${sql}`);
  }

  execute<T>(sql: string, values: unknown[]): D1Result<T> {
    if (sql.startsWith("DELETE FROM osm_development_write_operations")) return { success: true, meta: { changes: 1 } };
    if (sql.startsWith("DELETE FROM osm_sessions")) return { success: true, meta: { changes: 1 } };
    if (sql.startsWith("INSERT INTO osm_sessions")) {
      const [hash, subject, env, _created, expires] = values as [string, string, string, number, number];
      this.sessions.set(hash, { session_hash: hash, osm_subject: subject, osm_environment: env, expires_at: expires });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO osm_development_tokens")) {
      const [hash, iv, cipher, expires, _created] = values as [string, string, string, number, number];
      this.tokens.set(hash, { session_hash: hash, token_iv: iv, token_ciphertext: cipher, token_expires_at: expires });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT OR IGNORE INTO osm_development_write_operations")) {
      const [hash, id, requestHash, _created, _updated, expires] = values as [string, string, string, number, number, number];
      const key = `${hash}:${id}`;
      if (this.operations.has(key)) return { success: true, meta: { changes: 0 } };
      this.operations.set(key, { session_hash: hash, operation_id: id, request_hash: requestHash, state: "started", changeset_id: null, result_version: null, result_node_id: null, updated_at: _updated, expires_at: expires });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET state = 'failed', updated_at = ?")) {
      const [time, hash, id, staleBefore, expires] = values as [number, string, string, number, number]; const row = this.operations.get(`${hash}:${id}`);
      if (!row || row.state !== "started" || row.updated_at > staleBefore || row.expires_at <= expires) return { success: true, meta: { changes: 0 } };
      row.state = "failed"; row.updated_at = time; return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET state = 'changeset-created'")) {
      const [changeset, time, hash, id, expires] = values as [string, number, string, string, number]; const row = this.operations.get(`${hash}:${id}`);
      if (this.failChangesetRecord) { this.failChangesetRecord = false; return { success: true, meta: { changes: 0 } }; }
      if (!row || row.state !== "started" || row.expires_at <= expires) return { success: true, meta: { changes: 0 } };
      row.state = "changeset-created"; row.changeset_id = changeset; row.updated_at = time; return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET state = ?, updated_at = ?")) {
      const [state, time, hash, id, expires] = values as [string, number, string, string, number]; const row = this.operations.get(`${hash}:${id}`);
      if (!row || row.state !== "started" || row.expires_at <= expires) return { success: true, meta: { changes: 0 } };
      row.state = state; row.updated_at = time; return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET updated_at = ?")) {
      const [time, hash, id, expires] = values as [number, string, string, number]; const row = this.operations.get(`${hash}:${id}`);
      if (!row || row.state !== "started" || row.expires_at <= expires) return { success: true, meta: { changes: 0 } };
      row.updated_at = time; return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET state = 'uploading'")) {
      const [_time, hash, id, expires] = values as [number, string, string, number]; const row = this.operations.get(`${hash}:${id}`);
      if (!row || row.state !== "changeset-created" || row.expires_at <= expires) return { success: true, meta: { changes: 0 } };
      row.state = "uploading"; return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("SET state = ?, changeset_id = COALESCE")) {
      const [state, changeset, version, nodeId, _time, hash, id] = values as [string, string | null, number | null, string | null, number, string, string];
      const row = this.operations.get(`${hash}:${id}`); if (!row) return { success: true, meta: { changes: 0 } };
      row.state = state; row.changeset_id ??= changeset; row.result_version ??= version; row.result_node_id ??= nodeId; row.updated_at = _time;
      return { success: true, meta: { changes: 1 } };
    }
    throw new Error(`Unexpected D1 statement: ${sql}`);
  }
}

async function setupDatabase(environment: "development" | "production" = "development"): Promise<MemoryD1> {
  const database = new MemoryD1();
  await createOSMSession(database, cookieToken, "test-subject", now - 1_000, environment);
  const key = await importOAuthEncryptionKey(encryptionSecret);
  await storeOSMDevelopmentToken(database, cookieToken, "dev-bearer-token", now + 60 * 60 * 1_000, now, key);
  return database;
}

function makeRequest(body: unknown = input): Request {
  return new Request("https://aedjaeger.example/api/osm/development/create-node", {
    method: "POST", headers: { Cookie: `aedjaeger_osm_session=${cookieToken}`, Origin: "https://aedjaeger.example", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function makeFetch(options: { nearbyAed?: boolean; loseUploadResponse?: boolean; invalidMap?: boolean } = {}) {
  let loseUploadResponse = options.loseUploadResponse ?? false;
  let uploadCount = 0;
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetcher: typeof fetch = async (request, init = {}) => {
    const url = String(request); const method = init.method ?? "GET"; const body = typeof init.body === "string" ? init.body : undefined;
    calls.push({ url, method, body });
    if (url.includes("/api/0.6/map.json?bbox=")) return Response.json(options.invalidMap
      ? { version: "0.6", elements: [{ error: "incomplete map response" }] }
      : { version: "0.6", elements: [{ type: "node", id: 1 }, ...(options.nearbyAed ? [{ type: "node", id: 2, tags: { emergency: "defibrillator" } }] : [])] });
    if (url.endsWith("/changeset/create")) return new Response("77", { status: 200 });
    if (url.endsWith("/changeset/77/upload")) {
      uploadCount += 1;
      expect(body).toContain('<node id="-1" changeset="77" lat="52.52" lon="13.405">');
      expect(body).toContain('<tag k="emergency" v="defibrillator"/>');
      expect(body).toContain('<tag k="check_date" v="2026-10-24"/>');
      expect(body).toContain('<tag k="defibrillator:location" v="Near main entrance"/>');
      if (loseUploadResponse) { loseUploadResponse = false; throw new Error("connection lost after upload"); }
      return new Response('<diffResult><node old_id="-1" new_id="456" new_version="1"/></diffResult>', { status: 200 });
    }
    if (url.endsWith("/changeset/77/download")) return new Response('<osm><node id="456" version="1" lat="52.52" lon="13.405" changeset="77"><tag k="check_date" v="2026-10-24"/><tag k="emergency" v="defibrillator"/><tag k="defibrillator:location" v="Near main entrance"/></node></osm>', { status: 200 });
    if (url.endsWith("/changeset/77/close")) return new Response(null, { status: 200 });
    throw new Error(`Unexpected OSM request ${method} ${url}`);
  };
  return { fetcher, calls, get uploadCount() { return uploadCount; } };
}

const environment = { OSM_DEV_WRITES_ENABLED: "true", OSM_OAUTH_ENCRYPTION_KEY: encryptionSecret };

describe("OSM development node creation", () => {
  it("creates only the approved minimal tags after a fresh empty API map check", async () => {
    const DB = await setupDatabase(); const api = makeFetch();
    const response = await handleDevelopmentCreateNode(makeRequest(), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "complete", node_id: "456", version: 1 });
    expect(api.calls.find((call) => call.url.endsWith("/changeset/create"))).toBeDefined();
    expect(api.calls.find((call) => call.url.endsWith("/upload"))?.body).toContain("<osmChange");
    const replay = await handleDevelopmentCreateNode(makeRequest(), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(replay.status).toBe(200);
    expect(api.calls.filter((call) => call.url.endsWith("/upload"))).toHaveLength(1);
  });

  it("blocks creation if the fresh OSM map contains any nearby AED object", async () => {
    const DB = await setupDatabase(); const api = makeFetch({ nearbyAed: true });
    const response = await handleDevelopmentCreateNode(makeRequest(), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "nearby_aed_found" });
    expect(api.calls.some((call) => call.url.endsWith("/changeset/create"))).toBe(false);
  });

  it("fails closed when the fresh map response is incomplete", async () => {
    const DB = await setupDatabase(); const api = makeFetch({ invalidMap: true });
    const response = await handleDevelopmentCreateNode(makeRequest(), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "development_api_unavailable" });
    expect(api.calls.some((call) => call.url.endsWith("/changeset/create"))).toBe(false);
    expect(api.calls.some((call) => call.url.endsWith("/upload"))).toBe(false);
  });

  it("terminates a stale started operation instead of leaving the confirmed draft pending forever", async () => {
    const DB = await setupDatabase(); const api = makeFetch();
    DB.failChangesetRecord = true;
    const firstTime = now - 121_000;
    const first = await handleDevelopmentCreateNode(makeRequest(), { ...environment, DB }, { now: () => firstTime, fetch: api.fetcher });
    expect(first.status).toBe(422);
    expect(DB.operations.values().next().value?.state).toBe("started");

    const retry = await handleDevelopmentCreateNode(makeRequest(), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(retry.status).toBe(422);
    expect(await retry.json()).toEqual({ error: "write_failed" });
    expect(DB.operations.values().next().value?.state).toBe("failed");
    expect(api.calls.filter((call) => call.url.endsWith("/changeset/create"))).toHaveLength(1);
    expect(api.calls.some((call) => call.url.endsWith("/upload"))).toBe(false);
  });

  it("reconciles a lost upload response from its changeset without a second create", async () => {
    const DB = await setupDatabase(); const api = makeFetch({ loseUploadResponse: true });
    const dependencies = { now: () => now, fetch: api.fetcher };
    const first = await handleDevelopmentCreateNode(makeRequest(), { ...environment, DB }, dependencies);
    expect(first.status).toBe(202);
    const retry = await handleDevelopmentCreateNode(makeRequest(), { ...environment, DB }, dependencies);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ status: "complete", node_id: "456", version: 1 });
    expect(api.uploadCount).toBe(1);
  });

  it("refuses a production session before calling OSM", async () => {
    const DB = await setupDatabase("production"); let calls = 0;
    const response = await handleDevelopmentCreateNode(makeRequest(), { ...environment, DB }, { now: () => now, fetch: async () => { calls += 1; return new Response(); } });
    expect(response.status).toBe(403);
    expect(calls).toBe(0);
  });
});
