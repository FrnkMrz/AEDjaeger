import { describe, expect, it, vi } from "vitest";
import { handleOverpassSearch } from "../server/osm/overpassRoute";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";

const sessionToken = "s".repeat(43);
const validLocation = { latitude: 52.52, longitude: 13.405, accuracy_meters: 50 };

function createDatabase(options: { authenticated?: boolean; cooldown?: boolean; d1Failure?: boolean; nextAllowedAt?: number; upstreamCooldownUntil?: number } = {}) {
  const queries: string[] = [];
  let upstreamCooldownUntil = options.upstreamCooldownUntil;
  const database: D1Database = {
    prepare(query: string): D1Statement {
      let values: unknown[] = [];
      const statement: D1Statement = {
        bind(...boundValues) { values = boundValues; return statement; },
        async run<T>() {
          queries.push(query);
          if (options.d1Failure) throw new Error("private D1 diagnostic");
          if (query.includes("INSERT INTO overpass_upstream_cooldown")) {
            upstreamCooldownUntil = Math.max(upstreamCooldownUntil ?? 0, Number(values[0]));
            return { success: true, meta: { changes: 1 } } as D1Result<T>;
          }
          return { success: true, meta: { changes: options.cooldown === false ? 0 : 1 } } as D1Result<T>;
        },
        async first<T>() {
          queries.push(query);
          if (query.includes("FROM osm_sessions")) return (options.authenticated === false ? null : { osm_subject: "osm-user-7", osm_environment: "production" }) as T | null;
          if (query.includes("overpass_upstream_cooldown")) return (upstreamCooldownUntil === undefined ? null : { next_allowed_at: upstreamCooldownUntil }) as T | null;
          if (query.includes("SELECT next_allowed_at")) return { next_allowed_at: options.nextAllowedAt ?? 31_000 } as T;
          return null;
        },
      };
      return statement;
    },
  };
  return { database, queries };
}

function searchRequest(body: unknown = validLocation, headers: Record<string, string> = {}): Request {
  return new Request("https://aedjaeger.test/api/osm/candidates/search", {
    method: "POST",
    headers: {
      Cookie: `aedjaeger_osm_session=${sessionToken}`,
      Origin: "https://aedjaeger.test",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const noCandidates = () => new Response(JSON.stringify({ elements: [] }), { status: 200, headers: { "Content-Type": "application/json" } });

describe("protected Overpass candidate search", () => {
  it("requires same-origin OSM authentication before contacting Overpass", async () => {
    const { database, queries } = createDatabase({ authenticated: false });
    const overpass = vi.fn(async () => noCandidates());
    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass, now: () => 1_000 });

    expect(response.status).toBe(401);
    expect(queries).toEqual(expect.arrayContaining([expect.stringContaining("osm_sessions")]));
    expect(overpass).not.toHaveBeenCalled();
  });

  it("rejects cross-origin searches without contacting D1 or Overpass", async () => {
    const { database, queries } = createDatabase();
    const overpass = vi.fn(async () => noCandidates());
    const response = await handleOverpassSearch(searchRequest(validLocation, { Origin: "https://attacker.example" }), { DB: database }, { fetch: overpass });

    expect(response.status).toBe(403);
    expect(queries).toEqual([]);
    expect(overpass).not.toHaveBeenCalled();
  });

  it.each([
    { ...validLocation, accuracy_meters: 101 },
    { ...validLocation, latitude: 91 },
    { ...validLocation, extra: "unexpected" },
    null,
  ])("rejects invalid or too uncertain location input before Overpass", async (body) => {
    const { database } = createDatabase();
    const overpass = vi.fn(async () => noCandidates());
    const response = await handleOverpassSearch(searchRequest(body), { DB: database }, { fetch: overpass });

    expect(response.status).toBe(body && "accuracy_meters" in body && body.accuracy_meters === 101 ? 422 : 400);
    expect(overpass).not.toHaveBeenCalled();
  });

  it("queries the fixed endpoint with a bounded radius and normalizes exact and approximate candidates", async () => {
    const { database } = createDatabase();
    const overpass = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe("https://overpass-api.de/api/interpreter");
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("User-Agent")).toContain("AEDjaeger");
      const query = new URLSearchParams(String(init?.body)).get("data");
      expect(query).toContain("around:150,52.52,13.405");
      expect(query).toContain('nwr["emergency"="defibrillator"]');
      return new Response(JSON.stringify({ elements: [
        { type: "node", id: 123, lat: 52.5201, lon: 13.4051, tags: { emergency: "defibrillator", name: "Station" } },
        { type: "way", id: 456, center: { lat: 52.521, lon: 13.406 }, tags: { emergency: "defibrillator" } },
      ] }), { status: 200 });
    });

    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass, now: () => 1_000 });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "complete",
      coverage_radius_meters: 150,
      candidates: [
        { id: "node/123", osmType: "node", coordinateQuality: "exact", position: { latitude: 52.5201, longitude: 13.4051 }, tags: { emergency: "defibrillator", name: "Station" } },
        { id: "way/456", osmType: "way", coordinateQuality: "approximate-center", position: { latitude: 52.521, longitude: 13.406 }, tags: { emergency: "defibrillator" } },
      ],
    });
  });

  it("marks an Overpass remark as partial so it cannot imply no AED exists", async () => {
    const { database } = createDatabase();
    const overpass = vi.fn(async () => new Response(JSON.stringify({ elements: [], remark: "runtime error" }), { status: 200 }));
    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass });

    expect(await response.json()).toMatchObject({ status: "partial", reason: "overpass-remark", candidates: [] });
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("returns a retry delay when a user's search slot is still reserved", async () => {
    const { database } = createDatabase({ cooldown: false, nextAllowedAt: 31_000 });
    const overpass = vi.fn(async () => noCandidates());
    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass, now: () => 1_000 });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(overpass).not.toHaveBeenCalled();
  });

  it("returns the reserved cooldown for fast Overpass failures", async () => {
    const { database } = createDatabase();
    const overpass = vi.fn(async () => new Response("upstream unavailable", { status: 500 }));
    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass, now: () => 1_000 });

    expect(response.status).toBe(502);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("does not treat an Overpass redirect as a successful empty search", async () => {
    const { database } = createDatabase();
    const overpass = vi.fn(async () => new Response(null, { status: 307, headers: { Location: "https://attacker.example" } }));
    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass, now: () => 1_000 });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "overpass_unavailable" });
    expect(overpass).toHaveBeenCalledOnce();
  });

  it("subtracts time spent waiting for Overpass from Retry-After", async () => {
    let currentTime = 1_000;
    const { database } = createDatabase();
    const overpass = vi.fn(async () => {
      currentTime = 26_000;
      return new Response("upstream unavailable", { status: 500 });
    });
    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass, now: () => currentTime });

    expect(response.status).toBe(502);
    expect(response.headers.get("Retry-After")).toBe("5");
  });

  it.each([
    ["120", "120"],
    ["Thu, 01 Jan 1970 00:02:01 GMT", "120"],
    ["5", "30"],
  ])("respects the longer upstream Retry-After value %s", async (upstreamHeader, expectedHeader) => {
    const { database } = createDatabase();
    const overpass = vi.fn(async () => new Response("rate limited", { status: 429, headers: { "Retry-After": upstreamHeader } }));
    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass, now: () => 1_000 });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe(expectedHeader);
  });

  it("stores an upstream Retry-After globally before returning it to the first account", async () => {
    const { database, queries } = createDatabase();
    const upstream = vi.fn(async () => new Response("rate limited", { status: 429, headers: { "Retry-After": "120" } }));
    const first = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: upstream, now: () => 1_000 });
    expect(first.headers.get("Retry-After")).toBe("120");

    const perAccountReservations = queries.filter((query) => query.includes("INSERT INTO overpass_search_cooldowns")).length;
    const second = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: upstream, now: () => 2_000 });
    expect(second.status).toBe(503);
    expect(second.headers.get("Retry-After")).toBe("119");
    expect(queries.filter((query) => query.includes("INSERT INTO overpass_search_cooldowns")).length).toBe(perAccountReservations);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("returns only the remaining cooldown for a denied concurrent search", async () => {
    const { database } = createDatabase({ cooldown: false, nextAllowedAt: 28_100 });
    const overpass = vi.fn(async () => noCandidates());
    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass, now: () => 26_500 });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(overpass).not.toHaveBeenCalled();
  });

  it("fails closed on D1 errors and maps upstream refusal without exposing its body", async () => {
    const brokenDatabase = createDatabase({ d1Failure: true });
    const shouldNotRun = vi.fn(async () => noCandidates());
    const databaseFailure = await handleOverpassSearch(searchRequest(), { DB: brokenDatabase.database }, { fetch: shouldNotRun });
    expect(databaseFailure.status).toBe(503);
    expect(shouldNotRun).not.toHaveBeenCalled();

    const { database } = createDatabase();
    const refused = await handleOverpassSearch(searchRequest(), { DB: database }, {
      fetch: vi.fn(async () => new Response("private Overpass details", { status: 429 })),
    });
    expect(refused.status).toBe(503);
    expect(refused.headers.get("Retry-After")).toBe("30");
    expect(await refused.text()).not.toContain("private Overpass details");
  });
});
