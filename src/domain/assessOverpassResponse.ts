import {
  assessCandidates,
  type CandidateAssessment,
  type LocationEstimate,
  type MatchPolicy,
} from "./candidateMatch";
import { normalizeOverpassResponse, type OverpassSearchResult } from "../osm/overpassSearch";

export interface OverpassAssessment {
  // Keep the normalized OSM tags and object type alongside the decision for later
  // user-facing explanation; the matcher only needs ID and position quality.
  search: OverpassSearchResult;
  assessment: CandidateAssessment;
}

/**
 * Connects the untrusted Overpass response to the conservative candidate matcher.
 * A partial or failed query can never become a "new entry eligible" assessment.
 */
export function assessOverpassResponse(
  location: LocationEstimate,
  payload: unknown,
  coverageRadiusMeters: number,
  policy: MatchPolicy,
): OverpassAssessment {
  const search = normalizeOverpassResponse(payload, coverageRadiusMeters);
  const assessment = assessCandidates(
    location,
    {
      status: search.status,
      coverageRadiusMeters: search.coverageRadiusMeters,
      candidates: search.candidates.map(({ id, coordinateQuality, position }) => ({
        id,
        coordinateQuality,
        position,
      })),
    },
    policy,
  );

  return { search, assessment };
}
