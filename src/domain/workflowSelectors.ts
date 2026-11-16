import type { FlowState } from "./workflow";

export function getPhotoUrl(current: FlowState): string | undefined {
  return "photoUrl" in current ? current.photoUrl : undefined;
}

/** A search or write whose outcome is unresolved must not be interrupted by a reload. */
export function hasUnresolvedSave(current: FlowState): boolean {
  return (
    current.kind === "candidate-searching" ||
    (current.kind === "new-aed-preview" &&
      (current.writeStatus === "sending" || current.writeStatus === "uncertain")) ||
    (current.kind === "osm-preview" && (current.writeStatus === "sending" || current.writeStatus === "uncertain"))
  );
}

export function hasActivePhotoDraft(current: FlowState): boolean {
  return current.kind !== "ready";
}

/**
 * Sagt, ob der Bereich „neuen AED eintragen“ geöffnet werden darf.
 *
 * Eine Neuanlage braucht zwei getrennte Bestätigungen. Diese Prüfung deckt die erste ab:
 * - Suche ohne Treffer: „Hier fehlt ein AED – neu eintragen“ wurde gewählt.
 * - Suche mit Treffern: „Keiner davon – neuen AED eintragen“ wurde bestätigt.
 * Die zweite Bestätigung erfolgt in der Vorschau direkt vor dem Speichern. Eine unvollständige
 * oder fehlgeschlagene Suche öffnet den Bereich nie.
 */
export function isNewEntryPanelOpen(current: FlowState): boolean {
  if (current.kind !== "candidate-result" || current.search.status !== "complete") return false;
  if (current.assessment.kind === "new-entry-eligible") return current.newEntryRequested === true;
  return current.assessment.kind === "candidate-review" && current.noneOfTheseConfirmed === true;
}
