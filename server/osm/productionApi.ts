import { fetchWithoutRedirects } from "../http/fetchWithoutRedirects";
import { APP_VERSION } from "../version";

/**
 * Lesender Zugang zur öffentlichen OpenStreetMap-API (Etappe Q1, Entscheidung vom 26.11.2026).
 *
 * Warum es diese Datei gibt: Das PMTiles-Archiv deckt nur Deutschland, Österreich, die Schweiz, Luxemburg und
 * Liechtenstein ab und kann bis zu 5 Tage alt sein. Bevor die App einen Treffer bestätigen lässt oder eine Neuanlage
 * anbietet, braucht sie deshalb frische Daten. Wie beim Hydrantenjäger holt der Worker sie direkt von OSM.
 *
 * Sicherheitsregeln:
 *  - Der Host ist fest eingebaut. Kein Teil der Adresse kommt aus dem Browser.
 *  - Nur EIN Aufruf ist erlaubt: `GET /api/0.6/map.json` für einen kleinen Ausschnitt. Diese Datei kann nichts schreiben.
 *    Ein Schreibzugang kommt erst mit einer späteren Etappe und hinter eigenen Schaltern.
 *  - Es geht kein Token mit: Die Kartenabfrage ist öffentlich. So kann ein Fehler hier nie ein Konto betreffen.
 *  - Weiterleitungen werden abgelehnt (fetchWithoutRedirects).
 *  - Ein eindeutiger User-Agent nennt die App, wie es die Nutzungsregeln der OSM-API verlangen.
 */
export const OSM_PRODUCTION_API_ORIGIN = "https://api.openstreetmap.org";

/**
 * Größte erlaubte Fläche in Quadratgrad. Die OSM-API erlaubt 0,25; die Suche braucht bei 100 m Radius nur etwa
 * 0,000004. Die enge Grenze verhindert, dass ein Programmfehler große Ausschnitte von OSM lädt.
 */
const MAX_BBOX_AREA_SQUARE_DEGREES = 0.0005;

export interface MapBoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Baut die Adresse der Kartenabfrage. Wirft bei einem ungültigen oder zu großen Ausschnitt, bevor etwas gesendet wird. */
export function buildOSMProductionMapUrl(bbox: MapBoundingBox): URL {
  const { west, south, east, north } = bbox;
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north ||
    (east - west) * (north - south) > MAX_BBOX_AREA_SQUARE_DEGREES
  ) {
    throw new Error("Ungültiger Kartenausschnitt für die OSM-API.");
  }
  const url = new URL("/api/0.6/map.json", OSM_PRODUCTION_API_ORIGIN);
  url.searchParams.set("bbox", `${west},${south},${east},${north}`);
  return url;
}

/** Fragt den kleinen Ausschnitt ab. Die Antwort prüft der Aufrufer (Status, Größe, Inhalt). */
export async function requestOSMProductionMap(
  bbox: MapBoundingBox,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  return fetchWithoutRedirects(
    buildOSMProductionMapUrl(bbox),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": `AEDjaeger/${APP_VERSION} (+https://github.com/FrnkMrz/AEDjaeger)`,
      },
      cache: "no-store",
      signal,
    },
    fetcher,
  );
}
