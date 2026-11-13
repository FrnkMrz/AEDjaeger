import { describe, expect, it } from "vitest";
import { createOSMSession } from "../server/storage/osmSessions";
import { storeOSMDevelopmentToken } from "../server/storage/osmDevelopmentTokens";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";
import { importOAuthEncryptionKey } from "../server/auth/osmOAuth";
import { handleDevelopmentNodeRead } from "../server/osm/developmentNodeRoute";

const now = Date.UTC(2026, 9, 24, 12);
const sessionToken = "s".repeat(43);
const keySecret = "k".repeat(43);

type SessionRow = { osm_subject: string; osm_environment: string; expires_at: number };
type TokenRow = { token_iv: string; token_ciphertext: string; token_expires_at: number };

/** Kleiner Speicher-Ersatz für D1: nur Sitzungen und Zugangsschlüssel, mehr braucht die Leseroute nicht. */
class MemoryD1 implements D1Database {
  sessions = new Map<string, SessionRow>();
  tokens = new Map<string, TokenRow>();
  prepare(query: string): D1Statement {
    let values: unknown[] = [];
    const database = this;
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
    throw new Error(`Unexpected D1 query: ${sql}`);
  }
  execute<T>(sql: string, values: unknown[]): D1Result<T> {
    if (sql.startsWith("DELETE FROM")) return { success: true, meta: { changes: 1 } };
    if (sql.startsWith("INSERT INTO osm_sessions")) {
      const [hash, subject, env, _created, expires] = values as [string, string, string, number, number];
      this.sessions.set(hash, { osm_subject: subject, osm_environment: env, expires_at: expires });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO osm_development_tokens")) {
      const [hash, iv, cipher, expires] = values as [string, string, string, number];
      this.tokens.set(hash, { token_iv: iv, token_ciphertext: cipher, token_expires_at: expires });
      return { success: true, meta: { changes: 1 } };
    }
    throw new Error(`Unexpected D1 statement: ${sql}`);
  }
}

async function setupDatabase(environmentName: "development" | "production" = "development"): Promise<MemoryD1> {
  const database = new MemoryD1();
  await createOSMSession(database, sessionToken, "test-subject", now - 1_000, environmentName);
  const key = await importOAuthEncryptionKey(keySecret);
  await storeOSMDevelopmentToken(database, sessionToken, "dev-bearer-token", now + 60 * 60 * 1_000, now, key);
  return database;
}

function makeRequest(query = "id=node/42", headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request(`https://aedjaeger.example/api/osm/development/node?${query}`, {
    method, headers: { Cookie: `aedjaeger_osm_session=${sessionToken}`, ...headers },
  });
}

const environment = { OSM_DEV_WRITES_ENABLED: "true", OSM_OAUTH_ENCRYPTION_KEY: keySecret };

function nodeFetch(tags: Record<string, string>, status = 200) {
  const calls: Array<{ method: string; url: string }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    calls.push({ method: init.method ?? "GET", url: String(input) });
    if (status !== 200) return new Response(null, { status });
    return Response.json({ version: "0.6", elements: [{ type: "node", id: 42, lat: 52.52, lon: 13.4, version: 7, tags }] });
  };
  return { fetcher, calls };
}

describe("OSM development node reader", () => {
  it("returns the current version and only the detail tags and check date", async () => {
    const DB = await setupDatabase();
    const api = nodeFetch({ emergency: "defibrillator", name: "Rathaus", fixme: "prüfen", "defibrillator:code": "1234", access: "yes", level: "1", check_date: "2025-10-20" });
    const response = await handleDevelopmentNodeRead(makeRequest(), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(response.status).toBe(200);
    // Name, fixme und vor allem ein eventuell eingetragener Zugangscode erreichen den Browser nie.
    expect(await response.json()).toEqual({ status: "ok", id: "node/42", version: 7, tags: { access: "yes", level: "1", check_date: "2025-10-20" } });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: "GET" });
    expect(api.calls[0].url).toMatch(/\/api\/0\.6\/node\/42\.json$/u);
  });

  it("only reads: it never opens a changeset or uploads", async () => {
    const DB = await setupDatabase(); const api = nodeFetch({ emergency: "defibrillator" });
    await handleDevelopmentNodeRead(makeRequest(), { ...environment, DB }, { now: () => now, fetch: api.fetcher });
    expect(api.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("rejects other methods, cross-site requests and malformed object ids before calling OSM", async () => {
    const DB = await setupDatabase(); const api = nodeFetch({ emergency: "defibrillator" });
    const dependencies = { now: () => now, fetch: api.fetcher };
    expect((await handleDevelopmentNodeRead(makeRequest("id=node/42", {}, "POST"), { ...environment, DB }, dependencies)).status).toBe(405);
    expect((await handleDevelopmentNodeRead(makeRequest("id=node/42", { Origin: "https://evil.example" }), { ...environment, DB }, dependencies)).status).toBe(403);
    expect((await handleDevelopmentNodeRead(makeRequest("id=node/42", { "Sec-Fetch-Site": "cross-site" }), { ...environment, DB }, dependencies)).status).toBe(403);
    for (const id of ["", "way/42", "node/0", "node/abc", "node/42/../1", "node/1234567890123456789", "42"]) {
      expect((await handleDevelopmentNodeRead(makeRequest(`id=${encodeURIComponent(id)}`), { ...environment, DB }, dependencies)).status, id).toBe(400);
    }
    expect((await handleDevelopmentNodeRead(makeRequest(""), { ...environment, DB }, dependencies)).status).toBe(400);
    expect(api.calls).toHaveLength(0);
  });

  it("needs a signed-in test-server session and the enabled switch", async () => {
    const api = nodeFetch({ emergency: "defibrillator" });
    const dependencies = { now: () => now, fetch: api.fetcher };
    const DB = await setupDatabase();
    const noCookie = new Request("https://aedjaeger.example/api/osm/development/node?id=node/42");
    expect((await handleDevelopmentNodeRead(noCookie, { ...environment, DB }, dependencies)).status).toBe(401);
    expect((await handleDevelopmentNodeRead(makeRequest(), { ...environment, OSM_DEV_WRITES_ENABLED: "false", DB }, dependencies)).status).toBe(503);
    expect((await handleDevelopmentNodeRead(makeRequest(), { ...environment, DB: undefined }, dependencies)).status).toBe(503);
    const productionDB = await setupDatabase("production");
    expect((await handleDevelopmentNodeRead(makeRequest(), { ...environment, DB: productionDB }, dependencies)).status).toBe(403);
    expect(api.calls).toHaveLength(0);
  });

  it("answers 404 for a deleted node and 502 for upstream trouble or a non-AED object", async () => {
    const DB = await setupDatabase();
    for (const [status, expected, code] of [[410, 404, "node_unavailable"], [500, 502, "development_api_unavailable"]] as const) {
      const response = await handleDevelopmentNodeRead(makeRequest(), { ...environment, DB }, { now: () => now, fetch: nodeFetch({}, status).fetcher });
      expect(response.status).toBe(expected);
      expect(await response.json()).toEqual({ error: code });
    }
    const notAnAed = await handleDevelopmentNodeRead(makeRequest(), { ...environment, DB }, { now: () => now, fetch: nodeFetch({ amenity: "bench" }).fetcher });
    expect(notAnAed.status).toBe(502);
  });

  it("sends no store header problems: the answer is never cached", async () => {
    const DB = await setupDatabase();
    const response = await handleDevelopmentNodeRead(makeRequest(), { ...environment, DB }, { now: () => now, fetch: nodeFetch({ emergency: "defibrillator" }).fetcher });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
