import { fetchWithoutRedirects } from "../../server/http/fetchWithoutRedirects";

// Nur vom lokalen Runtime-Test gestartet. Keine App-Konfiguration, Secrets,
// Cloudflare-Ressourcen oder echten Anbieter werden in diesen Worker geladen.
export default {
  async fetch(request: Request, environment: { MOCK_PROVIDER_ORIGIN: string }): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      const response = await fetchWithoutRedirects(`${environment.MOCK_PROVIDER_ORIGIN}${path}`, {
        method: "POST",
        headers: { Authorization: "Bearer local-fixture-token" },
        body: "local-fixture-body",
        signal: AbortSignal.timeout(5_000),
      });
      return new Response(await response.text(), { status: response.status });
    } catch {
      return Response.json({ rejected: true }, { status: 502 });
    }
  },
};
