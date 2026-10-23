/**
 * Read-only Overpass query and response handling for AED candidates.
 * Search coverage is carried forward so an empty result cannot silently mean "no AED"
 * when Overpass reported a partial answer.
 */

export interface SearchCoordinate {
  latitude: number;
  longitude: number;
}

export interface OverpassSearchRequest {
  center: SearchCoordinate;
  radiusMeters: number;
  timeoutSeconds?: number;
}

export interface OverpassCandidate {
  id: string;
  osmType: "node" | "way" | "relation";
  coordinateQuality: "exact" | "approximate-center";
  position: SearchCoordinate;
  tags: Readonly<Record<string, string>>;
}

export type SearchFailureReason =
  | "invalid-request"
  | "invalid-response"
  | "overpass-remark";

export interface OverpassSearchResult {
  status: "complete" | "partial" | "failed";
  candidates: OverpassCandidate[];
  coverageRadiusMeters: number;
  retryAfterSeconds?: number;
  reason?: SearchFailureReason;
}

const DEFAULT_TIMEOUT_SECONDS = 25;
const MAX_TIMEOUT_SECONDS = 60;
const MAX_RADIUS_METERS = 50_000;

function isValidCoordinate(point: SearchCoordinate): boolean {
  return Number.isFinite(point.latitude)
    && point.latitude >= -90
    && point.latitude <= 90
    && Number.isFinite(point.longitude)
    && point.longitude >= -180
    && point.longitude <= 180;
}

function isValidRadius(radiusMeters: number): boolean {
  return Number.isFinite(radiusMeters)
    && radiusMeters >= 1
    && radiusMeters <= MAX_RADIUS_METERS;
}

function isValidTimeout(timeoutSeconds: number): boolean {
  return Number.isInteger(timeoutSeconds)
    && timeoutSeconds >= 1
    && timeoutSeconds <= MAX_TIMEOUT_SECONDS;
}

/**
 * Builds a parameter-only query. Numeric validation prevents user input from
 * becoming Overpass QL syntax; radius remains a caller-selected trial setting.
 */
export function buildOverpassQuery(request: OverpassSearchRequest): string {
  const timeoutSeconds = request.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

  if (
    !isValidCoordinate(request.center)
    || !isValidRadius(request.radiusMeters)
    || !isValidTimeout(timeoutSeconds)
  ) {
    throw new RangeError("Ungültige Overpass-Suchparameter.");
  }

  const { latitude, longitude } = request.center;
  return [
    `[out:json][timeout:${timeoutSeconds}];`,
    `nwr["emergency"="defibrillator"](around:${request.radiusMeters},${latitude},${longitude});`,
    "out body center;",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTags(value: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(value)) return null;

  const tags: Record<string, string> = {};
  for (const [key, tagValue] of Object.entries(value)) {
    if (typeof tagValue !== "string") return null;
    tags[key] = tagValue;
  }
  return tags;
}

function readPosition(value: unknown): SearchCoordinate | null {
  if (!isRecord(value)) return null;
  const { lat, lon } = value;
  if (typeof lat !== "number" || typeof lon !== "number") return null;

  const position = { latitude: lat, longitude: lon };
  return isValidCoordinate(position) ? position : null;
}

function readCandidate(value: unknown): OverpassCandidate | null {
  if (!isRecord(value)) return null;
  const { type, id } = value;

  if (
    (type !== "node" && type !== "way" && type !== "relation")
    || typeof id !== "number"
    || !Number.isSafeInteger(id)
    || id <= 0
  ) {
    return null;
  }

  const tags = readTags(value.tags);
  if (!tags) return null;

  // Overpass returns the node's own point but only a display center for ways
  // and relations. Keep that distinction so later matching cannot over-trust it.
  const position = type === "node"
    ? readPosition(value)
    : readPosition(value.center);

  if (!position || tags.emergency !== "defibrillator") return null;

  return {
    id: `${type}/${id}`,
    osmType: type,
    coordinateQuality: type === "node" ? "exact" : "approximate-center",
    position,
    tags,
  };
}

/**
 * Converts untrusted JSON into candidates. A malformed element or Overpass
 * remark makes the search partial, never a clean empty result.
 */
export function normalizeOverpassResponse(
  payload: unknown,
  coverageRadiusMeters: number,
): OverpassSearchResult {
  if (!isValidRadius(coverageRadiusMeters)) {
    return {
      status: "failed",
      candidates: [],
      coverageRadiusMeters: 0,
      reason: "invalid-request",
    };
  }

  if (!isRecord(payload) || !Array.isArray(payload.elements)) {
    return {
      status: "failed",
      candidates: [],
      coverageRadiusMeters,
      reason: "invalid-response",
    };
  }

  const candidates: OverpassCandidate[] = [];
  let hasMalformedElement = false;

  for (const element of payload.elements) {
    const candidate = readCandidate(element);
    if (candidate) {
      candidates.push(candidate);
    } else {
      // The generated query can only return AEDs. Any other element means this
      // payload does not faithfully represent the requested search, so fail closed.
      hasMalformedElement = true;
    }
  }

  const hasRemark = typeof payload.remark === "string" && payload.remark.length > 0;
  if (hasRemark) {
    return {
      status: "partial",
      candidates,
      coverageRadiusMeters,
      reason: "overpass-remark",
    };
  }

  if (hasMalformedElement) {
    return {
      status: "partial",
      candidates,
      coverageRadiusMeters,
      reason: "invalid-response",
    };
  }

  return { status: "complete", candidates, coverageRadiusMeters };
}
