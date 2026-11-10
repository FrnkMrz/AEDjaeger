import type { D1Database, D1Result } from "./d1";
export type { D1Database, D1Result, D1Statement } from "./d1";

export type AnalysisBudgetRequest = {
  reservationId: string;
  userId: string;
  requestId: string;
  utcDay: string;
  /** Trusted server-side worst-case cost estimate, in USD millionths. */
  costMicros: number;
  /** Limits come from operator-controlled server configuration, never the browser. */
  userLimitMicros: number;
  globalLimitMicros: number;
  createdAt: number;
};

export type AnalysisBudgetResult =
  | { reserved: true }
  | { reserved: false; reason: "budget_exceeded" | "duplicate" };

type ExistingReservation = {
  id: string;
  status: string;
  provider_started_at: number | null;
  utc_day: string;
  cost_micros: number;
};

/**
 * Reserve an analysis before contacting an AI provider.
 *
 * One conditional INSERT checks both budgets and records the reservation as a
 * single SQLite write. D1 serializes competing writes, so two parallel requests
 * cannot both spend the same remaining allowance. A repeated request ID is
 * reported separately and never creates a second reservation.
 */
export async function reserveAnalysisBudget(
  database: D1Database,
  request: AnalysisBudgetRequest,
): Promise<AnalysisBudgetResult> {
  validateRequest(request);

  let result: D1Result<unknown>;
  try {
    result = await database
      .prepare(
        `INSERT INTO analysis_budget_reservations
          (id, user_id, request_id, utc_day, cost_micros, status, provider_started_at, created_at)
         SELECT ?, ?, ?, ?, ?, 'reserved', NULL, ?
         WHERE ? <= ?
           AND COALESCE((
             SELECT SUM(cost_micros)
             FROM analysis_budget_reservations
             WHERE utc_day = ? AND status != 'released'
           ), 0) <= ? - ?
           AND COALESCE((
             SELECT SUM(cost_micros)
             FROM analysis_budget_reservations
             WHERE user_id = ? AND utc_day = ? AND status != 'released'
           ), 0) <= ? - ?
         ON CONFLICT (user_id, request_id) DO NOTHING`,
      )
      .bind(
        request.reservationId,
        request.userId,
        request.requestId,
        request.utcDay,
        request.costMicros,
        request.createdAt,
        request.costMicros,
        request.globalLimitMicros,
        request.utcDay,
        request.globalLimitMicros,
        request.costMicros,
        request.userId,
        request.utcDay,
        request.userLimitMicros,
        request.costMicros,
      )
      .run();
  } catch {
    // D1 can reject the promise (for example on a constraint error), bypassing `success`.
    // If the insert committed before its reply was lost, let the caller resume
    // this still-unclaimed reservation with the same request ID.
    if (await findResumableReservation(database, request)) return { reserved: true };
    throw new Error("Die Analyse konnte nicht sicher reserviert werden.");
  }

  if (!result.success) {
    // Do not include SQL parameters or database diagnostics in user-facing errors.
    if (await findResumableReservation(database, request)) return { reserved: true };
    throw new Error("Die Analyse konnte nicht sicher reserviert werden.");
  }

  if ((result.meta?.changes ?? 0) === 1) return { reserved: true };

  const duplicate = await findExistingReservation(database, request.userId, request.requestId);
  if (isResumableReservation(duplicate, request)) return { reserved: true };
  return duplicate ? { reserved: false, reason: "duplicate" } : { reserved: false, reason: "budget_exceeded" };
}

/** Atomically ensure only one request for an ID can begin the paid provider call. */
export async function markAnalysisProviderStarted(
  database: D1Database,
  userId: string,
  requestId: string,
  startedAt: number,
): Promise<boolean> {
  if (!isShortIdentifier(userId) || !isShortIdentifier(requestId) || !Number.isSafeInteger(startedAt) || startedAt < 0) {
    throw new Error("Ungültige Kennung für den Analyseaufruf.");
  }

  try {
    const result = await database
      .prepare(
        `UPDATE analysis_budget_reservations
         SET provider_started_at = ?
         WHERE user_id = ? AND request_id = ? AND status = 'reserved' AND provider_started_at IS NULL`,
      )
      .bind(startedAt, userId, requestId)
      .run();
    if (!result.success) throw new Error();
    return (result.meta?.changes ?? 0) === 1;
  } catch {
    // No provider call may begin unless D1 confirms this one-time claim.
    throw new Error("Der Analyseaufruf konnte nicht sicher vorbereitet werden.");
  }
}

async function findResumableReservation(database: D1Database, request: AnalysisBudgetRequest): Promise<boolean> {
  const existing = await findExistingReservation(database, request.userId, request.requestId);
  return isResumableReservation(existing, request);
}

function isResumableReservation(existing: ExistingReservation | null, request: AnalysisBudgetRequest): boolean {
  // A reservation is tied to the day and amount checked by the original INSERT.
  // Reusing yesterday's row would bypass today's limits; a changed server-side
  // estimate must also go through a fresh budget check instead of reusing it.
  return existing?.status === "reserved"
    && existing.provider_started_at === null
    && existing.utc_day === request.utcDay
    && existing.cost_micros === request.costMicros;
}

async function findExistingReservation(database: D1Database, userId: string, requestId: string): Promise<ExistingReservation | null> {
  try {
    return await database
      .prepare(
        `SELECT id, status, provider_started_at, utc_day, cost_micros
         FROM analysis_budget_reservations
         WHERE user_id = ? AND request_id = ?`,
      )
      .bind(userId, requestId)
      .first<ExistingReservation>();
  } catch {
    throw new Error("Die Analyse konnte nicht sicher reserviert werden.");
  }
}

function validateRequest(request: AnalysisBudgetRequest): void {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw new Error("Ungültige Analyse-Reservierung.");
  }

  if (!isShortIdentifier(request.reservationId) || !isShortIdentifier(request.userId) || !isShortIdentifier(request.requestId)) {
    throw new Error("Ungültige Kennung für die Analyse-Reservierung.");
  }

  if (typeof request.utcDay !== "string") {
    throw new Error("Ungültiger UTC-Tag für die Analyse-Reservierung.");
  }

  const parsedDay = Date.parse(`${request.utcDay}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(request.utcDay) ||
    !Number.isSafeInteger(parsedDay) ||
    new Date(parsedDay).toISOString().slice(0, 10) !== request.utcDay
  ) {
    throw new Error("Ungültiger UTC-Tag für die Analyse-Reservierung.");
  }

  for (const value of [request.costMicros, request.userLimitMicros, request.globalLimitMicros]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Ungültiger Kostenwert für die Analyse-Reservierung.");
    }
  }

  if (!Number.isSafeInteger(request.createdAt) || request.createdAt < 0) {
    throw new Error("Ungültiger Zeitstempel für die Analyse-Reservierung.");
  }
}

function isShortIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
