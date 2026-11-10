/**
 * Erkennt, dass nach dem Start der App eine neuere Version veröffentlicht wurde.
 *
 * Warum nicht einfach den Service Worker fragen?
 *   Jeder Build registriert einen eigenen Worker unter /sw.js?revision=<Build>. Ein Aufruf von
 *   registration.update() holt deshalb immer dieselbe, alte Adresse erneut und findet nie etwas
 *   Neues. Eine laufende App kann eine neuere Version also nur über eine eigene Frage erkennen.
 *
 * Wie es funktioniert:
 *   Der Build schreibt /version.json mit der Revision dieses Builds. Die App kennt ihre eigene
 *   Revision (zur Build-Zeit eingebettet) und vergleicht sie mit dem, was gerade veröffentlicht ist.
 *   Weicht sie ab, ruft der Wächter genau einmal `onUpdate` auf. Die App zeigt dann ein Banner;
 *   neu geladen wird nur, wenn die Person es ausdrücklich möchte, weil ein Neuladen das aktuelle
 *   Foto und den Entwurf verwirft.
 *
 * Fehler (offline, Zeitüberschreitung, kaputte Antwort) zählen als „nichts Neues erkannt“ und
 * erzeugen nie einen falschen Hinweis. Die Abfrage enthält keine Nutzer- oder Foto-Daten.
 */

const VERSION_URL = "/version.json";
// Gleiche Form wie im Build (Date.now() in Basis 36). Alles andere wird nicht als Revision akzeptiert.
const REVISION_PATTERN = /^[a-z0-9]{4,32}$/u;
const REQUEST_TIMEOUT_MS = 8_000;

/** Wie oft eine dauerhaft geöffnete App nachfragt: alle 30 Minuten. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1_000;

/** Liest die veröffentlichte Revision oder gibt null zurück, wenn sie sich nicht sicher lesen lässt. */
export async function fetchDeployedRevision(fetcher: typeof fetch = fetch): Promise<string | null> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // no-store: Weder Browser noch Zwischenspeicher dürfen eine alte Antwort liefern.
    const response = await fetcher(VERSION_URL, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;
    const revision = (payload as Record<string, unknown>).revision;
    return typeof revision === "string" && REVISION_PATTERN.test(revision) ? revision : null;
  } catch {
    // Offline, Zeitüberschreitung oder keine gültige JSON-Antwort: nichts Neues erkannt.
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

/** Neuer, wenn eine gültige Revision veröffentlicht ist und sie von der laufenden abweicht. */
export function isNewerVersionDeployed(runningRevision: string, deployedRevision: string | null): boolean {
  return deployedRevision !== null && deployedRevision !== runningRevision;
}

type EventSource = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export type UpdateWatcherOptions = {
  /** Revision, mit der diese App gebaut wurde. */
  runningRevision: string;
  /** Wird höchstens einmal aufgerufen, sobald eine neuere Version erkannt wurde. */
  onUpdate: () => void;
  fetcher?: typeof fetch;
  intervalMs?: number;
  /** Nur für Tests austauschbar; im Browser gelten document und window. */
  documentRef?: EventSource & { visibilityState: string };
  windowRef?: EventSource;
};

/**
 * Startet die Prüfung. Sie läuft sofort, beim Zurückkehren in die App, bei wiederhergestellter
 * Verbindung und in festen Abständen. Der Rückgabewert beendet den Wächter.
 */
export function startUpdateWatcher(options: UpdateWatcherOptions): () => void {
  const { runningRevision, onUpdate } = options;
  // Ohne gültige eigene Revision lässt sich nichts vergleichen; dann lieber nichts melden.
  if (!REVISION_PATTERN.test(runningRevision)) return () => undefined;

  const fetcher = options.fetcher ?? fetch;
  const documentRef = options.documentRef ?? document;
  const windowRef = options.windowRef ?? window;
  let stopped = false;
  let checking = false;

  const onVisibilityChange = (): void => {
    // Nur beim Zurückkehren in die App prüfen, nicht beim Wegwischen.
    if (documentRef.visibilityState === "visible") void check();
  };
  const onOnline = (): void => void check();

  async function check(): Promise<void> {
    // Eine laufende Abfrage genügt; mehrere Auslöser dürfen sich nicht stapeln.
    if (stopped || checking) return;
    checking = true;
    try {
      const deployed = await fetchDeployedRevision(fetcher);
      if (!stopped && isNewerVersionDeployed(runningRevision, deployed)) {
        stop();
        onUpdate();
      }
    } finally {
      checking = false;
    }
  }

  const timer = globalThis.setInterval(() => void check(), options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS);
  function stop(): void {
    stopped = true;
    globalThis.clearInterval(timer);
    documentRef.removeEventListener("visibilitychange", onVisibilityChange);
    windowRef.removeEventListener("online", onOnline);
  }

  documentRef.addEventListener("visibilitychange", onVisibilityChange);
  windowRef.addEventListener("online", onOnline);
  void check();
  return stop;
}
