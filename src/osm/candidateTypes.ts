/** Shared, provider-neutral result types for the nearby AED search. */
export interface SearchCoordinate {
  latitude: number;
  longitude: number;
}

export interface NearbyAedCandidate {
  id: string;
  osmType: "node" | "way" | "relation";
  /** Filled by a fresh, targeted OSM read before an edit; the static feed has no version. */
  version?: number;
  coordinateQuality: "exact" | "approximate-center";
  position: SearchCoordinate;
  tags: Readonly<Record<string, string>>;
}

export type CandidateSearchFailureReason =
  | "invalid-request"
  | "invalid-response"
  | "coverage-unavailable";

export interface CandidateSearchResult {
  status: "complete" | "partial" | "failed";
  candidates: NearbyAedCandidate[];
  coverageRadiusMeters: number;
  retryAfterSeconds?: number;
  reason?: CandidateSearchFailureReason;
  snapshotId?: string;
  dataUntil?: string;
}
