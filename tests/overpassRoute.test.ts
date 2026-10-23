import { describe, expect, it, vi } from "vitest";
import { handleOverpassSearch } from "../server/osm/overpassRoute";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";

const sessionToken = "s".repeat(43);
const validLocation = { latitude: 52.52, longitude: 13.405, accuracy_meters: 50 };

function createDatabase(options: { authenticated?: boolean; cooldown?: boolean; d1Failure?: boolean } = {}) {
  const queries: string[] = [];
  const database: D1Database = {
    prepare(query: string): D1Statement {
      const statement: D1Statement = {
        bind() { return statement; },
        async run<T>() {
          queries.push(query);
          if (options.d1Failure) throw new Error("private D1 diagnostic");
          return { success: true, meta: { changes: options.cooldown === false ? 0 : 1 } } as D1Result<T>;
        },
        async first<T>() {
          queries.push(query);
          if (query.includes("FROM osm_sessions")) return (options.authenticated === false ? null : { osm_subject: "osm-user-7" }) as T | null;
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
    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass });

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
    const { database } = createDatabase({ cooldown: false });
    const overpass = vi.fn(async () => noCandidates());
    const response = await handleOverpassSearch(searchRequest(), { DB: database }, { fetch: overpass });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
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
