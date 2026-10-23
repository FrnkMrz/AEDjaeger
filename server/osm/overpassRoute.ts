import { findOSMSession } from "../storage/osmSessions";
import type { D1Database } from "../storage/d1";
import { reserveOverpassSearchSlot } from "../storage/overpassCooldown";
import { buildOverpassQuery, normalizeOverpassResponse, type SearchCoordinate } from "../../src/osm/overpassSearch";

const SESSION_COOKIE = "aedjaeger_osm_session";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const OVERPASS_USER_AGENT = "AEDjaeger/0.1.0 (+https://github.com/FrnkMrz/AEDjaeger)";
const MAX_REQUEST_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 512 * 1_024;
const MAX_GPS_ACCURACY_METERS = 100;
const NEARBY_RADIUS_METERS = 100;
const OVERPASS_TIMEOUT_SECONDS = 25;
const REQUEST_TIMEOUT_MS = 30_000;

export type OverpassRouteEnvironment = { DB?: D1Database };

type Dependencies = {
  fetch?: typeof fetch;
  now?: () => number;
};

/** Authenticated, read-only lookup with a fixed Overpass endpoint and bounded query. */
export async function handleOverpassSearch(
  request: Request,
  environment: OverpassRouteEnvironment,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  const requestUrl = new URL(request.url);
  if (isCrossOrigin(request, requestUrl.origin)) return jsonResponse({ error: "invalid_origin" }, 403);
  if (!environment.DB) return jsonResponse({ error: "search_unavailable" }, 503);
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return jsonResponse({ error: "unsupported_media_type" }, 415);
  }

  const sessionToken = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!sessionToken) return jsonResponse({ error: "authentication_required" }, 401);

  let session: { subject: string } | null;
  try {
    session = await findOSMSession(environment.DB, sessionToken, (dependencies.now ?? Date.now)());
  } catch {
    return jsonResponse({ error: "session_unavailable" }, 503);
  }
  if (!session) return jsonResponse({ error: "authentication_required" }, 401);

  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBody(request, MAX_REQUEST_BYTES);
  } catch (error) {
    return jsonResponse({ error: error instanceof BodyTooLargeError ? "request_too_large" : "invalid_request" }, error instanceof BodyTooLargeError ? 413 : 400);
  }
  const location = parseLocation(bytes);
  if (!location) return jsonResponse({ error: "invalid_request" }, 400);
  if (location.accuracyMeters > MAX_GPS_ACCURACY_METERS) {
    return jsonResponse({ error: "location_too_uncertain", maximum_accuracy_meters: MAX_GPS_ACCURACY_METERS }, 422);
  }

  const now = (dependencies.now ?? Date.now)();
  let cooldownEndsAt: number;
  try {
    const reservation = await reserveOverpassSearchSlot(environment.DB, session.subject, now);
    if (!reservation.reserved) return jsonResponse({ error: "search_rate_limited" }, 429, { "Retry-After": String(reservation.retryAfterSeconds) });
    cooldownEndsAt = reservation.nextAllowedAt;
  } catch {
    return jsonResponse({ error: "search_unavailable" }, 503);
  }
  // Every accepted request consumes this slot, even if Overpass fails quickly.
  // Let the client wait for the same cooldown instead of offering a retry that will be rejected.
  const retryHeaders = () => ({
    "Retry-After": String(Math.max(0, Math.ceil((cooldownEndsAt - (dependencies.now ?? Date.now)()) / 1_000))),
  });

  const coverageRadiusMeters = Math.ceil(location.accuracyMeters + NEARBY_RADIUS_METERS);
  let query: string;
  try {
    query = buildOverpassQuery({ center: location, radiusMeters: coverageRadiusMeters, timeoutSeconds: OVERPASS_TIMEOUT_SECONDS });
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400, retryHeaders());
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (dependencies.fetch ?? fetch)(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": OVERPASS_USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      redirect: "error",
      signal: controller.signal,
    });

    if (response.status === 429 || response.status === 406) {
      return jsonResponse({ error: "overpass_rate_limited" }, 503, retryHeaders());
    }
    if (!response.ok) return jsonResponse({ error: "overpass_unavailable" }, 502, retryHeaders());

    let payloadBytes: Uint8Array;
    try {
      payloadBytes = await readLimitedBody(response, MAX_RESPONSE_BYTES);
    } catch {
      return jsonResponse({ error: "overpass_response_too_large" }, 502, retryHeaders());
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
    } catch {
      return jsonResponse({ error: "overpass_invalid_response" }, 502, retryHeaders());
    }

    const result = normalizeOverpassResponse(payload, coverageRadiusMeters);
    if (result.status === "failed") return jsonResponse({ error: "overpass_invalid_response" }, 502, retryHeaders());
    return jsonResponse({
      status: result.status,
      candidates: result.candidates,
      coverage_radius_meters: result.coverageRadiusMeters,
      ...(result.reason ? { reason: result.reason } : {}),
    }, 200, retryHeaders());
  } catch {
    return jsonResponse({ error: controller.signal.aborted ? "overpass_timeout" : "overpass_unavailable" }, controller.signal.aborted ? 504 : 502, retryHeaders());
  } finally {
    clearTimeout(timeout);
  }
}

class BodyTooLargeError extends Error {}

async function readLimitedBody(request: Request | Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) throw new BodyTooLargeError();
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseLocation(bytes: Uint8Array): (SearchCoordinate & { accuracyMeters: number }) | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) return null;
  const { latitude, longitude, accuracy_meters: accuracyMeters } = record;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (typeof accuracyMeters !== "number" || !Number.isFinite(accuracyMeters) || accuracyMeters <= 0 || accuracyMeters > 10_000) return null;
  return { latitude, longitude, accuracyMeters };
}

function isCrossOrigin(request: Request, requestOrigin: string): boolean {
  const origin = request.headers.get("Origin");
  return (origin !== null && origin !== requestOrigin) || request.headers.get("Sec-Fetch-Site") === "cross-site";
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader || cookieHeader.length > 8_192) return null;
  const values = cookieHeader.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}

function jsonResponse(body: Record<string, unknown>, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders,
    },
  });
}
