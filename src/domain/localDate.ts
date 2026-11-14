/** Format a date using the device's local calendar, which is what EXIF dates and date inputs use. */
export function localCalendarDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Validate a date-only value without converting it through the device timezone. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Format a date-only OSM value without shifting its day through the device timezone. */
export function formatCalendarDate(value: string, language: string): string {
  if (!isCalendarDate(value)) return value;
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
  } catch {
    // Keep the source value visible if a browser does not support this locale.
    return value;
  }
}

/** Observation dates may be earlier than today, but cannot be in the device's local future. */
export function isValidObservedDate(value: string, now: Date = new Date()): boolean {
  return isCalendarDate(value) && value <= localCalendarDate(now);
}

/** Ein Foto gilt als „gerade eben aufgenommen“, wenn es höchstens so alt ist (5 Minuten). */
export const FRESH_CAPTURE_WINDOW_MS = 5 * 60_000;
/** Kleine Toleranz, falls die Kamera-Uhr der Geräte-Uhr minimal vorausgeht. */
const FRESH_CAPTURE_FUTURE_TOLERANCE_MS = 60_000;

/**
 * Prüft, ob ein Foto in den letzten 5 Minuten aufgenommen wurde.
 *
 * Wozu: Bei einem gerade eben aufgenommenen Foto ist klar, dass die Person den AED heute
 * vor Ort gesehen hat. Dann fragt die App nicht mehr nach dem Beobachtungsdatum.
 * Ältere Fotos, Fotos ohne verlässliche Zeitangabe und Zeitangaben aus der Zukunft gelten
 * nicht als frisch – dort bleibt die ausdrückliche Datumsbestätigung bestehen.
 *
 * @param capturedAtMs Aufnahmezeitpunkt in Millisekunden (wie Date.getTime()).
 * @param nowMs        Aktuelle Zeit; nur für Tests überschreibbar.
 */
export function isFreshCapture(capturedAtMs: number | undefined, nowMs: number = Date.now()): boolean {
  if (capturedAtMs === undefined || !Number.isFinite(capturedAtMs)) return false;
  const ageMs = nowMs - capturedAtMs;
  return ageMs <= FRESH_CAPTURE_WINDOW_MS && ageMs >= -FRESH_CAPTURE_FUTURE_TOLERANCE_MS;
}

/**
 * Entscheidet, ob die Person das Beobachtungsdatum ausdrücklich bestätigen muss.
 *
 * Regeln, von oben nach unten:
 *  1. Das Foto nennt selbst einen Kalendertag (EXIF):
 *     - derselbe Tag wie heute → keine Abfrage.
 *     - ein anderer Tag → IMMER Abfrage, auch wenn das Foto „gerade eben“ entstanden ist.
 *       Grund: Kurz vor Mitternacht kann eine leicht vorgehende Kamera-Uhr schon das Datum von
 *       morgen liefern. Ohne Abfrage käme ein Prüfdatum in der Zukunft in den OSM-Vorschlag.
 *  2. Das Foto nennt keinen Kalendertag:
 *     - gerade eben aufgenommen (5-Minuten-Regel) → keine Abfrage, es gilt das heutige Datum.
 *     - sonst → Abfrage.
 *
 * @param photoDate       Kalendertag aus dem Foto (JJJJ-MM-TT) oder undefined, wenn keiner vorliegt.
 * @param today           Heutiger Kalendertag des Geräts (JJJJ-MM-TT).
 * @param capturedJustNow Ergebnis von isFreshCapture für dieses Foto.
 */
export function photoDateNeedsConfirmation(photoDate: string | undefined, today: string, capturedJustNow: boolean): boolean {
  if (photoDate !== undefined) return photoDate !== today;
  return !capturedJustNow;
}
