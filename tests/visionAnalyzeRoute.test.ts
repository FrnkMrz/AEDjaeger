import { describe, expect, it, vi } from "vitest";
import { handleVisionAnalysis, type VisionRouteEnvironment } from "../server/vision/analyzeRoute";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";
import type { VisionObservation } from "../src/contracts/visionObservation";

const sessionToken = "s".repeat(43);
const imageBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0x01]);
const observation: VisionObservation = {
  scene: "device_visible",
  device_count: 1,
  readable_text: [],
  manufacturer: null,
  model: null,
  location_clues: [],
  image_issues: [],
};

function createDatabase(options: { authenticated?: boolean; reserved?: boolean; runError?: boolean; duplicate?: boolean } = {}) {
  const calls: string[] = [];
  const database: D1Database = {
    prepare(query: string): D1Statement {
      const statement: D1Statement = {
        bind() { return statement; },
        async run<T>() {
          calls.push(query);
          if (options.runError) throw new Error("private D1 diagnostic");
          const changes = query.includes("INSERT INTO analysis_budget_reservations") ? (options.reserved === false ? 0 : 1) : 1;
          return { success: true, meta: { changes } } as D1Result<T>;
        },
        async first<T>() {
          calls.push(query);
          if (query.includes("FROM osm_sessions")) {
            return (options.authenticated === false ? null : { osm_subject: "osm-test-user" }) as T | null;
          }
          if (query.includes("FROM analysis_budget_reservations")) {
            return (options.duplicate ? { id: "prior-reservation" } : null) as T | null;
          }
          return null;
        },
      };
      return statement;
    },
  };
  return { database, calls };
}

function environment(database: D1Database, overrides: Partial<VisionRouteEnvironment> = {}): VisionRouteEnvironment {
  return {
    DB: database,
    OPENAI_API_KEY: "server-only-test-key",
    AI_ANALYSIS_ENABLED: "true",
    AI_ANALYSIS_COST_RESERVATION_MICROS: "5000",
    AI_ANALYSIS_USER_DAILY_LIMIT_MICROS: "20000",
    AI_ANALYSIS_GLOBAL_DAILY_LIMIT_MICROS: "100000",
    ...overrides,
  };
}

function analysisRequest(options: { cookie?: string; origin?: string; contentType?: string; body?: string } = {}): Request {
  return new Request("https://aedjaeger.test/api/vision/analyze", {
    method: "POST",
    headers: {
      ...(options.cookie === undefined ? { Cookie: `aedjaeger_osm_session=${sessionToken}` } : { Cookie: options.cookie }),
      ...(options.origin === undefined ? { Origin: "https://aedjaeger.test" } : { Origin: options.origin }),
      "Content-Type": options.contentType ?? "application/json",
    },
    body: options.body ?? JSON.stringify({ request_id: "request_1234567890", content_type: "image/jpeg", image_base64: btoa(String.fromCharCode(...imageBytes)) }),
  });
}

function successfulAnalysis() {
  return vi.fn(async () => observation);
}

describe("protected image analysis route", () => {
  it("stays disabled until the operator explicitly enables it and sets every budget", async () => {
    const { database, calls } = createDatabase();
    const analyze = successfulAnalysis();
    const response = await handleVisionAnalysis(analysisRequest(), environment(database, { AI_ANALYSIS_ENABLED: "false" }), { analyze });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "analysis_unavailable" });
    expect(calls).toEqual([]);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("requires an authenticated OSM session before reading a photo or reserving cost", async () => {
    const { database, calls } = createDatabase();
    const analyze = successfulAnalysis();
    const response = await handleVisionAnalysis(analysisRequest({ cookie: "" }), environment(database), { analyze });

    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before session lookup", async () => {
    const { database, calls } = createDatabase();
    const response = await handleVisionAnalysis(analysisRequest({ origin: "https://attacker.example" }), environment(database));

    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("fails closed when operator budget limits are absent or invalid", async () => {
    const { database, calls } = createDatabase();
    const response = await handleVisionAnalysis(analysisRequest(), environment(database, { AI_ANALYSIS_GLOBAL_DAILY_LIMIT_MICROS: "0" }));
    const missingKey = await handleVisionAnalysis(analysisRequest(), environment(database, { OPENAI_API_KEY: undefined }));

    expect(response.status).toBe(503);
    expect(missingKey.status).toBe(503);
    expect(calls).toEqual([]);
  });

  it("does not reserve cost or call OpenAI for malformed image bytes", async () => {
    const { database, calls } = createDatabase();
    const analyze = successfulAnalysis();
    const body = JSON.stringify({ request_id: "request_1234567890", content_type: "image/jpeg", image_base64: btoa("no image") });
    const response = await handleVisionAnalysis(analysisRequest({ body }), environment(database), { analyze });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_image" });
    expect(calls.some((query) => query.includes("analysis_budget_reservations"))).toBe(false);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("reserves D1 budget before passing the image to GPT-6 Luna", async () => {
    const { database, calls } = createDatabase();
    const analyze = vi.fn(async () => {
      expect(calls.some((query) => query.includes("INSERT INTO analysis_budget_reservations"))).toBe(true);
      return observation;
    });
    const response = await handleVisionAnalysis(analysisRequest(), environment(database), {
      analyze,
      now: () => Date.UTC(2026, 9, 22, 12),
      randomUUID: () => "reservation-1",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ request_id: "request_1234567890", model: "gpt-6-luna", observation });
    expect(analyze).toHaveBeenCalledWith({ bytes: imageBytes, contentType: "image/jpeg" }, "server-only-test-key");
  });

  it("never calls the provider when a reservation is denied or cannot be confirmed", async () => {
    const analyze = successfulAnalysis();
    const exhausted = createDatabase({ reserved: false });
    const exhaustedResponse = await handleVisionAnalysis(analysisRequest(), environment(exhausted.database), { analyze });
    expect(exhaustedResponse.status).toBe(429);
    expect(await exhaustedResponse.json()).toEqual({ error: "analysis_budget_exceeded" });
    expect(analyze).not.toHaveBeenCalled();

    const broken = createDatabase({ runError: true });
    const brokenResponse = await handleVisionAnalysis(analysisRequest(), environment(broken.database), { analyze });
    expect(brokenResponse.status).toBe(503);
    expect((await brokenResponse.text())).not.toContain("private D1 diagnostic");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("does not repeat a provider request when the same user reuses a request id", async () => {
    const { database } = createDatabase({ reserved: false, duplicate: true });
    const analyze = successfulAnalysis();
    const response = await handleVisionAnalysis(analysisRequest(), environment(database), { analyze });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "duplicate_request" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("keeps provider errors, photos and secrets out of the response", async () => {
    const { database } = createDatabase();
    const analyze = vi.fn(async () => { throw new Error("provider payload includes server-only-test-key and photo bytes"); });
    const response = await handleVisionAnalysis(analysisRequest(), environment(database), { analyze });
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toBe(JSON.stringify({ error: "analysis_failed", request_id: "request_1234567890" }));
    expect(body).not.toContain("server-only-test-key");
    expect(body).not.toContain("/9j");
  });

  it("allows only POST and JSON bodies", async () => {
    const { database } = createDatabase();
    const get = await handleVisionAnalysis(new Request("https://aedjaeger.test/api/vision/analyze"), environment(database));
    const text = await handleVisionAnalysis(analysisRequest({ contentType: "text/plain" }), environment(database));
    const oversized = new Request("https://aedjaeger.test/api/vision/analyze", {
      method: "POST",
      headers: {
        Cookie: `aedjaeger_osm_session=${sessionToken}`,
        Origin: "https://aedjaeger.test",
        "Content-Type": "application/json",
        "Content-Length": String(13 * 1024 * 1024),
      },
      body: "{}",
    });
    const tooLarge = await handleVisionAnalysis(oversized, environment(database));

    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");
    expect(text.status).toBe(415);
    expect(tooLarge.status).toBe(413);
  });
});
