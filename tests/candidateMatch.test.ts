import { describe, expect, it } from "vitest";
import { assessCandidates, distanceMeters, type LocationEstimate, type MatchPolicy, type SearchResult } from "../src/domain/candidateMatch";

const location: LocationEstimate = { latitude: 52.5, longitude: 13.4, accuracyMeters: 10 };
const policy: MatchPolicy = { nearbyRadiusMeters: 100, maximumAccuracyMeters: 100 };
const completeEmptySearch: SearchResult = { status: "complete", coverageRadiusMeters: 110, candidates: [] };

describe("OSM candidate assessment", () => {
  it("computes zero distance for the same coordinate", () => {
    expect(distanceMeters(location, location)).toBe(0);
  });

  it("allows a new-entry proposal only after a complete, sufficiently broad empty search", () => {
    expect(assessCandidates(location, completeEmptySearch, policy)).toEqual({ kind: "new-entry-eligible" });
    expect(assessCandidates(location, { ...completeEmptySearch, status: "failed" }, policy)).toEqual({ kind: "search-failed" });
    expect(assessCandidates(location, { ...completeEmptySearch, status: "partial" }, policy)).toEqual({ kind: "search-incomplete", reason: "partial-results" });
    expect(assessCandidates(location, { ...completeEmptySearch, coverageRadiusMeters: 109 }, policy)).toEqual({ kind: "search-incomplete", reason: "coverage-too-small" });
  });

  it("asks for a better location when GPS uncertainty exceeds the configured limit", () => {
    const impreciseLocation = { ...location, accuracyMeters: 101 };
    expect(assessCandidates(impreciseLocation, { ...completeEmptySearch, coverageRadiusMeters: 201 }, policy)).toEqual({
      kind: "location-too-uncertain",
      accuracyMeters: 101,
      maximumAccuracyMeters: 100,
    });
  });

  it("returns nearby candidates for human confirmation instead of choosing one automatically", () => {
    const search: SearchResult = {
      status: "complete",
      coverageRadiusMeters: 110,
      candidates: [{ id: "node/1", coordinateQuality: "exact", position: location }],
    };
    expect(assessCandidates(location, search, policy)).toEqual({
      kind: "candidate-review",
      candidates: [{ id: "node/1", coordinateQuality: "exact", position: location, distanceMeters: 0 }],
    });
  });

  it("sorts multiple plausible candidates by distance with a stable ID tie-break", () => {
    const search: SearchResult = {
      status: "complete",
      coverageRadiusMeters: 110,
      candidates: [
        { id: "node/b", coordinateQuality: "exact", position: location },
        { id: "node/c", coordinateQuality: "exact", position: { latitude: 52.5008, longitude: 13.4 } },
        { id: "node/a", coordinateQuality: "exact", position: location },
      ],
    };
    const result = assessCandidates(location, search, policy);
    expect(result.kind).toBe("candidate-review");
    if (result.kind !== "candidate-review") throw new Error("Expected candidate review.");
    expect(result.candidates.map(({ id }) => id)).toEqual(["node/a", "node/b", "node/c"]);
  });

  it("does not count candidates outside the configured nearby area as matches", () => {
    const search: SearchResult = {
      status: "complete",
      coverageRadiusMeters: 110,
      candidates: [{ id: "node/far", coordinateQuality: "exact", position: { latitude: 52.502, longitude: 13.4 } }],
    };
    expect(assessCandidates(location, search, policy)).toEqual({ kind: "new-entry-eligible" });
  });

  it("keeps approximate way or relation centers for manual review even outside the radius", () => {
    const search: SearchResult = {
      status: "complete",
      coverageRadiusMeters: 110,
      candidates: [{
        id: "way/1",
        coordinateQuality: "approximate-center",
        position: { latitude: 52.502, longitude: 13.4 },
      }],
    };
    const result = assessCandidates(location, search, policy);
    expect(result.kind).toBe("candidate-review");
    if (result.kind !== "candidate-review") throw new Error("Expected manual review for the approximate center.");
    expect(result.candidates[0]?.id).toBe("way/1");
  });

  it("rejects invalid coordinates, duplicate candidate IDs, and missing coordinate quality", () => {
    expect(assessCandidates({ ...location, latitude: 91 }, completeEmptySearch, policy)).toEqual({ kind: "invalid-input" });
    expect(assessCandidates(location, {
      ...completeEmptySearch,
      candidates: [
        { id: "node/1", coordinateQuality: "exact", position: location },
        { id: "node/1", coordinateQuality: "exact", position: location },
      ],
    }, policy)).toEqual({ kind: "invalid-input" });
    expect(assessCandidates(location, {
      ...completeEmptySearch,
      candidates: [{ id: "node/broken", position: location } as never],
    }, policy)).toEqual({ kind: "invalid-input" });
  });
});
