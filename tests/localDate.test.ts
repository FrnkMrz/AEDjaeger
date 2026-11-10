import { afterEach, describe, expect, it, vi } from "vitest";
import { isFreshCapture, isValidObservedDate, localCalendarDate } from "../src/domain/localDate";

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

describe("gerade eben aufgenommene Fotos (5-Minuten-Regel)", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");

  it("erkennt ein Foto von vor 4 Minuten 59 Sekunden als frisch", () => {
    expect(isFreshCapture(now - (4 * 60 + 59) * 1_000, now)).toBe(true);
    expect(isFreshCapture(now, now)).toBe(true);
  });

  it("behandelt ein Foto, das älter als 5 Minuten ist, nicht als frisch", () => {
    expect(isFreshCapture(now - 5 * 60_000 - 1, now)).toBe(false);
    expect(isFreshCapture(now - 24 * 60 * 60_000, now)).toBe(false);
  });

  it("toleriert eine leicht vorgehende Kamera-Uhr, aber keine Zeit weit in der Zukunft", () => {
    expect(isFreshCapture(now + 30_000, now)).toBe(true);
    expect(isFreshCapture(now + 61_000, now)).toBe(false);
  });

  it("gilt ohne oder mit ungültiger Zeitangabe nie als frisch", () => {
    expect(isFreshCapture(undefined, now)).toBe(false);
    expect(isFreshCapture(Number.NaN, now)).toBe(false);
  });
});
