/**
 * OSM write tests must be isolated from the production editing API.
 *
 * This first boundary deliberately exposes only the public development server.
 * A future writer must call this helper instead of accepting an API URL from
 * browser input or an unrestricted Worker variable.
 */
export const OSM_DEVELOPMENT_SERVER_ORIGIN = "https://master.apis.dev.openstreetmap.org";
const OSM_API_PATH_PREFIX = "/api/0.6/";

export function buildOSMDevelopmentApiUrl(environment: unknown, apiPath: string): URL {
  if (environment !== "development") {
    throw new Error("OSM-Schreibzugriffe sind ausschließlich für die Entwicklungsinstanz freigegeben.");
  }

  if (
    typeof apiPath !== "string" ||
    !apiPath.startsWith(OSM_API_PATH_PREFIX) ||
    apiPath.includes("\\") ||
    apiPath.includes("?") ||
    apiPath.includes("#") ||
    /[\u0000-\u001f\u007f]/u.test(apiPath) ||
    apiPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Ungültiger Pfad zur OSM-Entwicklungs-API.");
  }

  // The fixed base prevents callers from redirecting a test token to production
  // or to a host supplied by a request. Never follow redirects when calling it.
  const url = new URL(apiPath, OSM_DEVELOPMENT_SERVER_ORIGIN);
  // URL normalizes encoded dot segments, so check the final pathname too.
  if (!url.pathname.startsWith(OSM_API_PATH_PREFIX)) {
    throw new Error("Ungültiger Pfad zur OSM-Entwicklungs-API.");
  }
  return url;
}
