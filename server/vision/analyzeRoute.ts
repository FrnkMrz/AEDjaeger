import { findOSMSession } from "../storage/osmSessions";
import type { D1Database } from "../storage/d1";
import {
  markAnalysisProviderStarted,
  releaseAnalysisBudgetReservation,
  reserveAnalysisBudget,
} from "../storage/analysisBudget";
import {
  analyzeAedPhoto,
  MAX_VISION_IMAGE_BYTES,
  OPENAI_VISION_MODEL,
  validateAedImage,
  VisionAnalysisError,
  type SupportedImageType,
} from "./openai";
import {
  BodyTooLargeError,
  isCrossOrigin,
  jsonResponse,
  readOSMSessionCookie,
  readLimitedBody,
} from "../http/requestGuards";
import { sha256Hex } from "../crypto/hash";

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

  const sessionToken = readOSMSessionCookie(request.headers.get("Cookie"));
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

  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !ALLOWED_IMAGE_TYPES.includes(contentType as SupportedImageType)) {
    return jsonResponse({ error: "unsupported_media_type" }, 415);
  }
  const requestId = request.headers.get("X-Request-Id");
  if (!requestId || !/^[A-Za-z0-9_-]{16,128}$/u.test(requestId)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  let body: Uint8Array;
  try {
    body = await readLimitedBody(request, MAX_VISION_IMAGE_BYTES);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof BodyTooLargeError ? "request_too_large" : "invalid_request" },
      error instanceof BodyTooLargeError ? 413 : 400,
    );
  }

  const payload = {
    requestId,
    contentType: contentType as SupportedImageType,
    imageBytes: body,
  };
  try {
    // Reject spoofed MIME types and malformed image bytes before reserving budget.
    validateAedImage({ bytes: payload.imageBytes, contentType: payload.contentType });
  } catch {
    return jsonResponse({ error: "invalid_image" }, 400);
  }

  const now = (dependencies.now ?? Date.now)();
  let budgetUserId: string;
  try {
    budgetUserId = await createBudgetUserId(session.environment, session.subject);
    const reservation = await reserveAnalysisBudget(environment.DB, {
      reservationId: (dependencies.randomUUID ?? crypto.randomUUID.bind(crypto))(),
      requestId: payload.requestId,
      userId: budgetUserId,
      utcDay: new Date(now).toISOString().slice(0, 10),
      costMicros: limits.reservationMicros,
      userLimitMicros: limits.userDailyMicros,
      globalLimitMicros: limits.globalDailyMicros,
      createdAt: now,
    });
    if (!reservation.reserved) {
      return jsonResponse(
        { error: reservation.reason === "duplicate" ? "duplicate_request" : "analysis_budget_exceeded" },
        reservation.reason === "duplicate" ? 409 : 429,
      );
    }
  } catch (error) {
    // Fail closed: no provider call unless D1 confirmed a reservation first.
    return failure("analysis_budget_unavailable", 503, undefined, { detailCode: describeStorageFailure(error) });
  }

  let claimed: boolean;
  try {
    claimed = await markAnalysisProviderStarted(environment.DB, budgetUserId, payload.requestId, now);
  } catch (error) {
    // D1 may have committed the claim before losing its reply; this state must not be retried blindly.
    // If the claim did not commit, the conditional release recovers the budget. If it
    // did commit, provider_started_at prevents release and preserves fail-closed behavior.
    await safelyReleaseAnalysisReservation(environment.DB, budgetUserId, payload.requestId);
    return failure("analysis_claim_uncertain", 503, undefined, { detailCode: describeStorageFailure(error) });
  }
  if (!claimed) {
    await safelyReleaseAnalysisReservation(environment.DB, budgetUserId, payload.requestId);
    return jsonResponse({ error: "duplicate_request" }, 409);
  }

  try {
    const observation = await (dependencies.analyze ?? analyzeAedPhoto)(
      { bytes: payload.imageBytes, contentType: payload.contentType },
      environment.OPENAI_API_KEY,
    );
    return jsonResponse({ request_id: payload.requestId, model: OPENAI_VISION_MODEL, observation }, 200);
  } catch (error) {
    const status = error instanceof VisionAnalysisError && error.code === "invalid_image" ? 400 : 502;
    const code =
      error instanceof VisionAnalysisError && error.code === "invalid_image" ? "invalid_image" : "analysis_failed";
    const detail = error instanceof VisionAnalysisError ? error.detail : {};
    return failure(code, status, payload.requestId, {
      detailStatus: detail.providerStatus,
      detailCode: detail.providerCode,
    });
  }
}

async function safelyReleaseAnalysisReservation(
  database: D1Database,
  userId: string,
  requestId: string,
): Promise<void> {
  try {
    await releaseAnalysisBudgetReservation(database, userId, requestId);
  } catch {
    // A failed cleanup must not make a pre-provider failure look successful.
    // The original reservation expires from budget accounting at the UTC day boundary.
  }
}

/**
 * Antwortet mit einem Fehler und schreibt dieselben Eckdaten ins Betriebsprotokoll.
 *
 * Warum? Ohne Hinweis lässt sich ein Ausfall im Pilot nicht eingrenzen: „Prüfung nicht möglich“ kann
 * ein ungültiger Schlüssel, ein unbekanntes Modell, ein Zeitlimit oder eine fehlende Datenbanktabelle
 * sein. Übernommen werden nur feste Kennungen und Statuszahlen, nie Fehlertexte, Fotos, Schlüssel
 * oder Kontodaten. Die Kennungen gehen auch an die App, damit sie dort auf dem Handy lesbar sind.
 */
function failure(
  error: string,
  status: number,
  requestId: string | undefined,
  hint: { detailStatus?: number; detailCode?: string } = {},
): Response {
  console.error(
    JSON.stringify({
      event: "vision_analysis_failed",
      error,
      status,
      detail_status: hint.detailStatus,
      detail_code: hint.detailCode,
    }),
  );
  return jsonResponse(
    {
      error,
      ...(requestId ? { request_id: requestId } : {}),
      ...(hint.detailStatus ? { detail_status: hint.detailStatus } : {}),
      ...(hint.detailCode ? { detail_code: hint.detailCode } : {}),
    },
    status,
  );
}

/** Ordnet einen Datenbankfehler einer festen Kennung zu, ohne seinen Text weiterzugeben. */
function describeStorageFailure(error: unknown): string {
  // D1 meldet eine fehlende Tabelle als „no such table“; das ist der häufigste Einrichtungsfehler.
  return error instanceof Error &&
    /no such table/iu.test(`${error.message} ${(error.cause as Error | undefined)?.message ?? ""}`)
    ? "missing_table"
    : "storage_error";
}

/**
 * Sagt der App vorab, ob die Fotoprüfung für dieses Konto überhaupt läuft.
 *
 * Warum vorab? Die App zeigt nur dann den Hinweis „Foto geht an OpenAI“ und die Prüf-Schaltfläche,
 * wenn die Prüfung wirklich aktiv ist. Sonst bliebe der bisherige Ablauf (Selbstbestätigung) unverändert
 * und niemand sieht einen Hinweis auf eine Funktion, die gar nicht läuft.
 *
 * Die Funktion gibt nur Ja/Nein zurück und verrät weder Schlüssel noch Limits noch die Zulassungsliste.
 * Sie nutzt exakt dieselben Bedingungen wie handleVisionAnalysis, damit „verfügbar“ nie mehr verspricht,
 * als die Route später hält.
 */
export function isPhotoCheckAvailable(
  environment: VisionRouteEnvironment,
  session: { subject: string; environment: "production" | "development" },
): boolean {
  const limits = getAnalysisLimits(environment);
  if (!limits || !environment.DB || !environment.OPENAI_API_KEY?.trim()) return false;
  return limits.allowedSubjects.includes(`${session.environment}:${session.subject}`);
}

function getAnalysisLimits(
  environment: VisionRouteEnvironment,
): { allowedSubjects: string[]; reservationMicros: number; userDailyMicros: number; globalDailyMicros: number } | null {
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
  if (
    subjects.length === 0 ||
    subjects.length > 100 ||
    subjects.some((subject) => !subject || subject.length > 320 || /[\u0000-\u001f]/u.test(subject))
  ) {
    return null;
  }
  return [...new Set(subjects)];
}

async function createBudgetUserId(environment: "production" | "development", subject: string): Promise<string> {
  // OSM subjects are unique only within an issuer. Hash both values so D1 stores
  // a fixed-size key that cannot collide across the production and test servers.
  return sha256Hex(`${environment}\0${subject}`);
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
