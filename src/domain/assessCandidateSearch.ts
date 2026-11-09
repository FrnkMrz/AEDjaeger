import {
  assessCandidates,
  type CandidateAssessment,
  type LocationEstimate,
  type MatchPolicy,
} from "./candidateMatch";
import type { CandidateSearchResult } from "../osm/candidateTypes";

export interface CandidateSearchAssessment {
  search: CandidateSearchResult;
  assessment: CandidateAssessment;
}

/** A failed or partial static search can never make a new AED eligible. */
export function assessCandidateSearch(
  location: LocationEstimate,
  search: CandidateSearchResult,
  policy: MatchPolicy,
): CandidateSearchAssessment {
  const assessment = assessCandidates(location, {
    status: search.status,
    coverageRadiusMeters: search.coverageRadiusMeters,
    candidates: search.candidates.map(({ id, coordinateQuality, position }) => ({ id, coordinateQuality, position })),
  }, policy);
  return { search, assessment };
}
