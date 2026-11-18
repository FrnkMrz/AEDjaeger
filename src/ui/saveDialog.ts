import type { SaveLogLine } from "../domain/saveLog";
import type { FlowMessageKey } from "../i18n/flowTranslations";
import { escapeHtml } from "./markup";

/**
 * Das Speicher-Fenster (Vorbild: das Upload-Fenster der Hydranten-App).
 *
 * Ablauf:
 *   1. Die Person tippt auf „Speichern“. Das Fenster öffnet sich sofort mit „Speichern …“ und einer ersten Zeile.
 *   2. Kommt die Antwort des Servers, erscheinen seine Schritte (Änderungssatz angelegt, hochgeladen, geschlossen).
 *   3. Am Ende: Haken und „Gespeichert“ mit Knoten- und Änderungssatz-Nummer und „Fertig“ – oder ein Ausrufezeichen
 *      mit der Fehlermeldung und „Schließen“.
 *
 * Warum ein eigenes <dialog> außerhalb von #app?
 *   Die App zeichnet #app bei jeder Zustandsänderung neu. Läge das Fenster dort, würde es dabei verschwinden.
 *   Als eigenes Element unter <body> bleibt es stehen, bis die Person es schließt. Der eigentliche Ablauf (Zustände,
 *   Wiederaufnahme, Doppelschutz) bleibt unverändert; das Fenster zeigt nur an, was passiert.
 *
 * Sicherheit:
 *   Alle Texte gehen durch escapeHtml. Zeilen vom Server sind vorher geprüft (src/domain/saveLog.ts) und enthalten nur
 *   Methode, Pfad und Statuscode, nie Tokens oder Fehlertexte von OSM.
 */

type Translate = (key: FlowMessageKey) => string;

/** Wie der Vorgang endet. Bestimmt Symbol, Überschrift und Knopf. */
export type SaveDialogOutcome = "complete" | "unchanged" | "uncertain" | "failed";

type Line = { text: string; technical?: string; level: "info" | "ok" | "error" };

export type SaveDialog = {
  /** Fügt die Schritte aus dem Server-Protokoll hinzu. */
  addServerLines(lines: readonly SaveLogLine[]): void;
  /** Fügt eine eigene Zeile hinzu (zum Beispiel „Keine gültige Antwort vom Server“). */
  addLine(text: string, level?: Line["level"]): void;
  /** Schließt den Vorgang ab: Ergebnis, Schlussmeldung und – bei Erfolg – die Nummern. */
  finish(result: {
    outcome: SaveDialogOutcome;
    message: string;
    nodeId?: string | null;
    changesetId?: string | null;
  }): void;
  /** Schließt das Fenster ohne Ergebnis (wenn der Vorgang inzwischen nicht mehr zur Anzeige passt). */
  dismiss(): void;
};

const DIALOG_ID = "save-dialog";

/**
 * Öffnet das Fenster für einen neuen Speichervorgang. Ein noch offenes altes Fenster wird ersetzt.
 * @param tv Übersetzungsfunktion der App
 * @param requestPath Pfad der eigenen Server-Route, erscheint als graue technische Zeile
 * @param onClose wird nach dem Schließen aufgerufen (die App setzt dann den Fokus auf den nächsten Knopf)
 */
export function openSaveDialog(tv: Translate, requestPath: string, onClose: () => void): SaveDialog {
  document.getElementById(DIALOG_ID)?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = DIALOG_ID;
  dialog.className = "save-dialog";
  dialog.setAttribute("aria-labelledby", "save-dialog-title");
  document.body.append(dialog);

  const lines: Line[] = [{ text: tv("saveLogRequest"), technical: `POST ${requestPath}`, level: "info" }];
  let finished: {
    outcome: SaveDialogOutcome;
    message: string;
    nodeId?: string | null;
    changesetId?: string | null;
  } | null = null;

  // Solange gespeichert wird, schließt die Escape-Taste das Fenster nicht: Die Person soll den Ausgang sehen.
  dialog.addEventListener("cancel", (event) => {
    if (!finished) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose();
  });

  /** Zeichnet den Inhalt neu. Wird nach jeder neuen Zeile und beim Abschluss aufgerufen. */
  function render(): void {
    const outcome = finished?.outcome;
    const success = outcome === "complete" || outcome === "unchanged";
    const icon = !finished
      ? `<span class="save-dialog-spinner" aria-hidden="true"></span>`
      : `<span class="save-dialog-icon ${success ? "is-success" : "is-error"}" aria-hidden="true">${success ? "✓" : "!"}</span>`;
    const title = !finished
      ? tv("saveDialogSendingTitle")
      : outcome === "complete"
        ? tv("saveDialogSavedTitle")
        : outcome === "unchanged"
          ? tv("saveDialogUnchangedTitle")
          : outcome === "uncertain"
            ? tv("saveDialogUncertainTitle")
            : tv("saveDialogFailedTitle");
    const logLines = lines
      .map(
        (line) =>
          `${line.technical ? `<div class="save-log-line is-technical">${escapeHtml(line.technical)}</div>` : ""}<div class="save-log-line is-${line.level}">${escapeHtml(line.text)}</div>`,
      )
      .join("");
    const ids =
      finished && success && (finished.nodeId || finished.changesetId)
        ? `<dl class="save-dialog-ids">${finished.nodeId ? `<div><dt>${tv("saveDialogNodeLabel")}</dt><dd>#${escapeHtml(finished.nodeId)}</dd></div>` : ""}${finished.changesetId ? `<div><dt>${tv("saveDialogChangesetLabel")}</dt><dd>#${escapeHtml(finished.changesetId)}</dd></div>` : ""}</dl>`
        : "";
    const button = finished
      ? `<form method="dialog"><button class="button ${success ? "button-primary" : "button-secondary"}" id="save-dialog-close">${tv(success ? "saveDialogDone" : "saveDialogClose")}</button></form>`
      : "";
    dialog.innerHTML = `<div class="save-dialog-content">${icon}<h2 id="save-dialog-title">${title}</h2><div class="save-log" role="log" aria-label="${escapeHtml(tv("saveDialogLogLabel"))}" tabindex="0">${logLines}</div>${ids}${button}</div>`;
    // Neueste Zeile sichtbar halten, wie bei einem laufenden Protokoll.
    const log = dialog.querySelector<HTMLElement>(".save-log");
    if (log) log.scrollTop = log.scrollHeight;
    if (finished) dialog.querySelector<HTMLButtonElement>("#save-dialog-close")?.focus();
  }

  render();
  // showModal sperrt die Seite dahinter, bis das Fenster zu ist. Fehlt es (sehr alte Browser), bleibt es sichtbar offen.
  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute("open", "");
  }

  return {
    addServerLines(serverLines) {
      for (const line of serverLines) {
        lines.push({
          text: line.ok ? tv(line.stepKey) : `${tv(line.stepKey)}: ${tv("saveLogStepFailed")}`,
          technical: line.technical,
          level: line.ok ? "info" : "error",
        });
      }
      render();
    },
    addLine(text, level = "info") {
      lines.push({ text, level });
      render();
    },
    finish(result) {
      finished = result;
      const success = result.outcome === "complete" || result.outcome === "unchanged";
      lines.push({ text: result.message, level: success ? "ok" : "error" });
      render();
    },
    dismiss() {
      if (dialog.open) dialog.close();
      else dialog.remove();
    },
  };
}
