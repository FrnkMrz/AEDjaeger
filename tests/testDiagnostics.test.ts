import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTestDiagnostic } from "../server/testDiagnostics";

const endpoint = "https://aedjaeger.test/api/diagnostics";
const validPayload = {
  event: "test_run_started",
  flowId: "3c3df2ad-6e8c-4be0-8aec-95b0f8534621",
};

function diagnosticRequest(payload: unknown, headers: Record<string, string> = {}): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: { Origin: "https://aedjaeger.test", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

describe("opt-in test diagnostics endpoint", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects cross-origin requests without writing a log", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await handleTestDiagnostic(diagnosticRequest(validPayload, { Origin: "https://attacker.example" }));

    expect(response.status).toBe(403);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    { ...validPayload, event: "arbitrary_event" },
    { ...validPayload, flowId: "not-a-uuid" },
    { ...validPayload, photo: "must-not-be-logged" },
  ])("rejects payloads outside the strict event and UUID schema", async (payload) => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await handleTestDiagnostic(diagnosticRequest(payload));

    expect(response.status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });

  it("logs only the approved structured fields for a valid event", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await handleTestDiagnostic(diagnosticRequest(validPayload));

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(log).toHaveBeenCalledOnce();
    const loggedEvent = log.mock.calls[0][0];
    expect(loggedEvent).toEqual({
      source: "aedjaeger-test",
      event: validPayload.event,
      flowId: validPayload.flowId,
      occurredAt: expect.any(String),
    });
    expect(Object.keys(loggedEvent as object).sort()).toEqual(["event", "flowId", "occurredAt", "source"]);
  });

  it("rejects an oversized streamed body even when Content-Length is absent", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(513));
        controller.close();
      },
    });
    const request = new Request(endpoint, {
      method: "POST",
      headers: { Origin: "https://aedjaeger.test", "Content-Type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await handleTestDiagnostic(request);

    expect(request.headers.has("Content-Length")).toBe(false);
    expect(response.status).toBe(413);
    expect(log).not.toHaveBeenCalled();
  });
});
