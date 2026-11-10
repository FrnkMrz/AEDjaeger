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

  describe("failure details for the on-screen error code", () => {
    const fail = async (response: Response | Error): Promise<VisionClientError> => {
      const fetcher = response instanceof Error ? vi.fn<typeof fetch>().mockRejectedValue(response) : vi.fn<typeof fetch>().mockResolvedValue(response);
      try {
        await requestVisionObservation(image, fetcher, "a".repeat(32));
      } catch (error) {
        return error as VisionClientError;
      }
      throw new Error("Der Aufruf hätte fehlschlagen müssen.");
    };
    const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });

    it("names the provider status and code the server reported", async () => {
      const error = await fail(json({ error: "analysis_failed", detail_status: 401, detail_code: "invalid_api_key" }, 502));
      expect(error).toMatchObject({ code: "analysis_failed", detail: "HTTP 502, OpenAI 401, invalid_api_key" });
    });

    it("names a storage problem without a provider status", async () => {
      const error = await fail(json({ error: "analysis_budget_unavailable", detail_code: "missing_table" }, 503));
      expect(error).toMatchObject({ code: "analysis_budget_unavailable", detail: "HTTP 503, missing_table" });
    });

    it("reports a response that is not JSON with its HTTP status", async () => {
      // So sieht ein abgestürzter Worker oder eine Fehlerseite von Cloudflare aus.
      const error = await fail(new Response("<html>Error 1102</html>", { status: 500 }));
      expect(error).toMatchObject({ code: "invalid_response", detail: "HTTP 500" });
    });

    it("tells a client timeout from a lost connection", async () => {
      expect(await fail(new DOMException("aborted", "AbortError"))).toMatchObject({ code: "analysis_failed", detail: "client_timeout" });
      expect(await fail(new TypeError("Load failed"))).toMatchObject({ code: "analysis_failed", detail: "client_network" });
    });

    it("ignores unsafe or out-of-range details from the server", async () => {
      const error = await fail(json({ error: "analysis_failed", detail_status: 99999, detail_code: "<script>alert(1)</script>" }, 502));
      expect(error.detail).toBe("HTTP 502");
      expect(await fail(json({ error: "analysis_failed", detail_status: "401", detail_code: "Has Spaces" }, 502))).toMatchObject({ detail: "HTTP 502" });
    });

    it("says what is wrong with a response that has a good HTTP status", async () => {
      expect(await fail(json({ unexpected: true }, 200))).toMatchObject({ detail: "unexpected_shape" });
      expect(await fail(json({ request_id: "b".repeat(32), model: "gpt-6-luna", observation }, 200))).toMatchObject({ detail: "request_id_mismatch" });
      expect(await fail(json({ request_id: "a".repeat(32), model: "gpt-6-sol", observation }, 200))).toMatchObject({ detail: "model_mismatch:gpt-6-sol" });
      expect(await fail(json({ request_id: "a".repeat(32), model: "gpt-6-luna", observation: { ...observation, scene: "guess" } }, 200))).toMatchObject({ detail: "observation_invalid" });
    });
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
