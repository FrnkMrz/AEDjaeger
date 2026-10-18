import { describe, expect, it } from "vitest";
import {
  buildOverpassQuery,
  normalizeOverpassResponse,
  type OverpassSearchRequest,
} from "../src/osm/overpassSearch";

const request: OverpassSearchRequest = {
  center: { latitude: 52.52, longitude: 13.405 },
  radiusMeters: 125,
};

describe("buildOverpassQuery", () => {
  it("searches nodes, ways, and relations and asks for centers and tags", () => {
    expect(buildOverpassQuery(request)).toBe(
      '[out:json][timeout:25];\nnwr["emergency"="defibrillator"](around:125,52.52,13.405);\nout center tags;',
    );
  });

  it("uses an explicit bounded timeout", () => {
    expect(buildOverpassQuery({ ...request, timeoutSeconds: 50 })).toContain("[timeout:50]");
    expect(() => buildOverpassQuery({ ...request, timeoutSeconds: 61 })).toThrow(RangeError);
  });

  it.each([
    { ...request, center: { latitude: 91, longitude: 13 } },
    { ...request, center: { latitude: 52, longitude: Number.NaN } },
    { ...request, radiusMeters: 0 },
    { ...request, radiusMeters: 50_001 },
  ])("rejects invalid request parameters: %o", (invalidRequest) => {
    expect(() => buildOverpassQuery(invalidRequest)).toThrow(RangeError);
  });
});

describe("normalizeOverpassResponse", () => {
  it("preserves an exact node and approximate way/relation centers", () => {
    const result = normalizeOverpassResponse({
      elements: [
        { type: "node", id: 12, lat: 52.52, lon: 13.405, tags: { emergency: "defibrillator" } },
        { type: "way", id: 13, center: { lat: 52.521, lon: 13.406 }, tags: { emergency: "defibrillator" } },
        { type: "relation", id: 14, center: { lat: 52.522, lon: 13.407 }, tags: { emergency: "defibrillator" } },
      ],
    }, 125);

    expect(result.status).toBe("complete");
    expect(result.candidates.map((candidate) => candidate.coordinateQuality)).toEqual([
      "exact",
      "approximate-center",
      "approximate-center",
    ]);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      "node/12",
      "way/13",
      "relation/14",
    ]);
  });

  it("treats a clean empty response as a completed search, not as an entry decision", () => {
    expect(normalizeOverpassResponse({ elements: [] }, 125)).toEqual({
      status: "complete",
      candidates: [],
      coverageRadiusMeters: 125,
    });
  });

  it("marks an Overpass remark as partial even when no candidates were returned", () => {
    expect(normalizeOverpassResponse({
      elements: [],
      remark: "runtime error: query timed out",
    }, 125)).toMatchObject({ status: "partial", reason: "overpass-remark" });
  });

  it("retains valid candidates but marks malformed candidate data partial", () => {
    const result = normalizeOverpassResponse({
      elements: [
        { type: "node", id: 12, lat: 52.52, lon: 13.405, tags: { emergency: "defibrillator" } },
        { type: "way", id: 13, tags: { emergency: "defibrillator" } },
      ],
    }, 125);

    expect(result.status).toBe("partial");
    expect(result.candidates).toHaveLength(1);
  });

  it("fails closed for an invalid top-level response", () => {
    expect(normalizeOverpassResponse({ elements: "not-an-array" }, 125))
      .toMatchObject({ status: "failed", candidates: [], reason: "invalid-response" });
  });

  it("fails closed if the radius metadata is invalid", () => {
    expect(normalizeOverpassResponse({ elements: [] }, Number.NaN))
      .toMatchObject({ status: "failed", candidates: [], reason: "invalid-request" });
  });

  it("ignores valid non-AED elements returned by an unexpected server response", () => {
    const result = normalizeOverpassResponse({
      elements: [{ type: "node", id: 1, lat: 52, lon: 13, tags: { amenity: "bench" } }],
    }, 125);

    expect(result).toMatchObject({ status: "complete", candidates: [] });
  });

  it("does not accept malformed coordinates or non-string tag values as candidates", () => {
    const result = normalizeOverpassResponse({
      elements: [
        { type: "node", id: 12, lat: 92, lon: 13, tags: { emergency: "defibrillator" } },
        { type: "node", id: 13, lat: 52, lon: 13, tags: { emergency: 1 } },
      ],
    }, 125);

    expect(result.status).toBe("partial");
    expect(result.candidates).toEqual([]);
  });
});
