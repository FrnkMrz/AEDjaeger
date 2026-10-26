export class ExternalRedirectError extends Error {
  constructor(readonly httpStatus: number) {
    super("Weiterleitungen externer Anfragen sind nicht erlaubt.");
    this.name = "ExternalRedirectError";
  }
}

/**
 * Cloudflare Workers unterstützt `redirect: "error"` nicht: Der Aufruf wirft
 * bereits vor der Netzwerkanfrage. `manual` liefert die Weiterleitung zurück,
 * ohne Zugangsdaten oder Anfrageinhalt an deren Ziel weiterzugeben.
 */
export async function fetchWithoutRedirects(
  input: RequestInfo | URL,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const response = await fetcher(input, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    // Weder Location noch Antworttext übernehmen: Beide können vertrauliche
    // Daten enthalten. Den ungenutzten Body möglichst freigeben.
    try { await response.body?.cancel(); } catch { /* Die Weiterleitung bleibt abgelehnt. */ }
    throw new ExternalRedirectError(response.status);
  }
  return response;
}
