export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface LocationEstimate extends Coordinate {
  accuracyMeters: number;
}

export interface OSMCandidate {
  id: string;
  // Node coordinates are exact map points; way/relation centers can be far from the AED.
  coordinateQuality: "exact" | "approximate-center";
  position: Coordinate;
}

export interface SearchResult {
  status: "complete" | "partial" | "failed";
  // Radius around the reported phone position that the successful query actually covered.
  coverageRadiusMeters: number;
  candidates: OSMCandidate[];
}

export interface MatchPolicy {
  // The area around the user's real position in which we want to find nearby AEDs.
  nearbyRadiusMeters: number;
  // Beyond this GPS accuracy, ask the user to improve or clarify the location.
  maximumAccuracyMeters: number;
}

export interface RankedCandidate extends OSMCandidate {
  distanceMeters: number;
}

export type CandidateAssessment =
  | { kind: "invalid-input" }
  | { kind: "search-failed" }
  | { kind: "search-incomplete"; reason: "partial-results" | "coverage-too-small" }
  | { kind: "location-too-uncertain"; accuracyMeters: number; maximumAccuracyMeters: number }
  | { kind: "new-entry-eligible" }
  | { kind: "candidate-review"; candidates: RankedCandidate[] };

const EARTH_RADIUS_METERS = 6_371_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidCoordinate(point: unknown): point is Coordinate {
  if (!isRecord(point)) return false;
  return (
    typeof point.latitude === "number" &&
    Number.isFinite(point.latitude) &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isValidInput(
  location: LocationEstimate,
  search: SearchResult,
  policy: MatchPolicy,
): boolean {
  if (!isRecord(location) || !isRecord(search) || !isRecord(policy)) return false;
  if (!isValidCoordinate(location) || !isNonNegativeFinite(location.accuracyMeters as number)) return false;
  if (!isNonNegativeFinite(policy.nearbyRadiusMeters as number) || policy.nearbyRadiusMeters === 0) return false;
  if (!isNonNegativeFinite(policy.maximumAccuracyMeters as number)) return false;
  if (!isNonNegativeFinite(search.coverageRadiusMeters as number) || !Array.isArray(search.candidates)) return false;
  if (!["complete", "partial", "failed"].includes(search.status as string)) return false;

  const candidateIds = new Set<string>();
  for (const candidate of search.candidates) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || candidate.id.trim() === "") return false;
    if (candidate.id !== candidate.id.trim() || !isValidCoordinate(candidate.position)) return false;
    if (!["exact", "approximate-center"].includes(candidate.coordinateQuality as string)) return false;
    if (candidateIds.has(candidate.id)) return false;
    candidateIds.add(candidate.id);
  }

  return true;
}

/** Distance between two coordinates, used to rank candidates rather than confirm identity. */
export function distanceMeters(from: Coordinate, to: Coordinate): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  // Floating-point rounding can make the haversine fraction slightly exceed one.
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

/**
 * Assesses search results without deciding that a nearby object is the photographed AED.
 * A new-entry path is eligible only after a complete query covers the reported GPS
 * uncertainty estimate and configured nearby radius. Accuracy is not an absolute bound,
 * so this result never claims that no AED exists; any returned candidate needs user review.
 */
export function assessCandidates(
  location: LocationEstimate,
  search: SearchResult,
  policy: MatchPolicy,
): CandidateAssessment {
  if (!isValidInput(location, search, policy)) return { kind: "invalid-input" };
  if (search.status === "failed") return { kind: "search-failed" };
  if (search.status === "partial") return { kind: "search-incomplete", reason: "partial-results" };
  if (location.accuracyMeters > policy.maximumAccuracyMeters) {
    return {
      kind: "location-too-uncertain",
      accuracyMeters: location.accuracyMeters,
      maximumAccuracyMeters: policy.maximumAccuracyMeters,
    };
  }

  // Expand the query by the reported accuracy estimate. Browser accuracy is not a
  // guarantee about the phone's true position, so an empty result only permits a proposal.
  const requiredCoverageMeters = location.accuracyMeters + policy.nearbyRadiusMeters;
  if (search.coverageRadiusMeters < requiredCoverageMeters) {
    return { kind: "search-incomplete", reason: "coverage-too-small" };
  }

  const candidates = search.candidates
    .map((candidate) => ({
      ...candidate,
      distanceMeters: distanceMeters(location, candidate.position),
    }))
    // Keep approximate centers even when their calculated distance is large: the
    // underlying way or relation may still overlap the searched area. Manual review
    // prevents that approximate coordinate from hiding a possible existing AED.
    .filter((candidate) => candidate.coordinateQuality === "approximate-center" || candidate.distanceMeters <= requiredCoverageMeters)
    .sort((left, right) => {
      if (left.distanceMeters !== right.distanceMeters) return left.distanceMeters - right.distanceMeters;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

  if (candidates.length === 0) return { kind: "new-entry-eligible" };
  return { kind: "candidate-review", candidates };
}
