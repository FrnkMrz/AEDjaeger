/**
 * Angaben zum laufenden Build für den Info-Dialog.
 *
 * Wozu? Auf dem Handy lässt sich sonst nicht sagen, ob die App schon die neueste Version zeigt: Eine installierte
 * PWA lädt eine neue Version erst nach dem Neustart. Steht die Versionsnummer im Info-Dialog, genügt ein Blick.
 *
 * Die Revision ist die Build-Zeit in Millisekunden, als Zahl zur Basis 36 geschrieben (siehe vite.config.ts,
 * `Date.now().toString(36)`). Daraus lässt sich die Uhrzeit des Builds zurückrechnen. Die Revision ist keine
 * Git-Commit-Nummer; sie sagt "gebaut am ...", nicht "Stand von Commit ...".
 */

// Gleiche Form wie in updateCheck.ts: nur Kleinbuchstaben und Ziffern, 4 bis 32 Zeichen.
const REVISION_PATTERN = /^[a-z0-9]{4,32}$/u;
// Plausibler Bereich: 1.1.2020 bis 1.1.2100. Alles andere ist keine Build-Zeit und wird nicht angezeigt.
const EARLIEST_BUILD_MS = Date.UTC(2020, 0, 1);
const LATEST_BUILD_MS = Date.UTC(2100, 0, 1);

/** Rechnet die Revision in die Build-Zeit zurück. Gibt null zurück, wenn sie nicht wie eine Build-Zeit aussieht. */
export function buildTimeFromRevision(revision: string): Date | null {
  if (!REVISION_PATTERN.test(revision)) return null;
  const milliseconds = Number.parseInt(revision, 36);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < EARLIEST_BUILD_MS || milliseconds >= LATEST_BUILD_MS) return null;
  return new Date(milliseconds);
}

/**
 * Formatiert die Build-Zeit in der Sprache der App und in der Zeitzone des Geräts, zum Beispiel "13.11.2026, 16:08".
 * Gibt einen leeren Text zurück, wenn sich aus der Revision keine Zeit ableiten lässt.
 */
export function formatBuildTime(revision: string, language: string): string {
  const time = buildTimeFromRevision(revision);
  if (!time) return "";
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(time);
  } catch {
    // Unbekannter Sprachcode oder fehlende Intl-Unterstützung: lieber keine Zeit als eine falsche.
    return "";
  }
}
