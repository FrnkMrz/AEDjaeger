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
  /**
   * Woher der Treffer stammt. "archive": aus dem Archiv des echten OSM. "development": von der OSM-Entwicklungsinstanz
   * (Testserver). Ein Treffer aus dem Archiv gibt es auf dem Testserver nicht und lässt sich dort nicht ändern.
   * Fehlt die Angabe (ältere Antworten, Tests), ist die Herkunft unbekannt; dann entscheidet der Server beim Schreiben.
   */
  source?: "archive" | "development";
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
