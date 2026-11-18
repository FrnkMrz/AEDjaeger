import { isRecord } from "../http/requestGuards";

/**
 * Protokoll der OSM-Aufrufe eines Speichervorgangs (für das Speicher-Fenster in der App).
 *
 * Warum?
 *   Beim Tippen auf „Speichern“ öffnet die App ein Fenster, das Schritt für Schritt zeigt, was passiert ist:
 *   Änderungssatz angelegt, AED hochgeladen, Änderungssatz geschlossen. Die OSM-Aufrufe macht aber der Worker,
 *   nicht der Browser (der OSM-Token darf nie in den Browser). Darum schreibt der Worker mit, welche Aufrufe er an
 *   den OSM-Testserver geschickt hat, und hängt diese Liste als `osm_log` an seine Antwort.
 *
 * Was steht drin – und was nie?
 *   Je Aufruf nur drei Dinge: HTTP-Methode (GET/PUT/POST), Pfad und Statuscode der Antwort.
 *   - Der Pfad ohne Abfrageteil: Der Kartenausschnitt (`?bbox=…`) enthält den Standort und bleibt draußen.
 *   - Nur Pfade, die zur festen Liste der erlaubten Testserver-Pfade passen. Alles andere wird nicht protokolliert.
 *   - Nie Token, Kopfzeilen, Anfrage- oder Antwortinhalt. Fehlertexte von OSM erscheinen also nie in der App.
 *   Die App übersetzt die Einträge selbst in Klartext (sechs Sprachen); der Server liefert keinen Anzeigetext.
 *
 * Warum außen herum statt in jeder Route?
 *   Die Schreibrouten nehmen ihre `fetch`-Funktion schon als austauschbare Abhängigkeit an (für Tests). Wir geben
 *   ihnen eine mitschreibende Fassung. Die heikle Schreiblogik (Versionen, Wiederaufnahme, Doppelschutz) bleibt
 *   dadurch unverändert.
 */

/** Ein Protokolleintrag. `status` 0 heißt: keine Antwort (Netzfehler oder Abbruch). */
export type OSMApiLogEntry = { method: "GET" | "PUT" | "POST"; path: string; status: number };

/** Mehr Aufrufe macht ein einzelner Speichervorgang nie; die Grenze hält die Antwort klein. */
const MAX_ENTRIES = 20;

/** Dieselbe feste Pfadliste wie in developmentApi.ts. Nur solche Pfade landen im Protokoll. */
const ALLOWED_PATH =
  /^\/api\/0\.6\/(?:node\/[1-9]\d*\.json|map\.json|changeset\/(?:create|[1-9]\d*(?:\/(?:close|upload|download))?))$/u;

const ALLOWED_METHODS = new Set(["GET", "PUT", "POST"]);

/**
 * Baut eine `fetch`-Funktion, die jeden Aufruf unverändert weiterreicht und dabei Methode, Pfad und Status notiert.
 * Das Ergebnis und jeder Fehler gehen unverändert an den Aufrufer zurück; das Protokoll ändert nie den Ablauf.
 */
export function createOSMApiLog(fetcher: typeof fetch): { fetch: typeof fetch; entries: OSMApiLogEntry[] } {
  const entries: OSMApiLogEntry[] = [];

  /** Notiert einen Aufruf, aber nur, wenn Methode und Pfad zur festen Liste passen. */
  function record(input: RequestInfo | URL, init: RequestInit | undefined, status: number): void {
    if (entries.length >= MAX_ENTRIES) return;
    try {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      // Nur der Pfad, ohne `?bbox=…`: So steht der Standort nie im Protokoll.
      if (!ALLOWED_METHODS.has(method) || !ALLOWED_PATH.test(url.pathname)) return;
      entries.push({ method: method as OSMApiLogEntry["method"], path: url.pathname, status });
    } catch {
      // Unlesbare Adresse: nicht protokollieren. Der eigentliche Aufruf läuft trotzdem normal.
    }
  }

  const loggingFetch: typeof fetch = async (input, init) => {
    try {
      const response = await fetcher(input, init);
      record(input, init, response.status);
      return response;
    } catch (error) {
      record(input, init, 0);
      throw error;
    }
  };
  return { fetch: loggingFetch, entries };
}

type RouteHandler<Environment> = (
  request: Request,
  environment: Environment,
  dependencies?: { fetch?: typeof fetch },
) => Promise<Response>;

/** Größte JSON-Antwort, an die wir das Protokoll noch anhängen. Die Schreibrouten antworten mit wenigen Bytes. */
const MAX_JSON_BYTES = 4_096;

/**
 * Hängt das Protokoll als `osm_log` an die JSON-Antwort einer Schreibroute.
 * Statuscode und Kopfzeilen bleiben gleich. Ist die Antwort kein kleines JSON-Objekt, geht sie unverändert durch.
 */
export function withOSMApiLog<Environment>(
  handler: RouteHandler<Environment>,
  fetcher: typeof fetch = fetch,
): (request: Request, environment: Environment) => Promise<Response> {
  return async (request, environment) => {
    const log = createOSMApiLog(fetcher);
    const response = await handler(request, environment, { fetch: log.fetch });
    if (!response.headers.get("Content-Type")?.toLowerCase().includes("application/json")) return response;
    let payload: unknown;
    try {
      const text = await response.clone().text();
      if (text.length > MAX_JSON_BYTES) return response;
      payload = JSON.parse(text);
    } catch {
      return response;
    }
    if (!isRecord(payload)) return response;
    return new Response(JSON.stringify({ ...payload, osm_log: log.entries }), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
