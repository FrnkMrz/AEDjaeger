import { describe, expect, it } from "vitest";
import { CONFIRM_RADIUS_METERS, MAX_LOCATION_ACCURACY_METERS, NEARBY_RADIUS_METERS } from "../src/domain/matchPolicy";
import { assessCandidates, distanceMeters, type LocationEstimate, type MatchPolicy, type SearchResult } from "../src/domain/candidateMatch";

const location: LocationEstimate = { latitude: 52.5, longitude: 13.4, accuracyMeters: 10 };
const policy: MatchPolicy = { nearbyRadiusMeters: 100, maximumAccuracyMeters: 100 };
const completeEmptySearch: SearchResult = { status: "complete", coverageRadiusMeters: 110, candidates: [] };

describe("distance tiers from the match policy", () => {
  // 1 Meter entspricht etwa 0,000009 Grad Breite.
  const metersNorth = (meters: number) => ({ latitude: 52.5 + meters * 0.000009, longitude: 13.4 });
  const tierPolicy: MatchPolicy = { nearbyRadiusMeters: NEARBY_RADIUS_METERS, maximumAccuracyMeters: MAX_LOCATION_ACCURACY_METERS };
  const search = (...metres: number[]): SearchResult => ({
    status: "complete", coverageRadiusMeters: 200,
    candidates: metres.map((meters) => ({ id: `node/${meters + 1}`, coordinateQuality: "exact" as const, position: metersNorth(meters) })),
  });

  it("keeps AEDs up to 50 m and drops everything farther, even with a poor GPS accuracy", () => {
    // Früher zählte die volle GPS-Ungenauigkeit dazu: Bei 30 m Genauigkeit blieben AEDs bis 130 m übrig.
    const result = assessCandidates({ ...location, accuracyMeters: 30 }, search(3, 40, 60, 120, 170), tierPolicy);
    expect(result.kind).toBe("candidate-review");
    if (result.kind !== "candidate-review") return;
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["node/4", "node/41"]);
    expect(result.candidates.every((candidate) => candidate.distanceMeters <= NEARBY_RADIUS_METERS)).toBe(true);
  });

  it("offers a new entry when the only AEDs are farther than 50 m", () => {
    expect(assessCandidates(location, search(60, 170), tierPolicy)).toEqual({ kind: "new-entry-eligible" });
  });

  it("treats a GPS accuracy worse than 50 m as too uncertain, so the app asks for the map position", () => {
    expect(assessCandidates({ ...location, accuracyMeters: 51 }, search(3), tierPolicy)).toEqual({
      kind: "location-too-uncertain", accuracyMeters: 51, maximumAccuracyMeters: 50,
    });
    expect(assessCandidates({ ...location, accuracyMeters: 50 }, search(3), tierPolicy).kind).toBe("candidate-review");
  });

  it("uses 10 m for confirming and 50 m for the hint tier", () => {
    expect(CONFIRM_RADIUS_METERS).toBe(10);
    expect(NEARBY_RADIUS_METERS).toBe(50);
    expect(CONFIRM_RADIUS_METERS).toBeLessThan(NEARBY_RADIUS_METERS);
  });
});

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
