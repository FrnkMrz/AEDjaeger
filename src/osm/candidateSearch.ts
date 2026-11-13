import { MAX_LOCATION_ACCURACY_METERS } from "../domain/matchPolicy";
import type { CandidateSearchResult, NearbyAedCandidate } from "./candidateTypes";

export class CandidateSearchError extends Error {
  constructor(readonly code: string, readonly retryAfterSeconds?: number) {
    super(code);
    this.name = "CandidateSearchError";
  }
}

export interface SearchLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

const MAX_SEARCH_ACCURACY_METERS = MAX_LOCATION_ACCURACY_METERS;
const SEARCH_REQUEST_TIMEOUT_MS = 35_000;
const MAX_RETRY_AFTER_SECONDS = 7 * 24 * 60 * 60;

/** Send only the location needed for one read-only nearby query; never persist it. */
export async function requestNearbyCandidates(
  location: SearchLocation,
  fetcher: typeof fetch = fetch,
): Promise<CandidateSearchResult> {
  // Do not send a precise location that the server must reject as too uncertain.
  if (!Number.isFinite(location.accuracyMeters) || location.accuracyMeters <= 0 || location.accuracyMeters > MAX_SEARCH_ACCURACY_METERS) {
    throw new CandidateSearchError("location_too_uncertain");
  }

  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_REQUEST_TIMEOUT_MS);
  try {
    response = await fetcher("/api/osm/candidates/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy_meters: location.accuracyMeters,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    throw new CandidateSearchError("network_error");
  }

  const responseRetryAfterSeconds = response.headers.has("Retry-After") ? readRetryAfter(response) : undefined;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CandidateSearchError(controller.signal.aborted ? "network_error" : "invalid_response", responseRetryAfterSeconds);
  } finally {
    // fetch resolves when headers arrive; keep the timer active while the body is read.
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const code = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      && typeof (payload as Record<string, unknown>).error === "string"
      ? (payload as Record<string, string>).error
      : "search_failed";
    throw new CandidateSearchError(code, responseRetryAfterSeconds);
  }

  const result = parseSearchResult(payload);
  if (!result) throw new CandidateSearchError("invalid_response", responseRetryAfterSeconds);
  result.retryAfterSeconds = responseRetryAfterSeconds ?? 30;
  return result;
}

function readRetryAfter(response: Response): number {
  const header = response.headers.get("Retry-After");
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : 30;
}

function parseSearchResult(value: unknown): CandidateSearchResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ["status", "candidates", "coverage_radius_meters", "snapshot_id", "data_until"].includes(key))) return null;
  if (!(["complete", "partial"].includes(record.status as string) && Array.isArray(record.candidates))) return null;
  if (!Number.isFinite(record.coverage_radius_meters) || (record.coverage_radius_meters as number) <= 0 || (record.coverage_radius_meters as number) > 500) return null;
  if (record.candidates.length > 100) return null;

  const candidates: NearbyAedCandidate[] = [];
  for (const candidateValue of record.candidates) {
    if (typeof candidateValue !== "object" || candidateValue === null || Array.isArray(candidateValue)) return null;
    const candidate = candidateValue as Record<string, unknown>;
    if (typeof candidate.id !== "string" || !/^(node|way|relation)\/[1-9]\d{0,15}$/u.test(candidate.id) || !Number.isSafeInteger(Number(candidate.id.split("/")[1]))) return null;
    if (candidate.version !== undefined && (!Number.isSafeInteger(candidate.version) || (candidate.version as number) <= 0)) return null;
    const osmType = candidate.id.split("/", 1)[0];
    if (candidate.osmType !== osmType) return null;
    if (candidate.coordinateQuality !== (osmType === "node" ? "exact" : "approximate-center")) return null;
    if (candidate.source !== undefined && candidate.source !== "archive" && candidate.source !== "development") return null;
    if (!isCoordinate(candidate.position) || !isStringRecord(candidate.tags)) return null;
    candidates.push(candidate as unknown as NearbyAedCandidate);
  }

  if (record.snapshot_id !== undefined && (typeof record.snapshot_id !== "string" || !/^aed-[0-9a-f]{20}$/u.test(record.snapshot_id))) return null;
  if (record.data_until !== undefined && (typeof record.data_until !== "string" || !Number.isFinite(Date.parse(record.data_until)))) return null;
  if ((record.snapshot_id === undefined) !== (record.data_until === undefined)) return null;
  return {
    status: record.status as "complete" | "partial",
    candidates,
    coverageRadiusMeters: record.coverage_radius_meters as number,
    ...(typeof record.snapshot_id === "string" ? { snapshotId: record.snapshot_id } : {}),
    ...(typeof record.data_until === "string" ? { dataUntil: record.data_until } : {}),
  };
}

function isCoordinate(value: unknown): value is { latitude: number; longitude: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const coordinate = value as Record<string, unknown>;
  return typeof coordinate.latitude === "number" && Number.isFinite(coordinate.latitude) && coordinate.latitude >= -90 && coordinate.latitude <= 90
    && typeof coordinate.longitude === "number" && Number.isFinite(coordinate.longitude) && coordinate.longitude >= -180 && coordinate.longitude <= 180;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 128 && entries.every(([key, item]) => key.length <= 256 && typeof item === "string" && item.length <= 2_048);
}
