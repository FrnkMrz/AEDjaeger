import { findOSMSession } from "../storage/osmSessions";
import type { D1Database } from "../storage/d1";
import { markAnalysisProviderStarted, reserveAnalysisBudget } from "../storage/analysisBudget";
import { analyzeAedPhoto, MAX_VISION_IMAGE_BYTES, OPENAI_VISION_MODEL, validateAedImage, VisionAnalysisError, type SupportedImageType } from "./openai";

const SESSION_COOKIE = "aedjaeger_osm_session";
// JSON base64 encoding adds about one third to the original image size.
const MAX_REQUEST_BYTES = Math.ceil(MAX_VISION_IMAGE_BYTES / 3) * 4 + 1_024;
const ALLOWED_IMAGE_TYPES: readonly SupportedImageType[] = ["image/jpeg", "image/png", "image/webp"];

export type VisionRouteEnvironment = {
  DB?: D1Database;
  OPENAI_API_KEY?: string;
  AI_ANALYSIS_ENABLED?: string;
  AI_ANALYSIS_ALLOWED_OSM_SUBJECTS?: string;
  AI_ANALYSIS_COST_RESERVATION_MICROS?: string;
  AI_ANALYSIS_USER_DAILY_LIMIT_MICROS?: string;
  AI_ANALYSIS_GLOBAL_DAILY_LIMIT_MICROS?: string;
};

type Dependencies = {
  analyze?: typeof analyzeAedPhoto;
  now?: () => number;
  randomUUID?: () => string;
};

/**
 * Accept a single, authenticated image observation request.
 * The feature is deliberately off unless an operator explicitly enables it
 * and configures a per-call reserve plus per-user and global daily limits.
 */
export async function handleVisionAnalysis(
  request: Request,
  environment: VisionRouteEnvironment,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  const requestUrl = new URL(request.url);
  if (isCrossOrigin(request, requestUrl.origin)) return jsonResponse({ error: "invalid_origin" }, 403);

  const limits = getAnalysisLimits(environment);
  if (!limits || !environment.DB || !environment.OPENAI_API_KEY?.trim()) {
    return jsonResponse({ error: "analysis_unavailable" }, 503);
  }

  const sessionToken = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!sessionToken) return jsonResponse({ error: "authentication_required" }, 401);

  let session: { subject: string; environment: "production" | "development" } | null;
  try {
    session = await findOSMSession(environment.DB, sessionToken, (dependencies.now ?? Date.now)());
  } catch {
    return jsonResponse({ error: "session_unavailable" }, 503);
  }
  if (!session) return jsonResponse({ error: "authentication_required" }, 401);
  const providerIdentity = `${session.environment}:${session.subject}`;
  if (!limits.allowedSubjects.includes(providerIdentity)) {
    return jsonResponse({ error: "analysis_not_allowed" }, 403);
  }

  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return jsonResponse({ error: "unsupported_media_type" }, 415);
  }

  let body: Uint8Array;
  try {
    body = await readLimitedBody(request, MAX_REQUEST_BYTES);
  } catch (error) {
    return jsonResponse({ error: error instanceof BodyTooLargeError ? "request_too_large" : "invalid_request" }, error instanceof BodyTooLargeError ? 413 : 400);
  }

  const payload = parseRequestBody(body);
  if (!payload) return jsonResponse({ error: "invalid_request" }, 400);
  try {
    // Reject spoofed MIME types and malformed image bytes before reserving budget.
    validateAedImage({ bytes: payload.imageBytes, contentType: payload.contentType });
  } catch {
    return jsonResponse({ error: "invalid_image" }, 400);
  }

  const now = (dependencies.now ?? Date.now)();
  try {
    const reservation = await reserveAnalysisBudget(environment.DB, {
      reservationId: (dependencies.randomUUID ?? crypto.randomUUID.bind(crypto))(),
      requestId: payload.requestId,
      userId: providerIdentity,
      utcDay: new Date(now).toISOString().slice(0, 10),
      costMicros: limits.reservationMicros,
      userLimitMicros: limits.userDailyMicros,
      globalLimitMicros: limits.globalDailyMicros,
      createdAt: now,
    });
    if (!reservation.reserved) {
      return jsonResponse({ error: reservation.reason === "duplicate" ? "duplicate_request" : "analysis_budget_exceeded" }, reservation.reason === "duplicate" ? 409 : 429);
    }
  } catch {
    // Fail closed: no provider call unless D1 confirmed a reservation first.
    return jsonResponse({ error: "analysis_budget_unavailable" }, 503);
  }

  try {
    const claimed = await markAnalysisProviderStarted(environment.DB, providerIdentity, payload.requestId, now);
    if (!claimed) return jsonResponse({ error: "duplicate_request" }, 409);
  } catch {
    // D1 may have committed the claim before losing its reply; this state must not be retried blindly.
    return jsonResponse({ error: "analysis_claim_uncertain" }, 503);
  }

  try {
    const observation = await (dependencies.analyze ?? analyzeAedPhoto)(
      { bytes: payload.imageBytes, contentType: payload.contentType },
      environment.OPENAI_API_KEY,
    );
    return jsonResponse({ request_id: payload.requestId, model: OPENAI_VISION_MODEL, observation }, 200);
  } catch (error) {
    const status = error instanceof VisionAnalysisError && error.code === "invalid_image" ? 400 : 502;
    const code = error instanceof VisionAnalysisError && error.code === "invalid_image" ? "invalid_image" : "analysis_failed";
    return jsonResponse({ error: code, request_id: payload.requestId }, status);
  }
}

class BodyTooLargeError extends Error {}

async function readLimitedBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    throw new BodyTooLargeError();
  }
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
        try {
          await reader.cancel();
        } catch {
          // A failed cancellation must not hide the size violation from the caller.
        }
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

function parseRequestBody(bytes: Uint8Array): { requestId: string; contentType: SupportedImageType; imageBytes: Uint8Array } | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return null;
  const record = decoded as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || typeof record.request_id !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(record.request_id)) return null;
  if (typeof record.content_type !== "string" || !ALLOWED_IMAGE_TYPES.includes(record.content_type as SupportedImageType)) return null;
  if (typeof record.image_base64 !== "string" || record.image_base64.length === 0 || record.image_base64.length > Math.ceil(MAX_VISION_IMAGE_BYTES / 3) * 4) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(record.image_base64)) return null;

  let binary: string;
  try {
    binary = atob(record.image_base64);
  } catch {
    return null;
  }
  if (binary.length === 0 || binary.length > MAX_VISION_IMAGE_BYTES) return null;
  const imageBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { requestId: record.request_id, contentType: record.content_type as SupportedImageType, imageBytes };
}

function getAnalysisLimits(environment: VisionRouteEnvironment): { allowedSubjects: string[]; reservationMicros: number; userDailyMicros: number; globalDailyMicros: number } | null {
  if (environment.AI_ANALYSIS_ENABLED !== "true") return null;
  const allowedSubjects = parseAllowedSubjects(environment.AI_ANALYSIS_ALLOWED_OSM_SUBJECTS);
  const reservationMicros = parsePositiveInteger(environment.AI_ANALYSIS_COST_RESERVATION_MICROS);
  const userDailyMicros = parsePositiveInteger(environment.AI_ANALYSIS_USER_DAILY_LIMIT_MICROS);
  const globalDailyMicros = parsePositiveInteger(environment.AI_ANALYSIS_GLOBAL_DAILY_LIMIT_MICROS);
  if (!allowedSubjects || !reservationMicros || !userDailyMicros || !globalDailyMicros) return null;
  if (reservationMicros > userDailyMicros || reservationMicros > globalDailyMicros) return null;
  return { allowedSubjects, reservationMicros, userDailyMicros, globalDailyMicros };
}

function parseAllowedSubjects(value: string | undefined): string[] | null {
  if (!value || value.length > 25_600) return null;
  const subjects = value.split(",").map((subject) => subject.trim());
  if (subjects.length === 0 || subjects.length > 100 || subjects.some((subject) => !subject || subject.length > 320 || /[\u0000-\u001f]/u.test(subject))) {
    return null;
  }
  return [...new Set(subjects)];
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function isCrossOrigin(request: Request, requestOrigin: string): boolean {
  const origin = request.headers.get("Origin");
  return (origin !== null && origin !== requestOrigin) || request.headers.get("Sec-Fetch-Site") === "cross-site";
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
  }
  return null;
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
