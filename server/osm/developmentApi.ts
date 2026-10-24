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
    !/^\/api\/0\.6\/[A-Za-z0-9/_-]+$/u.test(apiPath) ||
    apiPath.includes("//") ||
    apiPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Ungültiger Pfad zur OSM-Entwicklungs-API.");
  }

  // The fixed base prevents callers from redirecting a test token to production
  // or to a host supplied by a request. Never follow redirects when calling it.
  // OSM API paths need only plain endpoint names and numeric IDs. Rejecting
  // percent escapes here avoids proxy-specific decoding of encoded separators.
  return new URL(apiPath, OSM_DEVELOPMENT_SERVER_ORIGIN);
}
