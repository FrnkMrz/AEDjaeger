/**
 * Changeset-Kommentare für das echte OSM (Entscheidung vom 26.11.2026): zweisprachig, Deutsch und Englisch.
 *
 * Browser und Worker nutzen dieselbe Datei. So zeigt die App vor dem Speichern genau den Text, den der Worker danach an
 * OSM schickt. Die Person sieht ihn in der Vorschau, bevor sie bestätigt. Der Kommentar enthält bewusst keinen Ort,
 * keine Koordinaten, keinen Namen und keine Konto- oder Gerätedaten.
 */
export const PRODUCTION_CHANGESET_COMMENTS = {
  /** Schnellweg „noch vorhanden“: nur das Prüfdatum. */
  checkDate: "AED vor Ort als vorhanden bestätigt / AED confirmed present on site (AEDjaeger)",
  /** Detailweg „nur Fehlendes ergänzen“ (Etappe Q4): Prüfdatum plus neue Angaben, nichts wird ersetzt. */
  details: "AED vor Ort geprüft, fehlende Angaben ergänzt / AED checked on site, missing details added (AEDjaeger)",
  /** Korrekturen (Etappe Q6): bestehende Werte ersetzt, eventuell zusätzlich Fehlendes ergänzt. */
  corrections:
    "AED vor Ort geprüft, Angaben ergänzt und korrigiert / AED checked on site, details added and corrected (AEDjaeger)",
  /** Neuanlage (Etappe Q5): ein AED, den es in OSM noch nicht gab. */
  create: "AED vor Ort neu eingetragen / New AED mapped on site (AEDjaeger)",
} as const;

/** Sprachen der App. Nur diese Werte gehen als `locale` an das Changeset. */
export const CHANGESET_LOCALES = ["de", "en", "pl", "ja", "fr", "es"] as const;
export type ChangesetLocale = (typeof CHANGESET_LOCALES)[number];

export function isChangesetLocale(value: unknown): value is ChangesetLocale {
  return typeof value === "string" && (CHANGESET_LOCALES as readonly string[]).includes(value);
}
