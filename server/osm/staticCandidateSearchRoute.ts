import { MAX_LOCATION_ACCURACY_METERS, NEARBY_RADIUS_METERS } from "../../src/domain/matchPolicy";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import { fetchWithoutRedirects } from "../http/fetchWithoutRedirects";
import { importOAuthEncryptionKey } from "../auth/osmOAuth";
import { findOSMSession } from "../storage/osmSessions";
import { findOSMDevelopmentToken } from "../storage/osmDevelopmentTokens";
import type { D1Database } from "../storage/d1";
import { reserveSearchSlot } from "../storage/searchCooldown";
import type { NearbyAedCandidate, SearchCoordinate } from "../../src/osm/candidateTypes";
import { requestOSMDevelopmentApi } from "./developmentApi";

const SESSION_COOKIE = "aedjaeger_osm_session";
const DATA_ORIGIN = "https://pipeline.openfiremap.org/";
const PMTILES_PATH = "openfiremap.pmtiles";
const AED_LAYER = "defibrillators";
const AED_ZOOM = 14;
// Höchstalter der OSM-Daten im Archiv: 5 Tage (120 Stunden). Produktentscheidung vom
// 10.11.2026: 48 Stunden waren zu knapp, weil schon ein einzelner ausgefallener
// Pipeline-Lauf die Suche gesperrt hätte. Ältere Daten bleiben ein Suchfehler
// (fail-closed) und gelten nie als Beleg, dass an einem Ort kein AED existiert.
// Vor einer Neuanlage prüft die Schreibroute den Kartenausschnitt ohnehin erneut live.
// Derselbe Wert steht in scripts/check-live-search.mjs und muss synchron bleiben.
const MAX_SOURCE_AGE_HOURS = 5 * 24;
const MAX_ACCURACY = MAX_LOCATION_ACCURACY_METERS;
// Reichweite der Suche und Genauigkeitsgrenze: siehe src/domain/matchPolicy.ts (gleiche Zahlen wie in der App).
const SEARCH_RADIUS = NEARBY_RADIUS_METERS;
const MAX_REQUEST_BYTES = 1_024;
const MAX_METADATA_BYTES = 256 * 1_024;
const MAX_RANGE_BYTES = 8 * 1_024 * 1_024;
const MAX_TILE_BYTES = 1 * 1_024 * 1_024;
const MAX_MAP_BYTES = 512 * 1_024;
const MAX_CANDIDATES = 100;
const MAX_TILES = 16;
const TIMEOUT_MS = 15_000;
const EXTRACT_STATUSES = new Set(["fresh_download", "downloaded_dated", "cached_head_ok", "downloaded"]);
const REQUIRED_EXTRACTS = ["germany", "austria", "switzerland", "luxembourg", "liechtenstein"];
const ALLOWED_TAGS = new Set([
  "access", "check_date", "defibrillator:location", "fee", "indoor", "level", "location", "name", "opening_hours",
  "operator", "ref", "start_date", "wheelchair",
]);

type Environment = { DB?: D1Database; OSM_OAUTH_ENCRYPTION_KEY?: string };
type Dependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  createDiagnosticId?: () => string;
  logDiagnostic?: (event: Readonly<Record<string, string | number>>) => void;
};
type Location = SearchCoordinate & { accuracyMeters: number };
type PipelineMetadata = {
  status: "ok";
  region: "dachlilu";
  generated_at: string;
  osm_data_until: string;
  extracts: Record<string, { status: string; osm_data_timestamp: string }>;
  pmtiles: { file: string; size_bytes: number };
  features: { defibrillators: { count: number } };
};

/** Authenticated lookup in the AED layer of the fixed, read-only PMTiles archive. */
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
    const metadata = await fetchMetadata(fetcher, controller.signal, now);
    const radius = Math.ceil(location.accuracyMeters + SEARCH_RADIUS);
    const bounds = searchBounds(location, radius);
    if (!boundsFitArchive(bounds, metadata)) throw new CoverageUnavailableError();

    // metadata.json is the current pointer. Putting its build time in the archive URL
    // prevents a warm Worker from mixing cached tile directories from two builds.
    const archiveUrl = new URL(PMTILES_PATH, DATA_ORIGIN);
    archiveUrl.searchParams.set("v", metadata.generated_at);
    const archive = new PMTiles(new FixedRangeSource(archiveUrl, fetcher, controller.signal));
    const header = await archive.getHeader();
    if (header.tileType !== 1 || header.minZoom > AED_ZOOM || header.maxZoom < AED_ZOOM
      || !boundsFitHeader(bounds, header)) throw new CoverageUnavailableError();

    const tiles = tilesForBounds(bounds, AED_ZOOM);
    if (tiles.length === 0 || tiles.length > MAX_TILES) throw new CoverageUnavailableError();
    const candidates = new Map<string, NearbyAedCandidate>();
    for (const tile of tiles) {
      const content = await archive.getZxy(tile.z, tile.x, tile.y, controller.signal);
      if (!content) continue; // A missing tile in a validated archive represents an empty tile.
      if (content.data.byteLength > MAX_TILE_BYTES) throw new InvalidFeedError();
      const decoded = new VectorTile(new PbfReader(new Uint8Array(content.data)));
      const layer = decoded.layers[AED_LAYER];
      if (!layer) continue;
      for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index);
        const candidate = candidateFromFeature(feature.toGeoJSON(tile.x, tile.y, tile.z), "archive");
        if (!candidate || distanceMeters(location, candidate.position) > radius) continue;
        const prior = candidates.get(candidate.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(candidate)) throw new InvalidFeedError();
        candidates.set(candidate.id, candidate);
        if (candidates.size > MAX_CANDIDATES) throw new InvalidFeedError();
      }
    }

    // Das PMTiles-Headerrechteck ist größer als die tatsächlich heruntergeladenen
    // Länderflächen. Deshalb kann eine leere Kachel außerhalb der Extrakte keinen
    // Beleg für „hier gibt es keinen AED“ liefern. Nur bei einer leeren Feed-Suche
    // bestätigen wir den kleinen Ausschnitt direkt über die angemeldete OSM-Dev-API.
    // Scheitert diese gezielte Prüfung, bleibt die Suche unvollständig.
    if (candidates.size === 0) {
      if (session.environment !== "development" || !env.OSM_OAUTH_ENCRYPTION_KEY) throw new CoverageUnavailableError();
      const encryptionKey = await importOAuthEncryptionKey(env.OSM_OAUTH_ENCRYPTION_KEY);
      const accessToken = await findOSMDevelopmentToken(env.DB, sessionToken, now, encryptionKey);
      if (!accessToken) throw new CoverageUnavailableError();
      const mapCandidates = await fetchDevelopmentCandidates(accessToken, bounds, location, fetcher, controller.signal);
      for (const candidate of mapCandidates) candidates.set(candidate.id, candidate);
    } else if (session.environment === "development" && env.OSM_OAUTH_ENCRYPTION_KEY) {
      // Testserver-Sitzung mit Treffern aus dem Archiv: Auch die Entwicklungsinstanz abfragen und die Treffer
      // zusammenführen. Der Schutz vor Doppelten beim Anlegen schaut dort ohnehin hin; ohne diese Abfrage zeigte die
      // Suche zum Beispiel den eigenen Test-Knoten nie, und das Anlegen wurde trotzdem blockiert. Hier ist die Abfrage
      // eine Ergänzung: Scheitert sie, bleibt es beim Ergebnis aus dem Archiv (wie bisher). Bei gleicher Kennung gewinnt
      // der Treffer vom Testserver, weil nur er sich dort ändern lässt.
      try {
        const encryptionKey = await importOAuthEncryptionKey(env.OSM_OAUTH_ENCRYPTION_KEY);
        const accessToken = await findOSMDevelopmentToken(env.DB, sessionToken, now, encryptionKey);
        if (accessToken) {
          for (const candidate of await fetchDevelopmentCandidates(accessToken, bounds, location, fetcher, controller.signal)) candidates.set(candidate.id, candidate);
        }
      } catch { /* Ergänzung scheitert: Ergebnis aus dem Archiv bleibt gültig. */ }
    }

    return json({
      status: "complete", candidates: [...candidates.values()], coverage_radius_meters: radius,
      snapshot_id: await snapshotId(metadata), data_until: metadata.osm_data_until,
    }, 200, { "Retry-After": String(retryAfter) });
  } catch (error) {
    if (error instanceof CoverageUnavailableError) return json({ error: "coverage_unavailable" }, 503, { "Retry-After": String(retryAfter) });
    if (error instanceof InvalidFeedError) return json({ error: "invalid_response" }, 503, { "Retry-After": String(retryAfter) });
    if (error instanceof FeedHTTPError) return json({ error: "source_unavailable" }, 502, { "Retry-After": String(retryAfter) });
    return json({ error: controller.signal.aborted ? "source_timeout" : "source_unavailable" }, controller.signal.aborted ? 504 : 502, { "Retry-After": String(retryAfter) });
  } finally { clearTimeout(timeout); }
}

/** Fetch current build metadata and reject partial/stale source coverage before searching tiles. */
async function fetchMetadata(fetcher: typeof fetch, signal: AbortSignal, now: number): Promise<PipelineMetadata> {
  const response = await fetchWithoutRedirects(new URL("metadata.json", DATA_ORIGIN), {
    method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal,
  }, fetcher);
  if (!response.ok) throw new FeedHTTPError(response.status);
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readLimitedBody(response, MAX_METADATA_BYTES)));
  if (!isRecord(value) || value.status !== "ok" || value.region !== "dachlilu"
    || typeof value.generated_at !== "string" || typeof value.osm_data_until !== "string"
    || !isRecord(value.pmtiles) || value.pmtiles.file !== PMTILES_PATH
    || !Number.isSafeInteger(value.pmtiles.size_bytes) || (value.pmtiles.size_bytes as number) < 127
    || !isRecord(value.features) || !isRecord(value.features.defibrillators)
    || !Number.isSafeInteger(value.features.defibrillators.count) || (value.features.defibrillators.count as number) < 0
    || !isRecord(value.extracts)) throw new CoverageUnavailableError();
  const generatedAt = timestamp(value.generated_at);
  const dataUntil = timestamp(value.osm_data_until);
  if (generatedAt === null || dataUntil === null || generatedAt > now + 60_000
    || dataUntil > now + 60_000 || now - dataUntil > MAX_SOURCE_AGE_HOURS * 3_600_000) throw new CoverageUnavailableError();
  for (const country of REQUIRED_EXTRACTS) {
    const extract = value.extracts[country];
    const sourceDate = isRecord(extract) ? timestamp(extract.osm_data_timestamp) : null;
    if (!isRecord(extract) || !EXTRACT_STATUSES.has(String(extract.status)) || sourceDate === null
      || sourceDate > now + 60_000 || now - sourceDate > MAX_SOURCE_AGE_HOURS * 3_600_000) throw new CoverageUnavailableError();
  }
  return value as unknown as PipelineMetadata;
}

/** Restrict PMTiles byte reads to one fixed origin and bounded HTTP Range responses. */
class FixedRangeSource implements Source {
  constructor(private readonly archiveUrl: URL, private readonly fetcher: typeof fetch, private readonly signal: AbortSignal) {}
  getKey(): string { return this.archiveUrl.href; }
  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0 || length > MAX_RANGE_BYTES) {
      throw new InvalidFeedError();
    }
    const end = offset + length - 1;
    const response = await fetchWithoutRedirects(this.archiveUrl, {
      method: "GET", headers: { Accept: "application/octet-stream", Range: `bytes=${offset}-${end}` },
      cache: "no-store", signal: signal ?? this.signal,
    }, this.fetcher);
    // Never allow a server/CDN that ignores Range to make the Worker download the full archive.
    if (response.status !== 206 || response.headers.get("Content-Range")?.startsWith(`bytes ${offset}-${end}/`) !== true) {
      try { await response.body?.cancel(); } catch { /* Keep the fixed source error. */ }
      throw new FeedHTTPError(response.status);
    }
    const bytes = await readLimitedBody(response, length);
    if (bytes.byteLength !== length) throw new InvalidFeedError();
    const data = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(data).set(bytes);
    return { data, etag: response.headers.get("ETag") ?? undefined };
  }
}

function candidateFromFeature(feature: GeoJSON.Feature, source: "archive" | "development"): NearbyAedCandidate | null {
  if (!feature.properties || feature.geometry?.type !== "Point") return null;
  const props = feature.properties as Record<string, unknown>;
  if (props.emergency !== "defibrillator") return null;
  const osmType = props["@type"] ?? props.type;
  if (osmType !== "node") return null;
  const rawId = props["@id"] ?? props.id;
  const id = typeof rawId === "string" && /^node\/[1-9]\d{0,15}$/u.test(rawId)
    ? rawId
    : typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? `node/${rawId}` : null;
  const coordinates = feature.geometry.coordinates;
  if (!id || !Array.isArray(coordinates) || coordinates.length < 2
    || typeof coordinates[0] !== "number" || typeof coordinates[1] !== "number") return null;
  const position = { longitude: coordinates[0], latitude: coordinates[1] };
  if (!validCoordinate(position)) throw new InvalidFeedError();
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!ALLOWED_TAGS.has(key)) continue;
    if (typeof value !== "string" || value.length > 2_048) throw new InvalidFeedError();
    tags[key] = value;
  }
  return { id, osmType: "node", coordinateQuality: "exact", source, position, tags };
}

/**
 * Confirms an empty static-index result with a tiny, authenticated OSM-dev map
 * request. The API response must be complete and valid before an empty result is
 * allowed to unlock the new-AED flow. Non-node AEDs fail closed because this
 * compact response does not provide a trustworthy point location for them.
 */
async function fetchDevelopmentCandidates(
  accessToken: string,
  bounds: ReturnType<typeof searchBounds>,
  location: Location,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<NearbyAedCandidate[]> {
  const response = await requestOSMDevelopmentApi("development", "/api/0.6/map.json", accessToken, {
    method: "GET",
    bbox: { west: bounds.minLon, south: bounds.minLat, east: bounds.maxLon, north: bounds.maxLat },
    signal,
  }, fetcher);
  if (!response.ok) throw new FeedHTTPError(response.status);

  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readLimitedBody(response, MAX_MAP_BYTES))); }
  catch { throw new InvalidFeedError(); }
  if (!isRecord(payload) || !Array.isArray(payload.elements) || payload.elements.length > 5_000) throw new InvalidFeedError();

  const candidates = new Map<string, NearbyAedCandidate>();
  for (const element of payload.elements) {
    if (!isRecord(element) || !["node", "way", "relation"].includes(String(element.type))
      || (element.tags !== undefined && !isStringRecord(element.tags))) throw new InvalidFeedError();
    if (!isStringRecord(element.tags) || element.tags.emergency !== "defibrillator") continue;
    if (element.type !== "node" || typeof element.lon !== "number" || typeof element.lat !== "number") {
      // Returning an empty result here could hide a mapped AED from the user and
      // incorrectly allow a duplicate node to be proposed.
      throw new CoverageUnavailableError();
    }
    const candidate = candidateFromFeature({
      type: "Feature",
      properties: { ...element.tags, "@type": "node", "@id": `node/${element.id}` },
      geometry: { type: "Point", coordinates: [element.lon, element.lat] },
    }, "development");
    if (!candidate) throw new InvalidFeedError();
    if (distanceMeters(location, candidate.position) <= Math.ceil(location.accuracyMeters + SEARCH_RADIUS)) {
      candidates.set(candidate.id, candidate);
    }
    if (candidates.size > MAX_CANDIDATES) throw new InvalidFeedError();
  }
  return [...candidates.values()];
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function searchBounds(location: Location, radius: number): { minLat: number; minLon: number; maxLat: number; maxLon: number } {
  const latitudeDelta = radius / 111_000;
  const cosine = Math.cos(location.latitude * Math.PI / 180);
  if (Math.abs(cosine) < 0.01) throw new CoverageUnavailableError();
  const longitudeDelta = radius / (111_000 * Math.abs(cosine));
  return {
    minLat: Math.max(-90, location.latitude - latitudeDelta), maxLat: Math.min(90, location.latitude + latitudeDelta),
    minLon: Math.max(-180, location.longitude - longitudeDelta), maxLon: Math.min(180, location.longitude + longitudeDelta),
  };
}
function boundsFitArchive(bounds: ReturnType<typeof searchBounds>, metadata: PipelineMetadata): boolean {
  // Header bounds are checked again after opening the archive; this first check rejects obvious non-DACH locations.
  return metadata.region === "dachlilu" && bounds.minLat >= 45 && bounds.maxLat <= 56
    && bounds.minLon >= 5 && bounds.maxLon <= 18;
}
function boundsFitHeader(bounds: ReturnType<typeof searchBounds>, header: Awaited<ReturnType<PMTiles["getHeader"]>>): boolean {
  return bounds.minLon >= header.minLon && bounds.maxLon <= header.maxLon
    && bounds.minLat >= header.minLat && bounds.maxLat <= header.maxLat;
}
function tilesForBounds(bounds: ReturnType<typeof searchBounds>, zoom: number): Array<{ z: number; x: number; y: number }> {
  const nw = tileFor(bounds.minLon, bounds.maxLat, zoom);
  const se = tileFor(bounds.maxLon, bounds.minLat, zoom);
  const tiles: Array<{ z: number; x: number; y: number }> = [];
  for (let y = nw.y; y <= se.y; y += 1) for (let x = nw.x; x <= se.x; x += 1) tiles.push({ z: zoom, x, y });
  return tiles;
}
function tileFor(longitude: number, latitude: number, zoom: number): { x: number; y: number } {
  const size = 2 ** zoom;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = lat * Math.PI / 180;
  return {
    x: Math.max(0, Math.min(size - 1, Math.floor((longitude + 180) / 360 * size))),
    y: Math.max(0, Math.min(size - 1, Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * size))),
  };
}
function distanceMeters(from: SearchCoordinate, to: SearchCoordinate): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(to.latitude - from.latitude);
  const lonDelta = radians(to.longitude - from.longitude);
  const value = Math.sin(latDelta / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lonDelta / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, value)));
}
async function snapshotId(metadata: PipelineMetadata): Promise<string> {
  const identity = `${metadata.generated_at}\0${metadata.osm_data_until}\0${metadata.pmtiles.size_bytes}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)));
  return "aed-" + Array.from(digest.slice(0, 10), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
