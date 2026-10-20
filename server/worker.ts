type StaticAssets = {
  fetch(request: Request): Promise<Response>;
};

type WorkerEnvironment = {
  ASSETS: StaticAssets;
};

/**
 * Cloudflare entry point: API routes are handled here, while all other requests
 * are passed through to the static PWA assets configured in wrangler.jsonc.
 */
const worker = {
  async fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET" });
      }

      // Keep this response generic; it confirms routing without exposing secrets or service state.
      return jsonResponse({ status: "ok" }, 200);
    }

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return jsonResponse({ error: "not_found" }, 404);
    }

    return environment.ASSETS.fetch(request);
  },
};

function jsonResponse(body: Record<string, string>, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export default worker;
