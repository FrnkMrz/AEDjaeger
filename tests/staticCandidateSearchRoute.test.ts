import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleStaticCandidateSearch } from "../server/osm/staticCandidateSearchRoute";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";

const { fixture } = vi.hoisted(() => ({
  fixture: {
    pointFeature: {
    type: "Feature",
    properties: { "@type": "node", "@id": "node/123", emergency: "defibrillator", name: "Bahnhof", wheelchair: "yes", check_date: "2026-10-20", private_note: "not returned" },
    geometry: { type: "Point", coordinates: [13.405, 52.52] },
    } as Record<string, unknown> | null,
    mapPayload: { elements: [] as unknown[] },
  },
}));

// The route contract needs only two PMTiles operations. The fake still calls the
// supplied source, so these tests verify the worker's bounded Range HTTP behavior.
vi.mock("pmtiles", () => ({
  PMTiles: class {
    constructor(private readonly source: {
      getBytes(offset: number, length: number, signal?: AbortSignal): Promise<{ data: ArrayBuffer }>;
    }) {}
    async getHeader() {
      await this.source.getBytes(0, 127);
      return { tileType: 1, minZoom: 14, maxZoom: 14, minLon: 5, minLat: 45, maxLon: 18, maxLat: 56 };
    }
    async getZxy(_z: number, _x: number, _y: number, signal?: AbortSignal) {
      return { data: (await this.source.getBytes(200, 1, signal)).data };
    }
  },
}));

vi.mock("pbf", () => ({ PbfReader: class {} }));
vi.mock("@mapbox/vector-tile", () => ({
  VectorTile: class {
    layers = { defibrillators: { get length() { return fixture.pointFeature ? 1 : 0; }, feature: () => ({ toGeoJSON: () => fixture.pointFeature }) } };
    constructor(_reader: unknown) {}
  },
}));
vi.mock("../server/auth/osmOAuth", () => ({ importOAuthEncryptionKey: vi.fn(async () => ({ testKey: true })) }));
vi.mock("../server/storage/osmDevelopmentTokens", () => ({ findOSMDevelopmentToken: vi.fn(async () => "dev-access-token") }));

const now = Date.parse("2026-11-08T12:00:00.000Z");
const session = "s".repeat(43);

function database(options: { authenticated?: boolean; cooldown?: boolean; environment?: "production" | "development" } = {}): D1Database {
  return {
    prepare(query: string): D1Statement {
      const statement: D1Statement = {
        bind() { return statement; },
        async run<T>() { return { success: true, meta: { changes: options.cooldown === false ? 0 : 1 } } as D1Result<T>; },
        async first<T>() {
          if (query.includes("FROM osm_sessions")) return (options.authenticated === false ? null : { osm_subject: "tester", osm_environment: options.environment ?? "development" }) as T | null;
          if (query.includes("SELECT next_allowed_at")) return { next_allowed_at: now + 30_000 } as T;
          return null;
        },
      };
      return statement;
    },
  };
}

function request(body: unknown = { latitude: 52.52, longitude: 13.405, accuracy_meters: 50 }, origin = "https://aedjaeger.test"): Request {
  return new Request("https://aedjaeger.test/api/osm/candidates/search", {
    method: "POST", headers: { Cookie: `aedjaeger_osm_session=${session}`, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function metadata(dataUntil = new Date(now - 60 * 60_000).toISOString()) {
  const extracts = Object.fromEntries(["germany", "austria", "switzerland", "luxembourg", "liechtenstein"]
    .map((country) => [country, { status: "cached_head_ok", osm_data_timestamp: dataUntil }]));
  return {
    status: "ok", region: "dachlilu", generated_at: new Date(now).toISOString(), osm_data_until: dataUntil,
    extracts, pmtiles: { file: "openfiremap.pmtiles", size_bytes: 1_024 }, features: { defibrillators: { count: 12_345 } },
  };
}

function fetchArchive(options: { dataUntil?: string; ignoreRange?: boolean; mapStatus?: number } = {}) {
  const currentMetadata = metadata(options.dataUntil);
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(init?.redirect).toBe("manual");
    if (url.origin === "https://master.apis.dev.openstreetmap.org") {
      expect(url.pathname).toBe("/api/0.6/map.json");
      expect(url.searchParams.get("bbox")).toBeTruthy();
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer dev-access-token");
      return Response.json(fixture.mapPayload, { status: options.mapStatus ?? 200 });
    }
    expect(url.origin).toBe("https://pipeline.openfiremap.org");
    if (url.pathname === "/metadata.json") {
      expect(init?.cache).toBe("no-store");
      return Response.json(currentMetadata);
    }
    expect(url.pathname).toBe("/openfiremap.pmtiles");
    expect(url.searchParams.get("v")).toBe(currentMetadata.generated_at);
    const range = init?.headers instanceof Headers ? init.headers.get("Range") : (init?.headers as Record<string, string> | undefined)?.Range;
    expect(range).toMatch(/^bytes=\d+-\d+$/u);
    const match = /^bytes=(\d+)-(\d+)$/u.exec(range ?? "");
    if (!match) return new Response("invalid range", { status: 416 });
    const start = Number(match[1]); const end = Number(match[2]);
    if (options.ignoreRange) return new Response(new Uint8Array(end - start + 1));
    return new Response(new Uint8Array(end - start + 1), {
      status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${currentMetadata.pmtiles.size_bytes}` },
    });
  });
  return fetcher;
}

describe("PMTiles AED candidate search", () => {
  beforeEach(() => {
    fixture.pointFeature = {
      type: "Feature",
      properties: { "@type": "node", "@id": "node/123", emergency: "defibrillator", name: "Bahnhof", wheelchair: "yes", check_date: "2026-10-20", private_note: "not returned" },
      geometry: { type: "Point", coordinates: [13.405, 52.52] },
    };
    fixture.mapPayload = { elements: [] };
  });
  it("authenticates before fetching the fixed archive", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleStaticCandidateSearch(request(), { DB: database({ authenticated: false }) }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads only bounded ranges from the fixed archive and returns nearby AED nodes", async () => {
    const fetcher = fetchArchive();
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "complete", data_until: metadata().osm_data_until,
      candidates: [{ id: "node/123", osmType: "node", coordinateQuality: "exact", source: "archive", tags: { name: "Bahnhof", wheelchair: "yes", check_date: "2026-10-20" } }],
    });
    expect(fetcher.mock.calls.length).toBeGreaterThan(2);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("confirms a PMTiles-empty search on the authenticated OSM development map", async () => {
    fixture.pointFeature = null;
    fixture.mapPayload = { elements: [
      { type: "node", id: 456, lat: 52.5201, lon: 13.4051, tags: { emergency: "defibrillator", check_date: "2026-10-01", name: "Eingang" } },
    ] };
    const fetcher = fetchArchive();
    const response = await handleStaticCandidateSearch(request(), {
      DB: database(), OSM_OAUTH_ENCRYPTION_KEY: "test-encryption-key",
    }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "complete",
      candidates: [{ id: "node/456", source: "development", tags: { check_date: "2026-10-01", name: "Eingang" } }],
    });
    expect(fetcher.mock.calls.some(([input]) => new URL(String(input)).origin === "https://master.apis.dev.openstreetmap.org")).toBe(true);
  });

  it("also shows AEDs of the test server next to the archive hits in a test-server session", async () => {
    // Der Schutz vor Doppelten beim Anlegen prüft die Entwicklungsinstanz. Die Suche muss dort ebenfalls hinschauen.
    fixture.mapPayload = { elements: [
      { type: "node", id: 456, lat: 52.52036, lon: 13.405, tags: { emergency: "defibrillator", name: "Test-Knoten" } },
    ] };
    const response = await handleStaticCandidateSearch(request({ latitude: 52.52, longitude: 13.405, accuracy_meters: 10 }), {
      DB: database(), OSM_OAUTH_ENCRYPTION_KEY: "test-encryption-key",
    }, { fetch: fetchArchive(), now: () => now });
    expect(response.status).toBe(200);
    const body = await response.json() as { candidates: Array<{ id: string; source: string }> };
    expect(body.candidates.map((candidate) => [candidate.id, candidate.source]).sort()).toEqual([["node/123", "archive"], ["node/456", "development"]]);
  });

  it("keeps the archive result when the additional test-server lookup fails", async () => {
    const response = await handleStaticCandidateSearch(request({ latitude: 52.52, longitude: 13.405, accuracy_meters: 10 }), {
      DB: database(), OSM_OAUTH_ENCRYPTION_KEY: "test-encryption-key",
    }, { fetch: fetchArchive({ mapStatus: 500 }), now: () => now });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "complete", candidates: [{ id: "node/123", source: "archive" }] });
  });

  it("never asks the test server in a production session", async () => {
    const fetcher = fetchArchive();
    const response = await handleStaticCandidateSearch(request(), { DB: database({ environment: "production" }), OSM_OAUTH_ENCRYPTION_KEY: "test-encryption-key" }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls.some(([input]) => new URL(String(input)).origin === "https://master.apis.dev.openstreetmap.org")).toBe(false);
  });

  it("rejects a GPS accuracy worse than 50 m before any lookup", async () => {
    const fetcher = fetchArchive();
    const response = await handleStaticCandidateSearch(request({ latitude: 52.52, longitude: 13.405, accuracy_meters: 60 }), { DB: database() }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "location_too_uncertain" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("searches only 50 m plus the GPS accuracy around the point", async () => {
    fixture.pointFeature = null;
    fixture.mapPayload = { elements: [
      { type: "node", id: 456, lat: 52.52036, lon: 13.405, tags: { emergency: "defibrillator", name: "bei 40 m" } },
      { type: "node", id: 789, lat: 52.52063, lon: 13.405, tags: { emergency: "defibrillator", name: "bei 70 m" } },
    ] };
    const response = await handleStaticCandidateSearch(request({ latitude: 52.52, longitude: 13.405, accuracy_meters: 10 }), {
      DB: database(), OSM_OAUTH_ENCRYPTION_KEY: "test-encryption-key",
    }, { fetch: fetchArchive(), now: () => now });
    const body = await response.json() as { candidates: Array<{ id: string }>; coverage_radius_meters: number };
    expect(body.coverage_radius_meters).toBe(60);
    expect(body.candidates.map((candidate) => candidate.id)).toEqual(["node/456"]);
  });

  it("returns no matches only after the complete development-map area has been checked", async () => {
    fixture.pointFeature = null;
    const fetcher = fetchArchive();
    const response = await handleStaticCandidateSearch(request(), {
      DB: database(), OSM_OAUTH_ENCRYPTION_KEY: "test-encryption-key",
    }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "complete", candidates: [] });
    expect(fetcher.mock.calls.some(([input]) => new URL(String(input)).origin === "https://master.apis.dev.openstreetmap.org")).toBe(true);
  });

  it("keeps an empty production PMTiles result incomplete without verified extract coverage", async () => {
    fixture.pointFeature = null;
    const fetcher = fetchArchive();
    const response = await handleStaticCandidateSearch(request(), {
      DB: database({ environment: "production" }), OSM_OAUTH_ENCRYPTION_KEY: "test-encryption-key",
    }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "coverage_unavailable" });
    expect(fetcher.mock.calls.some(([input]) => new URL(String(input)).origin === "https://master.apis.dev.openstreetmap.org")).toBe(false);
  });

  it("does not treat a failed authoritative check as an empty search", async () => {
    fixture.pointFeature = null;
    const fetcher = fetchArchive({ mapStatus: 503 });
    const response = await handleStaticCandidateSearch(request(), {
      DB: database(), OSM_OAUTH_ENCRYPTION_KEY: "test-encryption-key",
    }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "source_unavailable" });
  });

  it("does not declare an empty result when the authoritative area contains a non-node AED", async () => {
    fixture.pointFeature = null;
    fixture.mapPayload = { elements: [
      { type: "way", id: 789, tags: { emergency: "defibrillator" } },
    ] };
    const response = await handleStaticCandidateSearch(request(), {
      DB: database(), OSM_OAUTH_ENCRYPTION_KEY: "test-encryption-key",
    }, { fetch: fetchArchive(), now: () => now });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "coverage_unavailable" });
  });

  it("fails closed when source extracts exceed the 5-day (120-hour) freshness limit", async () => {
    const fetcher = fetchArchive({ dataUntil: new Date(now - 120 * 60 * 60_000 - 1).toISOString() });
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "coverage_unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed if the archive server ignores a byte range", async () => {
    const fetcher = fetchArchive({ ignoreRange: true });
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "source_unavailable" });
  });

  it("fails closed for a cross-origin request without contacting the archive", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleStaticCandidateSearch(request(undefined, "https://attacker.test"), { DB: database() }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never follows redirects or logs coordinates and source response text", async () => {
    const logs: Record<string, string | number>[] = [];
    const fetcher = vi.fn(async () => new Response("private source payload", { status: 302, headers: { Location: "https://attacker.test" } }));
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, {
      fetch: fetcher, now: () => now, logDiagnostic: (entry) => logs.push(entry),
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private source payload");
    expect(logs[0]).toMatchObject({ event: "static_aed_search_failure", failure_code: "source_unavailable" });
    expect(JSON.stringify(logs)).not.toMatch(/52\.52|13\.405|Bahnhof/u);
  });
});
