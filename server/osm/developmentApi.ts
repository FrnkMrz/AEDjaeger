/**
 * OSM write tests must be isolated from the production editing API.
 *
 * This first boundary deliberately exposes only the public development server.
 * A future writer must call this helper instead of accepting an API URL from
 * browser input or an unrestricted Worker variable.
 */
export const OSM_DEVELOPMENT_SERVER_ORIGIN = "https://master.apis.dev.openstreetmap.org";
export function buildOSMDevelopmentApiUrl(environment: unknown, apiPath: string): URL {
  if (environment !== "development") {
    throw new Error("OSM-Schreibzugriffe sind ausschließlich für die Entwicklungsinstanz freigegeben.");
  }

  // Keep the API surface to the exact calls used by the test writer. In
  // particular, no caller can turn an OSM token into a general-purpose proxy.
  if (typeof apiPath !== "string" || !/^\/api\/0\.6\/(?:node\/[1-9]\d*\.json|changeset\/(?:create|[1-9]\d*(?:\/(?:close|upload))?))$/u.test(apiPath)) {
    throw new Error("Ungültiger Pfad zur OSM-Entwicklungs-API.");
  }

  // The fixed base prevents callers from redirecting a test token to production
  // or to a host supplied by a request. Never follow redirects when calling it.
  return new URL(apiPath, OSM_DEVELOPMENT_SERVER_ORIGIN);
}

/** Calls a small, fixed set of development API endpoints and never follows redirects. */
export async function requestOSMDevelopmentApi(
  environment: unknown,
  apiPath: string,
  accessToken: string,
  input: { method: "GET" | "PUT" | "POST"; body?: string; contentType?: "application/json" | "text/xml; charset=utf-8" },
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (typeof accessToken !== "string" || accessToken.length === 0 || accessToken.length > 8_192 || /[\r\n]/u.test(accessToken)) {
    throw new Error("Ungültiger OSM-Testzugriff.");
  }
  const url = buildOSMDevelopmentApiUrl(environment, apiPath);
  const headers = new Headers({ Authorization: `Bearer ${accessToken}`, Accept: "application/json, application/xml, text/plain" });
  if (input.body !== undefined) {
    headers.set("Content-Type", input.contentType ?? "text/xml; charset=utf-8");
  }
  return fetcher(url, {
    method: input.method,
    headers,
    ...(input.body !== undefined ? { body: input.body } : {}),
    redirect: "error",
    cache: "no-store",
  });
}
