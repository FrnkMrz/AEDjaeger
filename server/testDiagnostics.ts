const MAX_DIAGNOSTIC_BODY_BYTES = 512;

const allowedEvents = [
  "test_run_started",
  "test_run_abandoned",
  "photo_selected",
  "demo_started",
  "demo_result_shown",
  "demo_confirmed",
  "live_flow_blocked",
  "live_analysis_started",
  "live_analysis_finished",
  "live_analysis_failed",
  "nearby_search_started",
  "nearby_search_finished",
] as const;

type TestEvent = typeof allowedEvents[number];

/**
 * Accepts only a small, fixed set of test milestones. The browser never sends
 * photos, coordinates, account identifiers, URLs, free-form errors, or tokens.
 */
export async function handleTestDiagnostic(request: Request): Promise<Response> {
  if (request.method !== "POST") return response(405, { Allow: "POST" });

  const requestUrl = new URL(request.url);
  if (request.headers.get("Origin") !== requestUrl.origin) return response(403);
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return response(415);
  }

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_DIAGNOSTIC_BODY_BYTES)) {
    return response(413);
  }

  // Enforce the limit while reading too: Content-Length can be missing, and
  // checking only after request.text() would let a public endpoint buffer a huge body.
  const reader = request.body?.getReader();
  if (!reader) return response(400);
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_DIAGNOSTIC_BODY_BYTES) {
        await reader.cancel();
        return response(413);
      }
      chunks.push(value);
    }
  } catch {
    return response(400);
  }

  const bodyBytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes));
  } catch {
    return response(400);
  }
  if (!isDiagnosticPayload(payload)) return response(400);

  // Do not log the request object: it contains headers and may contain credentials.
  // Cloudflare indexes fields from structured objects, so operators can filter
  // by source or follow one flowId without searching through message text.
  console.info({
    source: "aedjaeger-test",
    event: payload.event,
    flowId: payload.flowId,
    occurredAt: new Date().toISOString(),
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function isDiagnosticPayload(value: unknown): value is { event: TestEvent; flowId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 2
    && keys.includes("event")
    && keys.includes("flowId")
    && typeof record.event === "string"
    && (allowedEvents as readonly string[]).includes(record.event)
    && typeof record.flowId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(record.flowId);
}

function response(status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });
}
