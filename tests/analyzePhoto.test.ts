import { describe, expect, it, vi } from "vitest";
import { requestVisionObservation, VisionClientError } from "../src/vision/analyzePhoto";

const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
const observation = {
  scene: "device_visible",
  device_count: 1,
  readable_text: ["AED"],
  manufacturer: null,
  model: null,
  location_clues: [],
  image_issues: [],
};

describe("requestVisionObservation", () => {
  it("sends one explicitly requested, same-origin JPEG and validates structured observations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      request_id: "a".repeat(32), model: "gpt-6-luna", observation,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(requestVisionObservation(image, fetcher, "a".repeat(32))).resolves.toEqual(observation);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/vision/analyze");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ request_id: "a".repeat(32), content_type: "image/jpeg" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not accept a model name other than the selected Luna model or malformed observations", async () => {
    const wrongModel = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ model: "gpt-6-sol", observation }), { status: 200 }));
    await expect(requestVisionObservation(image, wrongModel)).rejects.toMatchObject({ code: "invalid_response" });

    const invalidObservation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ model: "gpt-6-luna", observation: { ...observation, scene: "guess" } }), { status: 200 }));
    await expect(requestVisionObservation(image, invalidObservation)).rejects.toMatchObject({ code: "invalid_response" });

    const mismatchedId = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ request_id: "b".repeat(32), model: "gpt-6-luna", observation }), { status: 200 }));
    await expect(requestVisionObservation(image, mismatchedId, "a".repeat(32))).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("maps server authorization and budget failures to controlled errors", async () => {
    const notAllowed = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "analysis_not_allowed" }), { status: 403 }));
    await expect(requestVisionObservation(image, notAllowed)).rejects.toMatchObject({ code: "analysis_not_allowed" });
    const budget = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "analysis_budget_exceeded" }), { status: 429 }));
    await expect(requestVisionObservation(image, budget)).rejects.toMatchObject({ code: "analysis_budget_exceeded" });
    const sessionUnavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "session_unavailable" }), { status: 503 }));
    await expect(requestVisionObservation(image, sessionUnavailable)).rejects.toMatchObject({ code: "session_unavailable" });
    const budgetUnavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "analysis_budget_unavailable" }), { status: 503 }));
    await expect(requestVisionObservation(image, budgetUnavailable)).rejects.toMatchObject({ code: "analysis_budget_unavailable" });
    const claimUncertain = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "analysis_claim_uncertain" }), { status: 503 }));
    await expect(requestVisionObservation(image, claimUncertain)).rejects.toMatchObject({ code: "analysis_claim_uncertain" });
  });

  it("does not retry a network failure because the server may already have reserved the call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("connection lost"));
    await expect(requestVisionObservation(image, fetcher)).rejects.toBeInstanceOf(VisionClientError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled request and reports an ambiguous failure without retrying", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    await expect(requestVisionObservation(image, fetcher, "a".repeat(32), 5)).rejects.toMatchObject({ code: "analysis_failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("rejects files outside the server's image contract before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(requestVisionObservation(new Blob(["bad"], { type: "image/png" }), fetcher)).rejects.toMatchObject({ code: "invalid_image" });
    await expect(requestVisionObservation(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: "image/jpeg" }), fetcher)).rejects.toMatchObject({ code: "image_too_large" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
