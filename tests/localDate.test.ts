import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidObservedDate, localCalendarDate } from "../src/domain/localDate";

describe("local calendar dates", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the local date around midnight in a non-UTC timezone", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const justAfterUtcMidnight = new Date("2026-11-09T00:30:00.000Z");

    expect(justAfterUtcMidnight.toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(localCalendarDate(justAfterUtcMidnight)).toBe("2026-11-08");
    expect(isValidObservedDate("2026-11-08", justAfterUtcMidnight)).toBe(true);
    expect(isValidObservedDate("2026-11-09", justAfterUtcMidnight)).toBe(false);
  });

  it("rejects invalid calendar dates and accepts past local observation dates", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const now = new Date("2026-11-09T00:30:00.000Z");

    expect(isValidObservedDate("2026-02-30", now)).toBe(false);
    expect(isValidObservedDate("2026-11-07", now)).toBe(true);
  });
});
