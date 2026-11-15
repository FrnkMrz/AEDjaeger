/**
 * Kleine, zustandslose Bausteine für HTML-Markup.
 *
 * Diese Funktionen hängen weder am App-Zustand noch am DOM. Sie bleiben in einem
 * eigenen UI-Modul, damit spätere Ansichts-Module dieselbe sichere HTML-Escapierung
 * verwenden können, statt OSM- oder Formulardaten ungefiltert einzusetzen.
 */

/** Bezeichnung eines AED für die Anzeige: Leere Namen bekommen einen lesbaren Ersatz. */
export function displayCandidateLabel(label: string, unnamedLabel: string): string {
  return label.trim() === "" ? unnamedLabel : label;
}

/** Escaped dynamische Werte, bevor sie in ein HTML-Template gelangen. */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

export function icon(kind: "camera" | "search" | "check"): string {
  const paths = {
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.5 15.5 4 4"/>',
    check: '<path d="m5 12 4.3 4.3L19 6.8"/>',
  };
  return `<svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}

export function defibrillatorMark(path: string): string {
  return `<svg class="device-mark" viewBox="0 0 15 15" fill="currentColor" aria-hidden="true"><path d="${path}" /></svg>`;
}
