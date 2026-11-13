import { describe, expect, it } from "vitest";
import { previewExistingAedCheck, previewNewAed } from "../src/domain/osmChangeProposal";

const nodeCandidate = {
  id: "node/123",
  osmType: "node" as const,
  tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2024-01-01", access: "customers" },
};

const newAedInput = {
  searchStatus: "complete" as const,
  assessmentKind: "new-entry-eligible" as const,
  position: { latitude: 52.52, longitude: 13.405 },
  searchCenter: { latitude: 52.52, longitude: 13.405 },
  coverageRadiusMeters: 200,
  nearbyRadiusMeters: 100,
  searchCandidates: [],
  positionConfirmed: true,
  observedOn: "2026-10-23",
};

describe("OSM change previews", () => {
  it("previews only check_date for a confirmed existing node", () => {
    expect(previewExistingAedCheck(nodeCandidate, true, "2026-10-23")).toEqual({
      kind: "ready",
      operation: "update",
      target: "node/123",
      changes: [{ key: "check_date", before: "2024-01-01", after: "2026-10-23" }],
    });
  });

  it("blocks an observation that is older than the check date already in OSM, and names that date", () => {
    // Ein Foto aus der Mediathek kann älter sein als der Eintrag in OSM. Ein älteres Datum darf ein neueres nie überschreiben.
    expect(previewExistingAedCheck(nodeCandidate, true, "2023-12-31")).toEqual({ kind: "blocked", reason: "newer-check-date-exists", existingDate: "2024-01-01" });
  });

  it("still allows the same day and any later day as the check date in OSM", () => {
    expect(previewExistingAedCheck(nodeCandidate, true, "2024-01-01")).toMatchObject({ kind: "ready" });
    expect(previewExistingAedCheck(nodeCandidate, true, "2026-10-23")).toMatchObject({ kind: "ready" });
  });

  it("ignores an existing check_date that is not a real date instead of blocking on it", () => {
    for (const check_date of ["gestern", "2024-13-45", "2024-1-1", ""]) {
      expect(previewExistingAedCheck({ ...nodeCandidate, tags: { ...nodeCandidate.tags, check_date } }, true, "2023-12-31")).toMatchObject({ kind: "ready" });
    }
  });

  it("blocks an existing update until this candidate is explicitly confirmed", () => {
    expect(previewExistingAedCheck(nodeCandidate, false, "2026-10-23")).toEqual({
      kind: "blocked", reason: "confirmation-required",
    });
  });

  it("rejects malformed OSM candidate identifiers", () => {
    expect(previewExistingAedCheck({ ...nodeCandidate, id: "node/123/extra" }, true, "2026-10-23")).toEqual({
      kind: "blocked", reason: "invalid-candidate",
    });
  });

  it("does not update way or relation candidates using their approximate centers", () => {
    for (const osmType of ["way", "relation"] as const) {
      expect(previewExistingAedCheck({ ...nodeCandidate, id: `${osmType}/456`, osmType }, true, "2026-10-23")).toEqual({
        kind: "blocked", reason: "unsupported-object",
      });
    }
  });

  it("creates a minimal new-node preview with only approved tags", () => {
    expect(previewNewAed({ ...newAedInput, locationDescription: "Eingang rechts" })).toEqual({
      kind: "ready",
      operation: "create-node",
      position: { latitude: 52.52, longitude: 13.405 },
      tags: {
        emergency: "defibrillator",
        check_date: "2026-10-23",
        "defibrillator:location": "Eingang rechts",
      },
      confirmedDifferentCandidateIds: [],
    });
  });

  it("allows a new preview after the person explicitly rejects every nearby candidate", () => {
    const candidate = {
      ...nodeCandidate,
      coordinateQuality: "exact" as const,
      position: { latitude: 52.52001, longitude: 13.40501 },
    };
    expect(previewNewAed({
      ...newAedInput,
      assessmentKind: "candidate-review",
      searchCandidates: [candidate],
      confirmedDifferentCandidateIds: [candidate.id],
    })).toMatchObject({
      kind: "ready",
      operation: "create-node",
      confirmedDifferentCandidateIds: [candidate.id],
    });
  });

  it("does not allow a new preview if any nearby candidate was not explicitly rejected", () => {
    const candidates = [
      { ...nodeCandidate, coordinateQuality: "exact" as const, position: { latitude: 52.52, longitude: 13.405 } },
      { ...nodeCandidate, id: "node/456", coordinateQuality: "exact" as const, position: { latitude: 52.52001, longitude: 13.40501 } },
    ];
    expect(previewNewAed({
      ...newAedInput,
      assessmentKind: "candidate-review",
      searchCandidates: candidates,
      confirmedDifferentCandidateIds: [candidates[0]!.id],
    })).toEqual({ kind: "blocked", reason: "search-found-candidate" });
  });

  it.each([
    { searchStatus: "partial" as const, assessmentKind: "new-entry-eligible" as const },
    { searchStatus: "failed" as const, assessmentKind: "new-entry-eligible" as const },
    { searchStatus: "complete" as const, assessmentKind: "search-incomplete" as const },
    { searchStatus: "complete" as const, assessmentKind: "candidate-review" as const },
  ])("blocks a new-node preview unless search and candidate assessment are clear", (state) => {
    expect(previewNewAed({ ...newAedInput, ...state })).toEqual({ kind: "blocked", reason: "search-not-clear" });
  });

  it("requires the person to confirm the map position", () => {
    expect(previewNewAed({ ...newAedInput, positionConfirmed: false })).toEqual({
      kind: "blocked", reason: "position-not-confirmed",
    });
  });

  it("blocks a proposed point beyond the completed search area", () => {
    expect(previewNewAed({
      ...newAedInput,
      position: { latitude: 48.137, longitude: 11.576 },
    })).toEqual({ kind: "blocked", reason: "position-outside-search" });
  });

  it("requires the whole nearby-candidate radius around the proposed point to be covered", () => {
    expect(previewNewAed({
      ...newAedInput,
      position: { latitude: 52.5213, longitude: 13.405 },
    })).toEqual({ kind: "blocked", reason: "position-outside-search" });
  });

  it("reassesses all search candidates around a moved confirmed point", () => {
    expect(previewNewAed({
      ...newAedInput,
      position: { latitude: 52.52072, longitude: 13.405 },
      searchCandidates: [{
        id: "node/999",
        osmType: "node",
        coordinateQuality: "exact",
        position: { latitude: 52.52135, longitude: 13.405 },
        tags: { emergency: "defibrillator" },
      }],
    })).toEqual({ kind: "blocked", reason: "search-found-candidate" });
  });

  it("keeps undisplayed search results in the duplicate check after the map point moves", () => {
    const displayed = {
      ...nodeCandidate,
      coordinateQuality: "exact" as const,
      position: { latitude: 52.52, longitude: 13.405 },
    };
    const undisplayed = {
      ...nodeCandidate,
      id: "node/456",
      coordinateQuality: "exact" as const,
      position: { latitude: 52.52, longitude: 13.4067 },
    };
    expect(previewNewAed({
      ...newAedInput,
      position: { latitude: 52.52, longitude: 13.406 },
      coverageRadiusMeters: 250,
      assessmentKind: "candidate-review",
      searchCandidates: [displayed, undisplayed],
      confirmedDifferentCandidateIds: [displayed.id],
    })).toEqual({ kind: "blocked", reason: "search-found-candidate" });
  });

  it("keeps approximate existing objects from being treated as an empty search", () => {
    expect(previewNewAed({
      ...newAedInput,
      searchCandidates: [{
        id: "way/456",
        osmType: "way",
        coordinateQuality: "approximate-center",
        position: { latitude: 52.521, longitude: 13.405 },
        tags: { emergency: "defibrillator" },
      }],
    })).toEqual({ kind: "blocked", reason: "search-found-candidate" });
  });

  it("rejects impossible dates, invalid coordinates and unsafe optional text", () => {
    expect(previewExistingAedCheck(nodeCandidate, true, "2026-02-30")).toEqual({ kind: "blocked", reason: "invalid-date" });
    expect(previewNewAed({ ...newAedInput, position: { latitude: 91, longitude: 13 } })).toEqual({
      kind: "blocked", reason: "invalid-position",
    });
    expect(previewNewAed({ ...newAedInput, locationDescription: "\nignored" })).toEqual({
      kind: "blocked", reason: "invalid-location-description",
    });
  });
});
