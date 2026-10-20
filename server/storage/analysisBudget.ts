/** The small subset of Cloudflare D1 used here keeps the storage rule testable. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(columnName?: string): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
}

export interface D1Result<T> {
  success: boolean;
  meta?: { changes?: number };
  results?: T[];
}

export type AnalysisBudgetRequest = {
  reservationId: string;
  userId: string;
  requestId: string;
  utcDay: string;
  costMicros: number;
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

  const result = await database
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

  if (!result.success) {
    // Do not include SQL parameters or database diagnostics in user-facing errors.
    throw new Error("Die Analyse konnte nicht sicher reserviert werden.");
  }

  if ((result.meta?.changes ?? 0) === 1) return { reserved: true };

  const duplicate = await database
    .prepare(
      `SELECT id
       FROM analysis_budget_reservations
       WHERE user_id = ? AND request_id = ?`,
    )
    .bind(request.userId, request.requestId)
    .first<{ id: string }>();

  return duplicate ? { reserved: false, reason: "duplicate" } : { reserved: false, reason: "budget_exceeded" };
}

function validateRequest(request: AnalysisBudgetRequest): void {
  if (!isShortIdentifier(request.reservationId) || !isShortIdentifier(request.userId) || !isShortIdentifier(request.requestId)) {
    throw new Error("Ungültige Kennung für die Analyse-Reservierung.");
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

function isShortIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 128;
}
