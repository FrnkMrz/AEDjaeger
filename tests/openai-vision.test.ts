import { describe, expect, it, vi } from "vitest";
import type { VisionObservation } from "../src/contracts/visionObservation";
import { analyzeAedPhoto, OPENAI_VISION_MODEL, VisionAnalysisError } from "../server/vision/openai";

const validObservation: VisionObservation = {
  scene: "device_visible",
  device_count: 1,
  readable_text: ["HeartSave AS"],
  manufacturer: null,
  model: "HeartSave AS",
  location_clues: [],
  image_issues: [],
};

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function providerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function outputResponse(value: unknown): Response {
  return providerResponse({
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  });
}

describe("server-side GPT-6 Luna vision adapter", () => {
  it("sends one validated image to the fixed model and returns only observations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(outputResponse(validObservation));
    const result = await analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", fetcher);

    expect(result).toEqual(validObservation);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer test-secret");

    const body = JSON.parse(String(request?.body));
    expect(body.model).toBe("gpt-6-luna");
    expect(body.model).toBe(OPENAI_VISION_MODEL);
    expect(body.store).toBe(false);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.schema.properties.scene.enum).toContain("multiple_devices");
    expect(body.input[1].content[1].type).toBe("input_image");
  });

  it("rejects missing secrets and invalid image bytes before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "  ", fetcher)).rejects.toMatchObject({
      code: "missing_secret",
    });
    await expect(analyzeAedPhoto({ bytes: jpeg, contentType: "image/png" }, "test-secret", fetcher)).rejects.toMatchObject({
      code: "invalid_image",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects provider output that does not match the observation schema", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(outputResponse({ ...validObservation, osm_tags: { emergency: "defibrillator" } }));

    await expect(analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", fetcher)).rejects.toBeInstanceOf(
      VisionAnalysisError,
    );
  });

  it("rejects contradictory subject and device-count observations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      outputResponse({ ...validObservation, scene: "sign_only", device_count: 1 }),
    );

    await expect(analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", fetcher)).rejects.toMatchObject({
      code: "invalid_provider_response",
    });
  });

  it("does not expose provider error details to callers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(providerResponse({ error: { message: "secret and request content" } }, 500));

    await expect(analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", fetcher)).rejects.toMatchObject({
      code: "provider_error",
      message: "Die Bildanalyse ist vorübergehend fehlgeschlagen.",
    });
  });
});
