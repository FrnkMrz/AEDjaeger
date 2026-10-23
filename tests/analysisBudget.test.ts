import { describe, expect, it } from "vitest";
import { markAnalysisProviderStarted, reserveAnalysisBudget, type D1Database, type D1Result, type D1Statement } from "../server/storage/analysisBudget";

function createDatabase(options: {
  changes?: number;
  duplicate?: { id: string; status: string; provider_started_at: number | null } | null;
  firstError?: Error;
  runError?: Error;
  success?: boolean;
} = {}) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const database: D1Database = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement: D1Statement = {
        bind(...boundValues) {
          values = boundValues;
          return statement;
        },
        async run<T>() {
          calls.push({ query, values });
          if (options.runError) throw options.runError;
          return {
            success: options.success ?? true,
            meta: { changes: options.changes ?? 1 },
          } as D1Result<T>;
        },
        async first<T>() {
          calls.push({ query, values });
          if (options.firstError) throw options.firstError;
          return (options.duplicate ?? null) as T | null;
        },
      };
      return statement;
    },
  };
  return { database, calls };
}

const validRequest = {
  reservationId: "reservation-1",
  userId: "osm-user-7",
  requestId: "request-1",
  utcDay: "2026-10-20",
  costMicros: 2_000,
  userLimitMicros: 10_000,
  globalLimitMicros: 100_000,
  createdAt: 1_792_485_000_000,
};

describe("analysis budget reservation", () => {
  it("records both limits in one conditional insert before analysis", async () => {
    const { database, calls } = createDatabase();

    await expect(reserveAnalysisBudget(database, validRequest)).resolves.toEqual({ reserved: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("INSERT INTO analysis_budget_reservations");
    expect(calls[0].query).toContain("SUM(cost_micros)");
    expect(calls[0].query).toContain("ON CONFLICT (user_id, request_id) DO NOTHING");
    expect(calls[0].values).toEqual([
      "reservation-1",
      "osm-user-7",
      "request-1",
      "2026-10-20",
      2_000,
      1_792_485_000_000,
      2_000,
      100_000,
      "2026-10-20",
      100_000,
      2_000,
      "osm-user-7",
      "2026-10-20",
      10_000,
      2_000,
    ]);
  });

  it("distinguishes a repeated request from an exhausted budget", async () => {
    const duplicateDatabase = createDatabase({ changes: 0, duplicate: { id: "reservation-1", status: "reserved", provider_started_at: 10 } });
    const fullDatabase = createDatabase({ changes: 0 });

    await expect(reserveAnalysisBudget(duplicateDatabase.database, validRequest)).resolves.toEqual({ reserved: false, reason: "duplicate" });
    await expect(reserveAnalysisBudget(fullDatabase.database, validRequest)).resolves.toEqual({
      reserved: false,
      reason: "budget_exceeded",
    });
    expect(duplicateDatabase.calls).toHaveLength(2);
    expect(fullDatabase.calls).toHaveLength(2);
  });

  it("resumes a reservation after an ambiguous insert response if no provider claim exists", async () => {
    const { database } = createDatabase({
      runError: new Error("ambiguous insert response"),
      duplicate: { id: "reservation-1", status: "reserved", provider_started_at: null },
    });

    await expect(reserveAnalysisBudget(database, validRequest)).resolves.toEqual({ reserved: true });
  });

  it("claims a provider call only once for a reservation", async () => {
    const { database, calls } = createDatabase({ changes: 1 });

    await expect(markAnalysisProviderStarted(database, validRequest.userId, validRequest.requestId, validRequest.createdAt)).resolves.toBe(true);
    expect(calls[0].query).toContain("provider_started_at IS NULL");
  });

  it("fails closed when the database cannot confirm the reservation", async () => {
    const { database } = createDatabase({ success: false });

    await expect(reserveAnalysisBudget(database, validRequest)).rejects.toThrow("nicht sicher reserviert");
  });

  it("hides rejected D1 promise details from both reservation and duplicate lookup", async () => {
    const runErrorDatabase = createDatabase({ runError: new Error("secret SQL details") });
    const lookupErrorDatabase = createDatabase({ changes: 0, firstError: new Error("secret lookup details") });

    await expect(reserveAnalysisBudget(runErrorDatabase.database, validRequest)).rejects.toThrow("nicht sicher reserviert");
    await expect(reserveAnalysisBudget(lookupErrorDatabase.database, validRequest)).rejects.toThrow("nicht sicher reserviert");
  });

  it.each([
    { ...validRequest, costMicros: 0 },
    { ...validRequest, userLimitMicros: Number.MAX_SAFE_INTEGER + 1 },
    { ...validRequest, utcDay: "2026-02-31" },
    { ...validRequest, requestId: "" },
    { ...validRequest, userId: { length: 1 } as unknown as string },
    null as unknown as typeof validRequest,
  ])("rejects invalid budget input before database access", async (request) => {
    const { database, calls } = createDatabase();

    await expect(reserveAnalysisBudget(database, request)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
