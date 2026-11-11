import { IMAGE_ISSUES, OBSERVATION_KEYS, OBSERVATION_LIMITS, VISION_SCENES } from "../../src/contracts/visionObservation";

/**
 * Bereitet die Antwort des Bildmodells auf, bevor die strenge Prüfung sie sieht.
 *
 * Warum? Die Fotoprüfung ist ein Filter: Entscheidend ist allein `scene` („AED sichtbar“ oder nicht).
 * Die Nebenfelder (lesbarer Text, Hersteller, Lagehinweise, Zählung) beeinflussen den Ablauf nicht.
 * Ein Zeilenumbruch in einem Textfragment oder eine widersprüchliche Zählung darf deshalb nicht den
 * ganzen Vorgang scheitern lassen. Im Handytest hat genau das ein Foto mit viel Etikettentext und mehreren
 * Geräten auf dem Tisch zu „schema_mismatch“ gemacht.
 *
 * Was hier bewusst NICHT passiert: Unbekannte oder fehlende Felder, ein ungültiger `scene`-Wert und ein
 * Wert falschen Typs werden nicht repariert. Sie gehen unverändert an die strenge Prüfung und lassen den
 * Vorgang scheitern, damit der Anbieter keine neuen Felder einschmuggeln kann, die später jemand für
 * Anweisungen oder OSM-Änderungen halten könnte.
 */
export function normalizeProviderObservation(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const keys = Object.keys(input);
  if (keys.length !== OBSERVATION_KEYS.length || keys.some((key) => !(OBSERVATION_KEYS as readonly string[]).includes(key))) return input;

  const normalized: Record<string, unknown> = {
    scene: input.scene,
    device_count: normalizeDeviceCount(input.device_count),
    readable_text: normalizeTextList(input.readable_text, OBSERVATION_LIMITS.readableTextItems, OBSERVATION_LIMITS.textLength),
    manufacturer: normalizeLabel(input.manufacturer),
    model: normalizeLabel(input.model),
    location_clues: normalizeTextList(input.location_clues, OBSERVATION_LIMITS.locationClues, OBSERVATION_LIMITS.textLength),
    image_issues: normalizeImageIssues(input.image_issues),
  };
  reconcileSceneAndCount(normalized);
  return normalized;
}

/** Wandelt Steuerzeichen und Zeilenumbrüche in Leerzeichen um und kürzt auf die erlaubte Länge. */
function cleanText(value: string, maximumLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximumLength).trim();
}

function normalizeTextList(value: unknown, maximumItems: number, maximumLength: number): unknown {
  if (!Array.isArray(value)) return value;
  // Leere und nicht-textliche Einträge fallen weg, überzählige Einträge werden abgeschnitten.
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanText(item, maximumLength))
    .filter((item) => item.length > 0)
    .slice(0, maximumItems);
}

function normalizeLabel(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const cleaned = cleanText(value, OBSERVATION_LIMITS.labelLength);
  // Ein leerer Hersteller oder ein leeres Modell bedeutet „nicht lesbar“.
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeImageIssues(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const allowed = value.filter((issue): issue is (typeof IMAGE_ISSUES)[number] => typeof issue === "string" && (IMAGE_ISSUES as readonly string[]).includes(issue));
  return [...new Set(allowed)].slice(0, OBSERVATION_LIMITS.imageIssues);
}

function normalizeDeviceCount(value: unknown): unknown {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(Math.max(value, 0), OBSERVATION_LIMITS.deviceCount) : value;
}

/**
 * Gleicht `scene` und `device_count` ab. Die Szene gilt, denn nur sie steuert den Ablauf; die Zählung
 * ist eine Zusatzangabe. Typischer Fall: Auf dem Foto liegen eine Steckdose und Kopfhörer, das Modell meldet
 * „anderer Gegenstand“ und zählt trotzdem zwei Geräte. Gezählt werden sollen nur AED, deshalb gilt hier 0.
 */
function reconcileSceneAndCount(observation: Record<string, unknown>): void {
  const scene = observation.scene;
  const count = observation.device_count;
  if (typeof count !== "number" || !Number.isInteger(count) || typeof scene !== "string" || !(VISION_SCENES as readonly string[]).includes(scene)) return;

  if (scene === "device_visible" || scene === "multiple_devices") {
    if (count >= 2) observation.scene = "multiple_devices";
    else if (count === 1) observation.scene = "device_visible";
    else observation.device_count = scene === "multiple_devices" ? 2 : 1;
  } else if (scene !== "unclear") {
    observation.device_count = 0;
  }
}

/**
 * Nennt als feste Kennung, welches Feld die strenge Prüfung nach der Aufbereitung noch ablehnt.
 * So zeigt ein Fehlercode im Pilot, was der Anbieter geliefert hat, ohne dessen Inhalt preiszugeben.
 */
export function explainObservationMismatch(input: unknown): string {
  if (!isRecord(input)) return "schema_not_an_object";
  const keys = Object.keys(input);
  if (keys.length !== OBSERVATION_KEYS.length || keys.some((key) => !(OBSERVATION_KEYS as readonly string[]).includes(key))) return "schema_unexpected_keys";
  if (typeof input.scene !== "string" || !(VISION_SCENES as readonly string[]).includes(input.scene)) return "schema_invalid_scene";
  if (typeof input.device_count !== "number" || !Number.isInteger(input.device_count)) return "schema_invalid_count";
  if (!Array.isArray(input.readable_text)) return "schema_invalid_text_list";
  if (!(input.manufacturer === null || typeof input.manufacturer === "string") || !(input.model === null || typeof input.model === "string")) return "schema_invalid_label";
  if (!Array.isArray(input.location_clues)) return "schema_invalid_clues";
  if (!Array.isArray(input.image_issues)) return "schema_invalid_issues";
  return "schema_mismatch";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
