/**
 * Provider-independent boundary for image-model observations.
 *
 * These fields describe what a model claims to see. They are not trusted facts,
 * OSM tags, or permission to create/update an object.
 */
export const VISION_SCENES = [
  "device_visible",
  "enclosure_visible",
  "sign_only",
  "empty_holder",
  "multiple_devices",
  "other_object",
  "unclear",
] as const;

export const IMAGE_ISSUES = ["blurry", "dark", "glare", "occluded", "cropped"] as const;

export interface VisionObservation {
  scene: (typeof VISION_SCENES)[number];
  // Count visually identifiable AED devices, not signs or cabinets.
  device_count: number;
  readable_text: string[];
  manufacturer: string | null;
  model: string | null;
  location_clues: string[];
  image_issues: (typeof IMAGE_ISSUES)[number][];
}

export type VisionObservationParseResult =
  | { ok: true; value: VisionObservation }
  | { ok: false; reason: "invalid-shape" };

const MAX_DEVICE_COUNT = 10;
const MAX_TEXT_LENGTH = 160;
const MAX_LABEL_LENGTH = 80;
const MAX_READABLE_TEXT_ITEMS = 12;
const MAX_LOCATION_CLUES = 8;
const MAX_IMAGE_ISSUES = 5;
const EXPECTED_KEYS = [
  "scene",
  "device_count",
  "readable_text",
  "manufacturer",
  "model",
  "location_clues",
  "image_issues",
];

/**
 * The scene and visible-device count must agree for clear classes. "unclear"
 * leaves the count unconstrained because the image itself is ambiguous.
 */
function isConsistentSceneCount(scene: VisionObservation["scene"], count: number): boolean {
  switch (scene) {
    case "device_visible":
      return count === 1;
    case "multiple_devices":
      return count >= 2;
    case "enclosure_visible":
    case "sign_only":
    case "empty_holder":
    case "other_object":
      return count === 0;
    case "unclear":
      return true;
  }
}

/** Accept only bounded plain text; callers must still render it as untrusted text. */
function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximumLength
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isDenseArray(value: unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) return false;
  }
  return true;
}

function isTextList(value: unknown, maxItems: number, maxItemLength: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && isDenseArray(value)
    && value.every((item) => isBoundedText(item, maxItemLength));
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}

/**
 * Validates an unknown provider response at the trust boundary.
 * Unknown keys are rejected so a provider cannot silently introduce new fields
 * that downstream code might accidentally treat as instructions or OSM edits.
 */
export function parseVisionObservation(input: unknown): VisionObservationParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "invalid-shape" };
  }

  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== EXPECTED_KEYS.length || keys.some((key) => !EXPECTED_KEYS.includes(key))) {
    return { ok: false, reason: "invalid-shape" };
  }

  if (
    !isOneOf(record.scene, VISION_SCENES)
    || typeof record.device_count !== "number"
    || !Number.isInteger(record.device_count)
    || record.device_count < 0
    || record.device_count > MAX_DEVICE_COUNT
    || !isConsistentSceneCount(record.scene, record.device_count)
    || !isTextList(record.readable_text, MAX_READABLE_TEXT_ITEMS, MAX_TEXT_LENGTH)
    || !(record.manufacturer === null || isBoundedText(record.manufacturer, MAX_LABEL_LENGTH))
    || !(record.model === null || isBoundedText(record.model, MAX_LABEL_LENGTH))
    || !isTextList(record.location_clues, MAX_LOCATION_CLUES, MAX_TEXT_LENGTH)
    || !Array.isArray(record.image_issues)
    || record.image_issues.length > MAX_IMAGE_ISSUES
    || !isDenseArray(record.image_issues)
    || !record.image_issues.every((issue) => isOneOf(issue, IMAGE_ISSUES))
  ) {
    return { ok: false, reason: "invalid-shape" };
  }

  return {
    ok: true,
    value: {
      scene: record.scene,
      device_count: record.device_count,
      readable_text: record.readable_text,
      manufacturer: record.manufacturer,
      model: record.model,
      location_clues: record.location_clues,
      image_issues: record.image_issues,
    },
  };
}
