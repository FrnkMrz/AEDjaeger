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
          (id, user_id, request_id, utc_day, cost_micros, status, created_at)
         SELECT ?, ?, ?, ?, ?, 'reserved', ?
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
    throw new Error("Die Analyse konnte nicht sicher reserviert werden.");
  }

  if (!result.success) {
    // Do not include SQL parameters or database diagnostics in user-facing errors.
    throw new Error("Die Analyse konnte nicht sicher reserviert werden.");
  }

  if ((result.meta?.changes ?? 0) === 1) return { reserved: true };

  let duplicate: { id: string } | null;
  try {
    duplicate = await database
      .prepare(
        `SELECT id
         FROM analysis_budget_reservations
         WHERE user_id = ? AND request_id = ?`,
      )
      .bind(request.userId, request.requestId)
      .first<{ id: string }>();
  } catch {
    throw new Error("Die Analyse konnte nicht sicher reserviert werden.");
  }

  return duplicate ? { reserved: false, reason: "duplicate" } : { reserved: false, reason: "budget_exceeded" };
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
