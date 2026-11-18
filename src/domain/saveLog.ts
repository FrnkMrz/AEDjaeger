/**
 * Protokollzeilen für das Speicher-Fenster.
 *
 * Der Worker hängt an seine Antwort ein kurzes Protokoll seiner OSM-Aufrufe (`osm_log`, siehe server/osm/osmApiLog.ts):
 * je Aufruf Methode, Pfad und Statuscode. Diese Datei prüft das Protokoll (es kommt über das Netz, also nicht blind
 * vertrauen) und macht daraus Zeilen mit einem Klartext-Schlüssel und einer technischen Zeile.
 *
 * Getrennt von der Oberfläche, damit die Regeln ohne Browser testbar sind (tests/saveLog.test.ts).
 */

/** Ein geprüfter Protokolleintrag vom Worker. `status` 0 heißt: keine Antwort von OSM. */
export type OSMApiLogEntry = { method: "GET" | "PUT" | "POST"; path: string; status: number };

/** Welche Klartext-Zeile zu einem OSM-Aufruf gehört. Die Texte selbst stehen in den Übersetzungen. */
export type SaveLogStepKey =
  | "saveLogMapRead"
  | "saveLogNodeRead"
  | "saveLogChangesetCreated"
  | "saveLogUploaded"
  | "saveLogChangesetClosed"
  | "saveLogChangesetStatus"
  | "saveLogChangesetDownload";

/** Eine Zeile im Fenster: `technical` ist die leise graue Zeile, `stepKey` der Klartext, `ok` färbt die Zeile. */
export type SaveLogLine = { technical: string; stepKey: SaveLogStepKey; ok: boolean };

/** Dieselbe feste Pfadliste wie im Worker. Unbekannte Pfade zeigt die App nicht an. */
const ALLOWED_PATH =
  /^\/api\/0\.6\/(?:node\/[1-9]\d*\.json|map\.json|changeset\/(?:create|[1-9]\d*(?:\/(?:close|upload|download))?))$/u;

/** Höchstens so viele Einträge werden gezeigt; mehr liefert ein echter Speichervorgang nie. */
const MAX_ENTRIES = 20;

/**
 * Liest `osm_log` aus der Server-Antwort. Alles, was nicht genau passt, fällt still weg:
 * Ein kaputtes Protokoll darf das Speichern oder die Erfolgsmeldung nie stören.
 */
export function parseOSMApiLog(payload: unknown): OSMApiLogEntry[] {
  if (typeof payload !== "object" || payload === null) return [];
  const raw = (payload as { osm_log?: unknown }).osm_log;
  if (!Array.isArray(raw)) return [];
  const entries: OSMApiLogEntry[] = [];
  for (const item of raw.slice(0, MAX_ENTRIES)) {
    if (typeof item !== "object" || item === null) continue;
    const { method, path, status } = item as Record<string, unknown>;
    if (method !== "GET" && method !== "PUT" && method !== "POST") continue;
    if (typeof path !== "string" || !ALLOWED_PATH.test(path)) continue;
    if (!Number.isInteger(status) || (status as number) < 0 || (status as number) > 599) continue;
    entries.push({ method, path, status: status as number });
  }
  return entries;
}

/** Ordnet einem OSM-Aufruf seinen Klartext zu. Gibt null zurück, wenn die Kombination nicht vorgesehen ist. */
function stepKeyFor(entry: OSMApiLogEntry): SaveLogStepKey | null {
  const { method, path } = entry;
  if (method === "GET" && path === "/api/0.6/map.json") return "saveLogMapRead";
  if (method === "GET" && /^\/api\/0\.6\/node\/\d+\.json$/u.test(path)) return "saveLogNodeRead";
  if (method === "PUT" && path === "/api/0.6/changeset/create") return "saveLogChangesetCreated";
  if (method === "POST" && /\/upload$/u.test(path)) return "saveLogUploaded";
  if (method === "PUT" && /\/close$/u.test(path)) return "saveLogChangesetClosed";
  if (method === "GET" && /\/download$/u.test(path)) return "saveLogChangesetDownload";
  if (method === "GET" && /^\/api\/0\.6\/changeset\/\d+$/u.test(path)) return "saveLogChangesetStatus";
  return null;
}

/**
 * Macht aus den Einträgen die Zeilen fürs Fenster.
 * Die technische Zeile zeigt Methode, Pfad und Status („PUT /api/0.6/changeset/create → 200“), bei fehlender
 * Antwort „→ –“. Als erfolgreich gilt ein Aufruf mit Status 200 bis 299.
 */
export function buildSaveLogLines(entries: readonly OSMApiLogEntry[]): SaveLogLine[] {
  const lines: SaveLogLine[] = [];
  for (const entry of entries) {
    const stepKey = stepKeyFor(entry);
    if (!stepKey) continue;
    const statusText = entry.status === 0 ? "–" : String(entry.status);
    lines.push({
      technical: `${entry.method} ${entry.path} → ${statusText}`,
      stepKey,
      ok: entry.status >= 200 && entry.status < 300,
    });
  }
  return lines;
}

/** Nummern für den Kasten unter dem Protokoll. Nur echte OSM-Nummern (1 bis 16 Ziffern) werden gezeigt. */
export function readSavedIds(
  payload: unknown,
  target: string | undefined,
): { nodeId: string | null; changesetId: string | null } {
  const isId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,15}$/u.test(value);
  const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  // Neuanlage: Die Knotennummer kommt vom Server. Prüfdatum: Sie steht im Ziel („node/123“), das die App kennt.
  const targetId = target?.startsWith("node/") ? target.slice("node/".length) : undefined;
  const nodeId = isId(record.node_id) ? record.node_id : isId(targetId) ? targetId : null;
  return { nodeId, changesetId: isId(record.changeset_id) ? record.changeset_id : null };
}
