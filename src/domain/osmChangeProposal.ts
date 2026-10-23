import { assessCandidates, distanceMeters, type Coordinate } from "./candidateMatch";
import type { OverpassCandidate } from "../osm/overpassSearch";

export interface TagChange {
  key: string;
  before: string | null;
  after: string;
}

export interface ExistingCheckDatePreview {
  kind: "ready";
  operation: "update";
  target: string;
  changes: [TagChange];
}

export interface NewAedPreview {
  kind: "ready";
  operation: "create-node";
  position: Coordinate;
  tags: Readonly<Record<string, string>>;
}

export type ProposalError =
  | "confirmation-required"
  | "unsupported-object"
  | "invalid-date"
  | "invalid-candidate"
  | "search-not-clear"
  | "position-not-confirmed"
  | "invalid-position"
  | "invalid-search-coverage"
  | "position-outside-search"
  | "search-found-candidate"
  | "invalid-location-description";

export type ProposalResult<T> = T | { kind: "blocked"; reason: ProposalError };

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidPosition(value: Coordinate): boolean {
  return Number.isFinite(value.latitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180;
}

/**
 * Prepares the narrowly allowed existence update after the person confirms this
 * exact OSM candidate. Keeping the patch to one tag protects every other mapper's data.
 */
export function previewExistingAedCheck(
  candidate: Pick<OverpassCandidate, "id" | "osmType" | "tags">,
  confirmedPresent: boolean,
  observedOn: string,
): ProposalResult<ExistingCheckDatePreview> {
  if (!confirmedPresent) return { kind: "blocked", reason: "confirmation-required" };
  if (!isValidDate(observedOn)) return { kind: "blocked", reason: "invalid-date" };
  if (
    !candidate
    || typeof candidate.id !== "string"
    || !["node", "way", "relation"].includes(candidate.osmType)
    || typeof candidate.tags !== "object"
    || candidate.tags === null
  ) {
    return { kind: "blocked", reason: "invalid-candidate" };
  }
  const parts = candidate.id.split("/");
  const [idType, id] = parts;
  if (parts.length !== 2 || idType !== candidate.osmType || !/^\d+$/.test(id ?? "")) {
    return { kind: "blocked", reason: "invalid-candidate" };
  }
  // Ways and relations use approximate centers in search results. Do not update an
  // unusual AED object until a separate workflow can ask the user to inspect it.
  if (candidate.osmType !== "node") return { kind: "blocked", reason: "unsupported-object" };

  const previousDate = candidate.tags.check_date;
  return {
    kind: "ready",
    operation: "update",
    target: candidate.id,
    changes: [{ key: "check_date", before: typeof previousDate === "string" ? previousDate : null, after: observedOn }],
  };
}

/**
 * Produces a local preview for a new AED node only when search completed cleanly,
 * no candidate was eligible, and the person confirmed the proposed map point.
 * Vision output is intentionally not accepted as an input to this function.
 */
export function previewNewAed(
  input: {
    searchStatus: "complete" | "partial" | "failed";
    assessmentKind: "new-entry-eligible" | "candidate-review" | "search-incomplete" | "search-failed" | "location-too-uncertain" | "invalid-input";
    position: Coordinate;
    searchCenter: Coordinate;
    coverageRadiusMeters: number;
    nearbyRadiusMeters: number;
    searchCandidates: ReadonlyArray<OverpassCandidate>;
    positionConfirmed: boolean;
    observedOn: string;
    locationDescription?: string;
  },
): ProposalResult<NewAedPreview> {
  if (input.searchStatus !== "complete" || input.assessmentKind !== "new-entry-eligible") {
    return { kind: "blocked", reason: "search-not-clear" };
  }
  if (!isValidDate(input.observedOn)) return { kind: "blocked", reason: "invalid-date" };
  if (!isValidPosition(input.position)) return { kind: "blocked", reason: "invalid-position" };
  if (!input.positionConfirmed) return { kind: "blocked", reason: "position-not-confirmed" };
  if (
    !isValidPosition(input.searchCenter)
    || !Number.isFinite(input.coverageRadiusMeters)
    || input.coverageRadiusMeters <= 0
    || !Number.isFinite(input.nearbyRadiusMeters)
    || input.nearbyRadiusMeters <= 0
  ) {
    return { kind: "blocked", reason: "invalid-search-coverage" };
  }

  const distanceFromSearchCenter = distanceMeters(input.searchCenter, input.position);
  if (distanceFromSearchCenter + input.nearbyRadiusMeters > input.coverageRadiusMeters) {
    return { kind: "blocked", reason: "position-outside-search" };
  }

  // An empty result only helps at the location that was actually searched. Require
  // the full candidate radius around the user's confirmed point to fit in that area.
  const coverageAssessment = assessCandidates(
    { ...input.position, accuracyMeters: 0 },
    {
      status: "complete",
      coverageRadiusMeters: input.coverageRadiusMeters,
      candidates: [...input.searchCandidates],
    },
    { nearbyRadiusMeters: input.nearbyRadiusMeters, maximumAccuracyMeters: 0 },
  );
  if (coverageAssessment.kind === "search-incomplete") {
    return { kind: "blocked", reason: "position-outside-search" };
  }
  // Recheck every result around the confirmed point: a node filtered as distant
  // from the original phone position may be a plausible match after the user moves
  // the proposed map point. Approximate ways/relations stay for manual review.
  if (coverageAssessment.kind !== "new-entry-eligible") {
    return { kind: "blocked", reason: "search-found-candidate" };
  }

  const tags: Record<string, string> = {
    emergency: "defibrillator",
    check_date: input.observedOn,
  };
  if (input.locationDescription !== undefined) {
    if (/[\u0000-\u001f\u007f]/.test(input.locationDescription)) {
      return { kind: "blocked", reason: "invalid-location-description" };
    }
    const description = input.locationDescription.trim();
    if (description.length === 0 || description.length > 160) {
      return { kind: "blocked", reason: "invalid-location-description" };
    }
    tags["defibrillator:location"] = description;
  }

  return {
    kind: "ready",
    operation: "create-node",
    position: { latitude: input.position.latitude, longitude: input.position.longitude },
    tags,
  };
}
