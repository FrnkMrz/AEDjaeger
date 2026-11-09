import { fetchWithoutRedirects } from "../http/fetchWithoutRedirects";
import { findOSMSession } from "../storage/osmSessions";
import type { D1Database } from "../storage/d1";
import { reserveSearchSlot } from "../storage/searchCooldown";
import type { NearbyAedCandidate, SearchCoordinate } from "../../src/osm/candidateTypes";

const SESSION_COOKIE = "aedjaeger_osm_session";
const FEED_ORIGIN = "https://pipeline.openfiremap.org/";
const SCHEMA = "aedjaeger-cells-v1";
const CELL_SIZE = 0.05;
const MAX_AGE_HOURS = 48;
const MAX_ACCURACY = 100;
const SEARCH_RADIUS = 100;
const MAX_REQUEST_BYTES = 1_024;
const MAX_MANIFEST_BYTES = 16 * 1_024;
const MAX_METADATA_BYTES = 256 * 1_024;
const MAX_INDEX_BYTES = 8 * 1_024 * 1_024;
const MAX_SHARD_BYTES = 4 * 1_024 * 1_024;
const MAX_CANDIDATES = 100;
const TIMEOUT_MS = 15_000;
const ALLOWED_TAGS = new Set([
  "name", "ref", "operator", "access", "indoor", "level", "opening_hours",
  "check_date", "defibrillator:location", "location", "wheelchair", "fee", "start_date",
]);

type Environment = { DB?: D1Database };
type Dependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  createDiagnosticId?: () => string;
  logDiagnostic?: (event: Readonly<Record<string, string | number>>) => void;
};
type Location = SearchCoordinate & { accuracyMeters: number };
type Cell = { id: string; status: string; shard_id?: string };
type Manifest = {
  schema_version: string; status: "ready"; region: string; snapshot_id: string;
  index_url: string; generated_at: string; osm_data_until: string; coverage_id: string;
  cell_size_degrees: number; shard_size_degrees: number; max_source_age_hours: number;
};
type Index = {
  schema_version: string; region: string; snapshot_id: string; coverage_id: string;
  osm_data_until: string; cell_size_degrees: number; shard_size_degrees: number;
  cells: Cell[]; shards: Record<string, string>;
};

/** Authenticated lookup against one trusted, immutable feed origin; never a browser-selected URL. */
export async function handleStaticCandidateSearch(request: Request, env: Environment, deps: Dependencies = {}): Promise<Response> {
  const diagnosticId = (deps.createDiagnosticId ?? (() => crypto.randomUUID()))();
  const startedAt = Date.now();
  let response: Response;
  try { response = await runSearch(request, env, deps); }
  catch { response = json({ error: "search_unavailable" }, 503); }
  response.headers.set("X-AEDjaeger-Diagnostic-Id", diagnosticId);
  const failure = await failureCode(response);
  if (failure) {
    try {
      (deps.logDiagnostic ?? ((event) => console.error(event)))({
        event: "static_aed_search_failure", diagnostic_id: diagnosticId,
        http_status: response.status, failure_code: failure,
        duration_ms: Math.max(0, Date.now() - startedAt),
      });
    } catch { /* Diagnostics cannot change the result. */ }
  }
  return response;
}

async function runSearch(request: Request, env: Environment, deps: Dependencies): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  const origin = new URL(request.url).origin;
  if (isCrossOrigin(request, origin)) return json({ error: "invalid_origin" }, 403);
  if (!env.DB) return json({ error: "search_unavailable" }, 503);
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const sessionToken = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!sessionToken) return json({ error: "authentication_required" }, 401);
  let session: { subject: string; environment: "production" | "development" } | null;
  try { session = await findOSMSession(env.DB, sessionToken, (deps.now ?? Date.now)()); }
  catch { return json({ error: "session_unavailable" }, 503); }
  if (!session) return json({ error: "authentication_required" }, 401);

  let body: Uint8Array;
  try { body = await readLimitedBody(request, MAX_REQUEST_BYTES); }
  catch (error) {
    return json({ error: error instanceof BodyTooLargeError ? "request_too_large" : "invalid_request" }, error instanceof BodyTooLargeError ? 413 : 400);
  }
  const location = parseLocation(body);
  if (!location) return json({ error: "invalid_request" }, 400);
  if (location.accuracyMeters > MAX_ACCURACY) return json({ error: "location_too_uncertain" }, 422);

  // Throttle by hashed OSM identity; keep the source service independent of account volume.
  const now = (deps.now ?? Date.now)();
  let retryAfter = 30;
  try {
    const slot = await reserveSearchSlot(env.DB, session.environment + ":" + session.subject, now);
    if (!slot.reserved) return json({ error: "search_rate_limited" }, 429, { "Retry-After": String(slot.retryAfterSeconds) });
    retryAfter = Math.max(0, Math.ceil((slot.nextAllowedAt - (deps.now ?? Date.now)()) / 1_000));
  } catch { return json({ error: "search_unavailable" }, 503); }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const fetcher = deps.fetch ?? fetch;
    // Both non-versioned manifests are fetched freshly; snapshot objects are immutable.
    const metadata = await fetchJson(fetcher, "metadata.json", MAX_METADATA_BYTES, controller.signal);
    const manifestValue = await fetchJson(fetcher, "aed/manifest.json", MAX_MANIFEST_BYTES, controller.signal);
    validateRootPointer(metadata, manifestValue);
    const manifest = readyManifest(manifestValue, (deps.now ?? Date.now)());
    const indexPath = indexPathFor(manifest.snapshot_id);
    if (manifest.index_url !== indexPath) throw new InvalidFeedError();
    const indexValue = await fetchJson(fetcher, indexPath, MAX_INDEX_BYTES, controller.signal, true);
    const index = validateIndex(indexValue, manifest);

    const radius = Math.ceil(location.accuracyMeters + SEARCH_RADIUS);
    const wantedCellIds = cellsForSearch(location, radius);
    const indexCells = new Map(index.cells.map((cell) => [cell.id, cell]));
    const relevant: Cell[] = [];
    for (const id of wantedCellIds) {
      const cell = indexCells.get(id);
      // Missing and unavailable cells both mean that we cannot prove the area was searched.
      if (!cell || cell.status === "unavailable") throw new CoverageUnavailableError();
      if (cell.status !== "complete_empty" && cell.status !== "complete_with_candidates") throw new InvalidFeedError();
      relevant.push(cell);
    }

    const shardIds = Array.from(new Set(relevant.flatMap((cell) => cell.shard_id ? [cell.shard_id] : [])));
    const candidates: NearbyAedCandidate[] = [];
    for (const shardId of shardIds) {
      const shardPath = index.shards[shardId];
      if (!/^-?\d+_-?\d+$/u.test(shardId) || shardPath !== shardPathFor(manifest.snapshot_id, shardId)) throw new InvalidFeedError();
      const shard = requireRecord(await fetchJson(fetcher, shardPath, MAX_SHARD_BYTES, controller.signal, true));
      if (shard.schema_version !== SCHEMA || shard.snapshot_id !== manifest.snapshot_id || shard.shard_id !== shardId) throw new InvalidFeedError();
      const shardCells = requireRecord(shard.cells);
      for (const cell of relevant.filter((entry) => entry.shard_id === shardId)) {
        const records = shardCells[cell.id];
        if (!Array.isArray(records) || records.length === 0) throw new InvalidFeedError();
        for (const record of records) {
          const candidate = parseCandidate(record, cell.id);
          if (!candidate) throw new InvalidFeedError();
          candidates.push(candidate);
          if (candidates.length > MAX_CANDIDATES) throw new InvalidFeedError();
        }
      }
    }
    return json({
      status: "complete", candidates: dedupe(candidates), coverage_radius_meters: radius,
      snapshot_id: manifest.snapshot_id, data_until: manifest.osm_data_until,
    }, 200, { "Retry-After": String(retryAfter) });
  } catch (error) {
    if (error instanceof CoverageUnavailableError) return json({ error: "coverage_unavailable" }, 503, { "Retry-After": String(retryAfter) });
    if (error instanceof InvalidFeedError) return json({ error: "invalid_response" }, 503, { "Retry-After": String(retryAfter) });
    if (error instanceof FeedHTTPError) return json({ error: "source_unavailable" }, 502, { "Retry-After": String(retryAfter) });
    return json({ error: controller.signal.aborted ? "source_timeout" : "source_unavailable" }, controller.signal.aborted ? 504 : 502, { "Retry-After": String(retryAfter) });
  } finally { clearTimeout(timeout); }
}

async function fetchJson(fetcher: typeof fetch, path: string, maxBytes: number, signal: AbortSignal, immutable = false): Promise<unknown> {
  const url = new URL(path, FEED_ORIGIN);
  if (url.origin !== new URL(FEED_ORIGIN).origin || !url.pathname.startsWith("/")) throw new InvalidFeedError();
  // Manifests are fetched freshly. Snapshot paths embed an immutable ID, so the
  // CDN may reuse them without ever making a stale manifest look current.
  const init: RequestInit & { cf?: Record<string, unknown> } = {
    method: "GET", headers: { Accept: "application/json" }, cache: immutable ? undefined : "no-store", signal,
    ...(immutable ? { cf: { cacheEverything: true, cacheTtl: 86_400, cacheTtlByStatus: { "200-299": 86_400, "404": 0, "500-599": 0 } } } : {}),
  };
  const response = await fetchWithoutRedirects(url, init, fetcher);
  if (!response.ok) throw new FeedHTTPError(response.status);
  const bytes = await readLimitedBody(response, maxBytes);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new InvalidFeedError(); }
}

function validateRootPointer(metadataValue: unknown, manifestValue: unknown): void {
  const metadata = requireRecord(metadataValue);
  const pointer = requireRecord(metadata.aed_candidate_snapshot);
  const manifest = requireRecord(manifestValue);
  if (metadata.region !== "dachlilu" || pointer.manifest !== "aed/manifest.json") throw new CoverageUnavailableError();
  if (pointer.status !== manifest.status || pointer.snapshot_id !== (manifest.snapshot_id ?? null)) throw new InvalidFeedError();
}

function readyManifest(value: unknown, now: number): Manifest {
  const item = requireRecord(value);
  if (item.schema_version !== SCHEMA || item.status !== "ready" || item.region !== "dachlilu") throw new CoverageUnavailableError();
  if (typeof item.snapshot_id !== "string" || !/^aed-[0-9a-f]{20}$/u.test(item.snapshot_id)) throw new InvalidFeedError();
  if (item.cell_size_degrees !== CELL_SIZE || item.shard_size_degrees !== 1 || item.max_source_age_hours !== MAX_AGE_HOURS) throw new InvalidFeedError();
  if (typeof item.coverage_id !== "string" || !/^[0-9a-f]{64}$/u.test(item.coverage_id)) throw new InvalidFeedError();
  if (!sameStringSet(item.allowed_candidate_fields, ["id", "latitude", "longitude", "tags"])
    || !sameStringSet(item.allowed_osm_tags, [...ALLOWED_TAGS])) throw new InvalidFeedError();
  const dataUntil = timestamp(item.osm_data_until);
  if (dataUntil === null || timestamp(item.generated_at) === null || dataUntil > now + 60_000
    || now - dataUntil > item.max_source_age_hours * 3_600_000) throw new CoverageUnavailableError();
  return item as unknown as Manifest;
}

function validateIndex(value: unknown, manifest: Manifest): Index {
  const item = requireRecord(value);
  if (item.schema_version !== SCHEMA || item.region !== "dachlilu" || item.snapshot_id !== manifest.snapshot_id
    || item.coverage_id !== manifest.coverage_id || item.osm_data_until !== manifest.osm_data_until
    || item.cell_size_degrees !== CELL_SIZE || item.shard_size_degrees !== 1
    || !Array.isArray(item.cells) || !isStringRecord(item.shards)) throw new InvalidFeedError();
  const seen = new Set<string>();
  for (const cell of item.cells) {
    if (!isRecord(cell) || typeof cell.id !== "string" || !/^-?\d+:-?\d+$/u.test(cell.id) || seen.has(cell.id)) throw new InvalidFeedError();
    seen.add(cell.id);
    if (cell.status === "complete_with_candidates") {
      if (typeof cell.shard_id !== "string" || item.shards[cell.shard_id] === undefined || cell.shard_id !== shardForCell(cell.id)) throw new InvalidFeedError();
    } else if (cell.status !== "complete_empty" && cell.status !== "unavailable") throw new InvalidFeedError();
    else if (cell.shard_id !== undefined) throw new InvalidFeedError();
  }
  for (const [id, path] of Object.entries(item.shards)) {
    if (!/^-?\d+_-?\d+$/u.test(id) || path !== shardPathFor(manifest.snapshot_id, id)) throw new InvalidFeedError();
  }
  return item as unknown as Index;
}

function parseCandidate(value: unknown, expectedCell: string): NearbyAedCandidate | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !["id", "latitude", "longitude", "tags"].includes(key))) return null;
  if (typeof value.id !== "string" || !/^(node|way|relation)\/[1-9]\d*$/u.test(value.id) || !Number.isSafeInteger(Number(value.id.split("/")[1]))) return null;
  if (typeof value.latitude !== "number" || typeof value.longitude !== "number") return null;
  const position = { latitude: value.latitude, longitude: value.longitude };
  if (!validCoordinate(position) || cellFor(position) !== expectedCell) return null;
  // Classification is implicit in this dedicated AED feed. The published tag
  // allowlist intentionally omits emergency=defibrillator.
  if (!isStringRecord(value.tags)) return null;
  if (Object.entries(value.tags).some(([key, tag]) => !ALLOWED_TAGS.has(key) || tag.length > 2_048)) return null;
  const osmType = value.id.split("/")[0] as NearbyAedCandidate["osmType"];
  return { id: value.id, osmType, coordinateQuality: osmType === "node" ? "exact" : "approximate-center", position, tags: value.tags };
}

function dedupe(candidates: NearbyAedCandidate[]): NearbyAedCandidate[] {
  const seen = new Map<string, NearbyAedCandidate>();
  for (const candidate of candidates) {
    const previous = seen.get(candidate.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candidate)) throw new InvalidFeedError();
    seen.set(candidate.id, candidate);
  }
  return Array.from(seen.values());
}

function cellsForSearch(location: Location, radius: number): string[] {
  // A conservative rectangle covers the circular query area; every touched cell must be complete.
  const latDelta = radius / 111_000;
  const cos = Math.cos(location.latitude * Math.PI / 180);
  if (Math.abs(cos) < 0.01) throw new CoverageUnavailableError();
  const lonDelta = radius / (111_000 * Math.abs(cos));
  const minLat = Math.max(-90, location.latitude - latDelta);
  const maxLat = Math.min(90, location.latitude + latDelta);
  const minLon = Math.max(-180, location.longitude - lonDelta);
  const maxLon = Math.min(180, location.longitude + lonDelta);
  const result: string[] = [];
  for (let lat = Math.floor(minLat / CELL_SIZE); lat <= Math.floor(maxLat / CELL_SIZE); lat += 1) {
    for (let lon = Math.floor(minLon / CELL_SIZE); lon <= Math.floor(maxLon / CELL_SIZE); lon += 1) result.push(lat + ":" + lon);
  }
  return result;
}
function cellFor(point: SearchCoordinate): string { return Math.floor(point.latitude / CELL_SIZE) + ":" + Math.floor(point.longitude / CELL_SIZE); }
function indexPathFor(snapshot: string): string { return "aed/snapshots/" + snapshot + "/index.json"; }
function shardPathFor(snapshot: string, shard: string): string { return "aed/snapshots/" + snapshot + "/shards/" + shard + ".json"; }
function shardForCell(cellId: string): string {
  const [latCell, lonCell] = cellId.split(":").map(Number);
  return `${Math.floor((latCell + 0.5) * CELL_SIZE)}_${Math.floor((lonCell + 0.5) * CELL_SIZE)}`;
}
function sameStringSet(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((item) => typeof item === "string")
    && new Set(value).size === expected.length
    && expected.every((item) => value.includes(item));
}
function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function parseLocation(bytes: Uint8Array): Location | null {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return null; }
  if (!isRecord(value) || Object.keys(value).length !== 3) return null;
  const { latitude, longitude, accuracy_meters: accuracy } = value;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 10_000) return null;
  return { latitude, longitude, accuracyMeters: accuracy };
}
function validCoordinate(point: SearchCoordinate): boolean {
  return Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90
    && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requireRecord(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw new InvalidFeedError(); return value; }
function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.keys(value).length <= 100_000
    && Object.entries(value).every(([key, item]) => key.length <= 128 && typeof item === "string" && item.length <= 2_048);
}
function isCrossOrigin(request: Request, origin: string): boolean {
  const header = request.headers.get("Origin");
  return (header !== null && header !== origin) || request.headers.get("Sec-Fetch-Site") === "cross-site";
}
function readCookie(header: string | null, name: string): string | null {
  if (!header || header.length > 8_192) return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(name + "="));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}
class BodyTooLargeError extends Error {}
class CoverageUnavailableError extends Error {}
class InvalidFeedError extends Error {}
class FeedHTTPError extends Error { constructor(readonly status: number) { super("feed_http_error"); } }
async function readLimitedBody(request: Request | Response, max: number): Promise<Uint8Array> {
  const length = request.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > max)) throw new BodyTooLargeError();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      total += part.value.byteLength;
      if (total > max) { await reader.cancel().catch(() => undefined); throw new BodyTooLargeError(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function failureCode(response: Response): Promise<string | null> {
  if (response.status < 400) return null;
  try {
    const payload: unknown = await response.clone().json();
    if (isRecord(payload) && typeof payload.error === "string" && new Set([
      "method_not_allowed", "invalid_origin", "search_unavailable", "unsupported_media_type", "authentication_required",
      "session_unavailable", "request_too_large", "invalid_request", "location_too_uncertain", "search_rate_limited",
      "source_unavailable", "source_timeout", "coverage_unavailable", "invalid_response",
    ]).has(payload.error)) return payload.error;
  } catch { /* Fixed fallback only. */ }
  return "http_error";
}
function json(value: Record<string, unknown>, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra,
  } });
}
