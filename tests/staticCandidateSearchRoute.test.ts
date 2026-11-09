import { describe, expect, it, vi } from "vitest";
import { handleStaticCandidateSearch } from "../server/osm/staticCandidateSearchRoute";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";

const now = Date.parse("2026-11-08T12:00:00.000Z");
const session = "s".repeat(43);
const latCell = Math.floor(52.52 / 0.05);
const lonCell = Math.floor(13.405 / 0.05);
const cellId = `${latCell}:${lonCell}`;
const shardId = `${Math.floor((latCell + 0.5) * 0.05)}_${Math.floor((lonCell + 0.5) * 0.05)}`;
const snapshotId = "aed-0123456789abcdef0123";
const coverageId = "a".repeat(64);
const tags = ["name", "ref", "operator", "access", "indoor", "level", "opening_hours", "check_date", "defibrillator:location", "location", "wheelchair", "fee", "start_date"];

function database(options: { authenticated?: boolean; cooldown?: boolean } = {}): D1Database {
  return {
    prepare(query: string): D1Statement {
      const statement: D1Statement = {
        bind() { return statement; },
        async run<T>() { return { success: true, meta: { changes: options.cooldown === false ? 0 : 1 } } as D1Result<T>; },
        async first<T>() {
          if (query.includes("FROM osm_sessions")) return (options.authenticated === false ? null : { osm_subject: "tester", osm_environment: "development" }) as T | null;
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

function feed(dataUntil = new Date(now - 60 * 60_000).toISOString()) {
  const manifest = {
    schema_version: "aedjaeger-cells-v1", status: "ready", region: "dachlilu", snapshot_id: snapshotId,
    index_url: `aed/snapshots/${snapshotId}/index.json`, generated_at: new Date(now).toISOString(),
    osm_data_until: dataUntil, coverage_id: coverageId, cell_size_degrees: 0.05, shard_size_degrees: 1,
    max_source_age_hours: 48, allowed_candidate_fields: ["id", "latitude", "longitude", "tags"], allowed_osm_tags: tags,
  };
  const index = {
    schema_version: manifest.schema_version, region: manifest.region, snapshot_id: snapshotId, coverage_id: coverageId,
    osm_data_until: dataUntil, cell_size_degrees: 0.05, shard_size_degrees: 1,
    cells: [{ id: cellId, status: "complete_with_candidates", shard_id: shardId }],
    shards: { [shardId]: `aed/snapshots/${snapshotId}/shards/${shardId}.json` },
  };
  const candidate = { id: "node/123", latitude: 52.52, longitude: 13.405, tags: { name: "Bahnhof", wheelchair: "yes" } };
  const shard = { schema_version: manifest.schema_version, snapshot_id: snapshotId, shard_id: shardId, cells: { [cellId]: [candidate] } };
  const docs: Record<string, unknown> = {
    "metadata.json": { region: "dachlilu", aed_candidate_snapshot: { manifest: "aed/manifest.json", status: "ready", snapshot_id: snapshotId } },
    "aed/manifest.json": manifest,
    [`aed/snapshots/${snapshotId}/index.json`]: index,
    [`aed/snapshots/${snapshotId}/shards/${shardId}.json`]: shard,
  };
  return { docs, manifest, index, candidate };
}

function fetchFeed(docs: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://pipeline.openfiremap.org");
    expect(init?.redirect).toBe("manual");
    if (url.pathname.endsWith("/index.json") || url.pathname.endsWith(".json") && url.pathname.includes("/shards/")) {
      expect(init?.cache).toBeUndefined();
      expect((init as RequestInit & { cf?: Record<string, unknown> }).cf).toMatchObject({ cacheEverything: true, cacheTtl: 86_400, cacheTtlByStatus: { "200-299": 86_400, "404": 0, "500-599": 0 } });
    } else expect(init?.cache).toBe("no-store");
    const item = docs[url.pathname.slice(1)];
    return item === undefined ? new Response("missing", { status: 404 }) : Response.json(item);
  });
}

describe("static AED candidate source", () => {
  it("authenticates first and does not accept a caller-supplied feed URL", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleStaticCandidateSearch(request(), { DB: database({ authenticated: false }) }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads only the fixed feed and accepts the pipeline's allowlisted candidate shape", async () => {
    const source = feed();
    const fetcher = fetchFeed(source.docs);
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetcher, now: () => now });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "complete", snapshot_id: snapshotId, data_until: source.manifest.osm_data_until,
      candidates: [{ id: "node/123", osmType: "node", tags: { name: "Bahnhof", wheelchair: "yes" } }],
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("uses exactly the manifest's 48-hour freshness window", async () => {
    const source = feed(new Date(now - 48 * 60 * 60_000 - 1).toISOString());
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetchFeed(source.docs), now: () => now });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "coverage_unavailable" });
  });

  it("fails closed when the published AED snapshot is unavailable", async () => {
    const source = feed();
    source.manifest.status = "unavailable";
    delete (source.manifest as { snapshot_id?: string }).snapshot_id;
    delete (source.manifest as { index_url?: string }).index_url;
    const metadata = source.docs["metadata.json"] as { aed_candidate_snapshot: { status: string; snapshot_id: string | null } };
    metadata.aed_candidate_snapshot.status = "unavailable";
    metadata.aed_candidate_snapshot.snapshot_id = null;
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetchFeed(source.docs), now: () => now });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "coverage_unavailable" });
  });

  it("fails closed when root and AED manifests point at different snapshots", async () => {
    const source = feed();
    const root = source.docs["metadata.json"] as { aed_candidate_snapshot: { snapshot_id: string } };
    root.aed_candidate_snapshot.snapshot_id = "aed-ffffffffffffffffffff";
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetchFeed(source.docs), now: () => now });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "invalid_response" });
  });

  it("does not treat a missing or unavailable cell as an empty search", async () => {
    const source = feed();
    (source.index.cells[0] as { status: string }).status = "unavailable";
    delete (source.index.cells[0] as { shard_id?: string }).shard_id;
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetchFeed(source.docs), now: () => now });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "coverage_unavailable" });
  });

  it("does not call an omitted required cell an empty area", async () => {
    const source = feed();
    source.index.cells = [];
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetchFeed(source.docs), now: () => now });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "coverage_unavailable" });
  });

  it("rejects schema drift and a shard assigned to the wrong geographic cell", async () => {
    const source = feed();
    source.manifest.allowed_osm_tags = ["name"];
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetchFeed(source.docs), now: () => now });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "invalid_response" });
  });

  it("never follows feed redirects or leaks source response text", async () => {
    const logs: Record<string, string | number>[] = [];
    const fetcher = vi.fn(async () => new Response("private source payload", { status: 302, headers: { Location: "https://attacker.test" } }));
    const response = await handleStaticCandidateSearch(request(), { DB: database() }, { fetch: fetcher, now: () => now, logDiagnostic: (entry) => logs.push(entry) });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private source payload");
    expect(logs[0]).toMatchObject({ event: "static_aed_search_failure", failure_code: "source_unavailable" });
    expect(JSON.stringify(logs)).not.toMatch(/52\.52|13\.405|Bahnhof/u);
  });
});
