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

// A tiny but structurally complete JPEG container keeps provider tests offline.
const jpeg = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  0x00, 0xff, 0xd9,
]);

function pngChunk(type: string, data: number[]): number[] {
  const typeAndData = [...type].map((character) => character.charCodeAt(0)).concat(data);
  let crc = 0xffffffff;
  for (const byte of typeAndData) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const checksum = (crc ^ 0xffffffff) >>> 0;
  const length = data.length;
  return [length >>> 24, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff, ...typeAndData,
    (checksum >>> 24) & 0xff, (checksum >>> 16) & 0xff, (checksum >>> 8) & 0xff, checksum & 0xff];
}

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ...pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
  ...pngChunk("IDAT", [0]),
  ...pngChunk("IEND", []),
]);

const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20, 0x0a, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00,
]);

function providerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function outputResponse(value: unknown, status = "completed"): Response {
  return providerResponse({
    status,
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
    expect(body.max_output_tokens).toBe(2_000);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.schema.properties.scene.enum).toContain("multiple_devices");
    expect(body.text.format.schema.properties.readable_text.maxItems).toBe(4);
    expect(body.text.format.schema.properties.readable_text.items.minLength).toBe(1);
    expect(body.text.format.schema.properties.readable_text.items.pattern).toBe("\\S");
    expect(body.text.format.schema.properties.readable_text.items.maxLength).toBe(60);
    expect(body.text.format.schema.properties.manufacturer.anyOf[0].minLength).toBe(1);
    expect(body.text.format.schema.properties.manufacturer.anyOf[0].pattern).toBe("\\S");
    expect(body.text.format.schema.properties.model.anyOf[0].minLength).toBe(1);
    expect(body.text.format.schema.properties.model.anyOf[0].pattern).toBe("\\S");
    expect(body.text.format.schema.properties.location_clues.maxItems).toBe(3);
    expect(body.text.format.schema.properties.location_clues.items.maxLength).toBe(40);
    expect(body.text.format.schema.properties.location_clues.items.pattern).toBe("\\S");
    expect(body.input[0].content).toContain("ein als AED-Gehäuse erkennbarer Kasten, auch wenn das Gerät darin nicht sichtbar ist");
    expect(body.input[0].content).toContain("eine eindeutig leere Halterung");
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

  it.each([
    ["JPEG", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b])],
    ["PNG", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["WebP", "image/webp", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])],
  ])("rejects truncated %s containers before calling the provider", async (_format, contentType, bytes) => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(analyzeAedPhoto({ bytes, contentType }, "test-secret", fetcher)).rejects.toMatchObject({ code: "invalid_image" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["JPEG", "image/jpeg", jpeg],
    ["PNG", "image/png", png],
    ["WebP", "image/webp", webp],
  ])("accepts a complete %s container", async (_format, contentType, bytes) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(outputResponse(validObservation));

    await expect(analyzeAedPhoto({ bytes, contentType }, "test-secret", fetcher)).resolves.toEqual(validObservation);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects PNGs with excessive chunk counts before calling the provider", async () => {
    const chunks = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
      ...pngChunk("IDAT", [0]),
    ];
    for (let index = 0; index < 4_097; index += 1) chunks.push(...pngChunk("tEXt", []));
    chunks.push(...pngChunk("IEND", []));
    const fetcher = vi.fn<typeof fetch>();

    await expect(analyzeAedPhoto({ bytes: new Uint8Array(chunks), contentType: "image/png" }, "test-secret", fetcher)).rejects.toMatchObject({ code: "invalid_image" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects JPEG and WebP containers with excessive segment counts before calling the provider", async () => {
    const jpegSegments = [0xff, 0xd8];
    for (let index = 0; index < 4_097; index += 1) jpegSegments.push(0xff, 0xe0, 0x00, 0x02);

    const webpChunks = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
    for (let index = 0; index < 4_097; index += 1) webpChunks.push(0x4a, 0x55, 0x4e, 0x4b, 0x00, 0x00, 0x00, 0x00);
    webpChunks.push(0x56, 0x50, 0x38, 0x20, 0x0a, 0, 0, 0, 0, 0, 0, 0x9d, 1, 0x2a, 1, 0, 1, 0);
    const riffSize = webpChunks.length - 8;
    webpChunks[4] = riffSize & 0xff;
    webpChunks[5] = (riffSize >>> 8) & 0xff;
    webpChunks[6] = (riffSize >>> 16) & 0xff;
    webpChunks[7] = (riffSize >>> 24) & 0xff;

    const fetcher = vi.fn<typeof fetch>();
    await expect(analyzeAedPhoto({ bytes: new Uint8Array(jpegSegments), contentType: "image/jpeg" }, "test-secret", fetcher)).rejects.toMatchObject({ code: "invalid_image" });
    await expect(analyzeAedPhoto({ bytes: new Uint8Array(webpChunks), contentType: "image/webp" }, "test-secret", fetcher)).rejects.toMatchObject({ code: "invalid_image" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects provider output that does not match the observation schema", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(outputResponse({ ...validObservation, osm_tags: { emergency: "defibrillator" } }));

    await expect(analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", fetcher)).rejects.toBeInstanceOf(
      VisionAnalysisError,
    );
  });

  it("treats a whitespace-only label as unreadable instead of failing the whole check", async () => {
    // Früher scheiterte der Vorgang hier. Für den Filter zählt nur die Szene; ein leeres Etikett heißt „nicht lesbar“.
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(outputResponse({ ...validObservation, manufacturer: "   " }));
    await expect(analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", fetcher)).resolves.toMatchObject({ scene: "device_visible", manufacturer: null });
  });

  it.each([null, { status: "completed", output: {} }, { status: "completed", output: [{ type: "message", content: {} }] }])(
    "normalizes malformed successful provider responses (%s)",
    async (providerBody) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(providerResponse(providerBody));

      await expect(analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", fetcher)).rejects.toMatchObject({
        code: "invalid_provider_response",
      });
    },
  );

  it("rejects incomplete provider responses even when their text matches the schema", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(outputResponse(validObservation, "incomplete"));

    await expect(analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", fetcher)).rejects.toMatchObject({
      code: "invalid_provider_response",
      message: "Die Bildanalyse wurde nicht vollständig abgeschlossen.",
    });
  });

  it("lets the scene decide when the device count contradicts it", async () => {
    // Auf dem Foto liegen andere Geräte: Die Szene „nur Schild“ gilt, gezählt werden nur AED, also 0.
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(outputResponse({ ...validObservation, scene: "sign_only", device_count: 1 }));
    await expect(analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", fetcher)).resolves.toMatchObject({ scene: "sign_only", device_count: 0 });
  });

  describe("failure details for diagnosis", () => {
    // Gibt den geworfenen Fehler zurück. Ein Aufruf, der unerwartet gelingt, lässt den Test fehlschlagen.
    const call = async (fetcher: typeof fetch): Promise<VisionAnalysisError> => {
      try {
        await analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", fetcher);
      } catch (error) {
        return error as VisionAnalysisError;
      }
      throw new Error("Der Aufruf hätte fehlschlagen müssen.");
    };

    it("keeps only the HTTP status and a safe error code from a provider error", async () => {
      const error = await call(vi.fn<typeof fetch>().mockResolvedValue(providerResponse({ error: { code: "invalid_api_key", type: "invalid_request_error", message: "Incorrect API key provided: sk-secret-value" } }, 401)));
      expect(error.detail).toEqual({ providerStatus: 401, providerCode: "invalid_api_key" });
      // Die Fehlermeldung des Anbieters wird nie gelesen und taucht nirgends auf.
      expect(JSON.stringify([error.message, error.detail])).not.toContain("sk-secret-value");
    });

    it("falls back to the error type and to the status alone", async () => {
      const typeOnly = await call(vi.fn<typeof fetch>().mockResolvedValue(providerResponse({ error: { type: "insufficient_quota", message: "x" } }, 429)));
      expect(typeOnly.detail).toEqual({ providerStatus: 429, providerCode: "insufficient_quota" });
      const notJson = await call(vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 })));
      expect(notJson.detail).toEqual({ providerStatus: 502, providerCode: undefined });
    });

    it.each([
      ["a sentence", "Incorrect API key provided"],
      ["an upper-case token", "INVALID_API_KEY"],
      ["a key-like value", "sk-proj-abcdef0123456789"],
      ["an overlong value", "a".repeat(49)],
      ["a non-string value", 42],
    ])("drops %s instead of passing it on", async (_name, code) => {
      const error = await call(vi.fn<typeof fetch>().mockResolvedValue(providerResponse({ error: { code, type: code } }, 400)));
      expect(error.detail.providerCode).toBeUndefined();
    });

    it("tells a timeout from other network failures", async () => {
      const timeout = await call(vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
      expect(timeout.detail).toEqual({ providerCode: "timeout" });
      const network = await call(vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")));
      expect(network.detail).toEqual({ providerCode: "network_error" });
    });

    it("names why a successful HTTP response was still unusable", async () => {
      const incomplete = await call(vi.fn<typeof fetch>().mockResolvedValue(providerResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })));
      expect(incomplete.detail.providerCode).toBe("incomplete_max_output_tokens");
      const noOutput = await call(vi.fn<typeof fetch>().mockResolvedValue(providerResponse({ status: "completed", output: [] })));
      expect(noOutput.detail.providerCode).toBe("no_output");
      const badJson = await call(vi.fn<typeof fetch>().mockResolvedValue(providerResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }] })));
      expect(badJson.detail.providerCode).toBe("invalid_json");
      // Felder fehlen: Das Modell hat die vorgegebene Form nicht eingehalten.
      const wrongShape = await call(vi.fn<typeof fetch>().mockResolvedValue(outputResponse({ scene: "guess" })));
      expect(wrongShape.detail.providerCode).toBe("schema_unexpected_keys");
      // Alle Felder da, aber ein Szenenwert, den es nicht gibt.
      const wrongScene = await call(vi.fn<typeof fetch>().mockResolvedValue(outputResponse({ ...validObservation, scene: "guess" })));
      expect(wrongScene.detail.providerCode).toBe("schema_invalid_scene");
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
