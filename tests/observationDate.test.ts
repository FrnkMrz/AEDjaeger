import { describe, expect, it } from "vitest";
import { isAcceptableObservationDate } from "../server/osm/observationDate";

const now = Date.UTC(2026, 9, 24, 12);

describe("OSM observation date validation", () => {
  it("accepts an explicitly confirmed historical calendar date", () => {
    expect(isAcceptableObservationDate("2024-06-12", now)).toBe(true);
  });

  it("rejects invalid and future dates while allowing a date in UTC+14", () => {
    expect(isAcceptableObservationDate("2026-02-30", now)).toBe(false);
    expect(isAcceptableObservationDate("2026-10-26", now)).toBe(false);
    expect(isAcceptableObservationDate("2026-10-25", now)).toBe(true);
  });
});
