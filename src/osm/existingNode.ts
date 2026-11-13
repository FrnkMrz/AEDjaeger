import { isDetailKey } from "../contracts/aedDetails";

/**
 * Frischer Stand eines bestehenden AED aus OpenStreetMap (nur die Detail-Schlüssel und das Prüfdatum).
 * Der Browser holt ihn, bevor die Person Angaben ergänzt: Das Archiv der Umgebungssuche kann bis zu fünf Tage alt
 * sein, und für das spätere Speichern braucht der Server die Objektversion, die die Person gesehen hat.
 */
export interface ExistingNode {
  /** Kennung wie "node/123". */
  id: string;
  /** Objektversion in OSM. Sie geht beim Speichern mit, damit der Server Änderungen von anderen erkennt. */
  version: number;
  tags: Readonly<Record<string, string>>;
}

export type ExistingNodeErrorCode = "authentication_required" | "node_unavailable" | "service_unavailable" | "invalid_response";

/** Fehler beim Laden. Der feste Code genügt der Oberfläche für eine verständliche Meldung. */
export class ExistingNodeError extends Error {
  constructor(readonly code: ExistingNodeErrorCode) {
    super(code);
    this.name = "ExistingNodeError";
  }
}

/**
 * Lädt den aktuellen Stand eines AED über den eigenen Server (nie direkt von OSM).
 *
 * Die Antwort ist eine Eingabe an einer Vertrauensgrenze: Sie wird streng geprüft (Kennung stimmt, Version ist eine
 * positive ganze Zahl, nur bekannte Schlüssel mit kurzen Texten). Alles andere ergibt `invalid_response`.
 *
 * @param id       Kennung des Objekts, zum Beispiel "node/123".
 * @param fetcher  Austauschbar für Tests.
 */
export async function requestExistingNode(id: string, fetcher: typeof fetch = fetch): Promise<ExistingNode> {
  let response: Response;
  try {
    response = await fetcher(`/api/osm/development/node?id=${encodeURIComponent(id)}`, {
      method: "GET", credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store",
    });
  } catch {
    throw new ExistingNodeError("service_unavailable");
  }
  if (response.status === 401 || response.status === 403) throw new ExistingNodeError("authentication_required");
  if (response.status === 404) throw new ExistingNodeError("node_unavailable");
  if (!response.ok) throw new ExistingNodeError("service_unavailable");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ExistingNodeError("invalid_response");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new ExistingNodeError("invalid_response");
  const body = payload as Record<string, unknown>;
  if (body.status !== "ok" || body.id !== id || typeof body.version !== "number" || !Number.isSafeInteger(body.version) || body.version <= 0
    || typeof body.tags !== "object" || body.tags === null || Array.isArray(body.tags)) {
    throw new ExistingNodeError("invalid_response");
  }
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(body.tags as Record<string, unknown>)) {
    if ((!isDetailKey(key) && key !== "check_date") || typeof value !== "string" || value.length > 255) throw new ExistingNodeError("invalid_response");
    tags[key] = value;
  }
  return { id, version: body.version, tags };
}
