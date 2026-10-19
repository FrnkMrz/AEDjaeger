import { describe, expect, it } from "vitest";
import { assessOverpassResponse } from "../src/domain/assessOverpassResponse";
import type { LocationEstimate, MatchPolicy } from "../src/domain/candidateMatch";

const location: LocationEstimate = {
  latitude: 52.52,
  longitude: 13.405,
  accuracyMeters: 10,
};
const policy: MatchPolicy = {
  nearbyRadiusMeters: 100,
  maximumAccuracyMeters: 100,
};

describe("Overpass candidate assessment integration", () => {
  it("makes a nearby exact AED node available for explicit user review", () => {
    const result = assessOverpassResponse(location, {
      elements: [{
        type: "node",
        id: 154,
        lat: 52.52001,
        lon: 13.40501,
        tags: { emergency: "defibrillator", "defibrillator:location": "Eingang" },
      }],
    }, 110, policy);

    expect(result.search.status).toBe("complete");
    expect(result.assessment).toMatchObject({
      kind: "candidate-review",
      candidates: [{ id: "node/154", coordinateQuality: "exact" }],
    });
    expect(result.search.candidates[0]?.tags["defibrillator:location"]).toBe("Eingang");
  });

  it("allows a new-entry proposal only after a complete empty search", () => {
    const result = assessOverpassResponse(location, { elements: [] }, 110, policy);

    expect(result.search.status).toBe("complete");
    expect(result.assessment).toEqual({ kind: "new-entry-eligible" });
  });

  it("keeps an Overpass timeout from enabling a new-entry proposal", () => {
    const result = assessOverpassResponse(location, {
      elements: [],
      remark: "runtime error: query timed out",
    }, 110, policy);

    expect(result.search.status).toBe("partial");
    expect(result.assessment).toEqual({
      kind: "search-incomplete",
      reason: "partial-results",
    });
  });

  it("keeps approximate way centers for manual review even when the center is distant", () => {
    const result = assessOverpassResponse(location, {
      elements: [{
        type: "way",
        id: 256,
        center: { lat: 52.523, lon: 13.405 },
        tags: { emergency: "defibrillator" },
      }],
    }, 110, policy);

    expect(result.assessment).toMatchObject({
      kind: "candidate-review",
      candidates: [{ id: "way/256", coordinateQuality: "approximate-center" }],
    });
  });

  it("treats malformed Overpass data as a failed search", () => {
    const result = assessOverpassResponse(location, { elements: null }, 110, policy);

    expect(result.search.status).toBe("failed");
    expect(result.assessment).toEqual({ kind: "search-failed" });
  });

  it("does not promote a valid response when the search did not cover GPS uncertainty", () => {
    const result = assessOverpassResponse(location, { elements: [] }, 109, policy);

    expect(result.assessment).toEqual({
      kind: "search-incomplete",
      reason: "coverage-too-small",
    });
  });
});
