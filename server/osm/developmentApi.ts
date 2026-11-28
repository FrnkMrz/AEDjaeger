import { APP_VERSION } from "../version";
import { fetchWithoutRedirects } from "../http/fetchWithoutRedirects";

/**
 * OSM write tests must be isolated from the production editing API.
 *
 * This first boundary deliberately exposes only the public development server.
 * A future writer must call this helper instead of accepting an API URL from
 * browser input or an unrestricted Worker variable.
 */
export const OSM_DEVELOPMENT_SERVER_ORIGIN = "https://master.apis.dev.openstreetmap.org";
/** Fester Host des echten OSM (Etappe Q3). Kein Teil davon kommt je aus dem Browser. */
export const OSM_PRODUCTION_SERVER_ORIGIN = "https://api.openstreetmap.org";
export type OSMApiEnvironment = "development" | "production";

/** Nur für den Testserver: wirft bei jeder anderen Umgebung (Schutz für alle Wege, die nur dort schreiben dürfen). */
export function buildOSMDevelopmentApiUrl(environment: unknown, apiPath: string): URL {
  if (environment !== "development") {
    throw new Error("OSM-Schreibzugriffe sind ausschließlich für die Entwicklungsinstanz freigegeben.");
  }
  return buildOSMApiUrl(environment, apiPath);
}

/**
 * Baut die Adresse für einen der wenigen erlaubten OSM-API-Aufrufe, am Testserver oder am echten OSM.
 * Die Umgebung bestimmt der Server aus der Sitzung, nie der Browser. Beide Hosts sind fest eingebaut.
 */
export function buildOSMApiUrl(environment: unknown, apiPath: string): URL {
  if (environment !== "development" && environment !== "production") {
    throw new Error("Unbekannte OSM-Umgebung.");
  }

  // Keep the API surface to the exact calls used by the test writer. In
  // particular, no caller can turn an OSM token into a general-purpose proxy.
  if (
    typeof apiPath !== "string" ||
    !/^\/api\/0\.6\/(?:node\/[1-9]\d*\.json|map\.json|changeset\/(?:create|[1-9]\d*(?:\/(?:close|upload|download))?))$/u.test(
      apiPath,
    )
  ) {
    throw new Error("Ungültiger Pfad zur OSM-Entwicklungs-API.");
  }

  // The fixed base prevents callers from redirecting a token to another host or to a host supplied by a request.
  // A development token never goes to production and vice versa: the environment comes from the session.
  // Never follow redirects when calling it.
  return new URL(apiPath, environment === "production" ? OSM_PRODUCTION_SERVER_ORIGIN : OSM_DEVELOPMENT_SERVER_ORIGIN);
}

/** Calls a small, fixed set of development API endpoints and never follows redirects. */
export async function requestOSMDevelopmentApi(
  environment: unknown,
  apiPath: string,
  accessToken: string,
  input: OSMApiRequestInput,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  // Wirft bei jeder anderen Umgebung als dem Testserver, bevor etwas gesendet wird.
  buildOSMDevelopmentApiUrl(environment, apiPath);
  return requestOSMApi(environment, apiPath, accessToken, input, fetcher);
}

type OSMApiRequestInput = {
  method: "GET" | "PUT" | "POST";
  body?: string;
  contentType?: "application/json" | "text/xml; charset=utf-8";
  bbox?: { west: number; south: number; east: number; north: number };
  signal?: AbortSignal;
};

/** Ruft einen der festen API-Pfade am Testserver oder am echten OSM auf, mit Token, ohne Weiterleitungen. */
export async function requestOSMApi(
  environment: unknown,
  apiPath: string,
  accessToken: string,
  input: {
    method: "GET" | "PUT" | "POST";
    body?: string;
    contentType?: "application/json" | "text/xml; charset=utf-8";
    bbox?: { west: number; south: number; east: number; north: number };
    signal?: AbortSignal;
  },
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > 8_192 ||
    /[\r\n]/u.test(accessToken)
  ) {
    throw new Error("Ungültiger OSM-Testzugriff.");
  }
  const url = buildOSMApiUrl(environment, apiPath);
  if (input.bbox !== undefined) {
    const { west, south, east, north } = input.bbox;
    if (
      apiPath !== "/api/0.6/map.json" ||
      ![west, south, east, north].every(Number.isFinite) ||
      west < -180 ||
      east > 180 ||
      south < -90 ||
      north > 90 ||
      west >= east ||
      south >= north ||
      (east - west) * (north - south) > 0.25
    ) {
      throw new Error("Ungültiger OSM-Testserver-Kartenausschnitt.");
    }
    url.searchParams.set("bbox", `${west},${south},${east},${north}`);
  } else if (apiPath === "/api/0.6/map.json") {
    throw new Error("Für die OSM-Kartensuche ist ein begrenzter Ausschnitt erforderlich.");
  }
  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json, application/xml, text/plain",
    // Die Nutzungsregeln der OSM-API verlangen eine eindeutige App-Kennung.
    "User-Agent": `AEDjaeger/${APP_VERSION} (+https://github.com/FrnkMrz/AEDjaeger)`,
  });
  if (input.body !== undefined) {
    headers.set("Content-Type", input.contentType ?? "text/xml; charset=utf-8");
  }
  return fetchWithoutRedirects(
    url,
    {
      method: input.method,
      headers,
      ...(input.body !== undefined ? { body: input.body } : {}),
      cache: "no-store",
      signal: input.signal,
    },
    fetcher,
  );
}
