import { parseVisionObservation, type VisionObservation } from "../contracts/visionObservation";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1_600;
const API_PATH = "/api/vision/analyze";
const REQUEST_TIMEOUT_MS = 35_000;

export type VisionClientErrorCode =
  | "authentication_required"
  | "analysis_not_allowed"
  | "analysis_unavailable"
  | "analysis_budget_unavailable"
  | "session_unavailable"
  | "analysis_budget_exceeded"
  | "invalid_image"
  | "analysis_failed"
  | "invalid_response"
  | "image_too_large"
  | "image_processing_failed";

export class VisionClientError extends Error {
  constructor(readonly code: VisionClientErrorCode) {
    super(code);
    this.name = "VisionClientError";
  }
}

/**
 * Decode and re-encode locally before upload. Canvas output strips EXIF metadata,
 * including GPS coordinates, while resizing bounds the request and provider cost.
 */
export async function preparePhotoForAnalysis(file: File): Promise<Blob> {
  if (file.size > MAX_SOURCE_BYTES) throw new VisionClientError("image_too_large");
  if (!file.type.startsWith("image/")) throw new VisionClientError("invalid_image");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new VisionClientError("invalid_image");

    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new VisionClientError("image_processing_failed");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Re-encoding normalizes accepted browser formats to a MIME type the Worker validates.
    for (const quality of [0.84, 0.7, 0.55]) {
      const jpeg = await canvasToJpeg(canvas, quality);
      if (jpeg.size <= MAX_IMAGE_BYTES) return jpeg;
    }
    throw new VisionClientError("image_too_large");
  } catch (error) {
    if (error instanceof VisionClientError) throw error;
    throw new VisionClientError("image_processing_failed");
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

/** Send one user-requested image and validate the server response at the UI boundary. */
export async function requestVisionObservation(
  image: Blob,
  fetcher: typeof fetch = fetch,
  requestId = createRequestId(),
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<VisionObservation> {
  if (image.type !== "image/jpeg" || image.size === 0 || image.size > MAX_IMAGE_BYTES) {
    throw new VisionClientError(image.size > MAX_IMAGE_BYTES ? "image_too_large" : "invalid_image");
  }

  const imageBase64 = await blobToBase64(image);
  let response: Response;
  let payload: unknown;
  const controller = new AbortController();
  // The server provider call is capped at 25 seconds; this leaves room for the mobile connection.
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetcher(API_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, content_type: "image/jpeg", image_base64: imageBase64 }),
      signal: controller.signal,
    });
    try {
      payload = await response.json();
    } catch {
      throw new VisionClientError("invalid_response");
    }
  } catch (error) {
    // The server may already have reserved a request; callers must not blindly resubmit it.
    if (error instanceof VisionClientError) throw error;
    throw new VisionClientError("analysis_failed");
  } finally {
    globalThis.clearTimeout(timeout);
  }
  if (!response.ok) {
    const errorCode = isRecord(payload) && typeof payload.error === "string" ? payload.error : "";
    switch (errorCode) {
      case "authentication_required": throw new VisionClientError("authentication_required");
      case "analysis_not_allowed": throw new VisionClientError("analysis_not_allowed");
      case "analysis_unavailable": throw new VisionClientError("analysis_unavailable");
      // Budget reservation happens before the provider call, so this exact error is safe to retry.
      case "analysis_budget_unavailable": throw new VisionClientError("analysis_budget_unavailable");
      case "session_unavailable": throw new VisionClientError("session_unavailable");
      case "analysis_budget_exceeded": throw new VisionClientError("analysis_budget_exceeded");
      case "invalid_image": throw new VisionClientError("invalid_image");
      default: throw new VisionClientError("analysis_failed");
    }
  }

  if (!isRecord(payload)
    || Object.keys(payload).length !== 3
    || payload.request_id !== requestId
    || payload.model !== "gpt-6-luna") {
    throw new VisionClientError("invalid_response");
  }
  const observation = parseVisionObservation(payload.observation);
  if (!observation.ok) throw new VisionClientError("invalid_response");
  return observation.value;
}

function createRequestId(): string {
  // The ID only prevents accidental duplicate reservations; it is not a credential.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID().replaceAll("-", "");
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new VisionClientError("image_processing_failed")), "image/jpeg", quality);
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  } catch {
    throw new VisionClientError("image_processing_failed");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
