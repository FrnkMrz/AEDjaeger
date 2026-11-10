import { afterEach, describe, expect, it, vi } from "vitest";
import { isFreshCapture, isValidObservedDate, localCalendarDate, photoDateNeedsConfirmation } from "../src/domain/localDate";

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

describe("Abfrage des Beobachtungsdatums", () => {
  const today = "2026-11-10";

  it("fragt nicht, wenn das Foto das heutige Datum trägt", () => {
    expect(photoDateNeedsConfirmation(today, today, false)).toBe(false);
    expect(photoDateNeedsConfirmation(today, today, true)).toBe(false);
  });

  it("fragt nicht bei einem gerade eben aufgenommenen Foto ohne Datum", () => {
    expect(photoDateNeedsConfirmation(undefined, today, true)).toBe(false);
  });

  it("fragt bei einem Foto ohne Datum, das nicht gerade eben aufgenommen wurde", () => {
    expect(photoDateNeedsConfirmation(undefined, today, false)).toBe(true);
  });

  it("fragt immer, wenn das Foto einen anderen Tag nennt – auch wenn es frisch ist", () => {
    // Kamera-Uhr geht kurz vor Mitternacht vor und liefert schon das Datum von morgen.
    expect(photoDateNeedsConfirmation("2026-11-11", today, true)).toBe(true);
    // Foto von 23:58 Uhr, App um 00:01 Uhr geöffnet: gestern, aber noch „frisch“.
    expect(photoDateNeedsConfirmation("2026-11-09", today, true)).toBe(true);
    expect(photoDateNeedsConfirmation("2024-10-20", today, false)).toBe(true);
  });
});
