import { sha256Hex } from "../crypto/hash";
import type { D1Database } from "./d1";

export type OSMDevelopmentWriteState =
  | "started"
  | "changeset-created"
  | "uploading"
  | "uncertain"
  | "uploaded"
  | "complete"
  | "conflict"
  | "failed";

export type OSMDevelopmentWriteOperation = {
  request_hash: string;
  state: OSMDevelopmentWriteState;
  changeset_id: string | null;
  result_version: number | null;
  result_node_id: string | null;
  updated_at: number;
};

export type OSMDevelopmentWriteOwner = { subject: string; environment: "production" | "development" };

const OPERATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
export const STARTED_OPERATION_STALE_AFTER_MS = 2 * 60 * 1_000;

/** Stable, secret-keyed account identity; operation records survive a browser session rotation without storing the OSM subject. */
export async function hashOSMDevelopmentWriteOwner(
  owner: OSMDevelopmentWriteOwner,
  secret: string,
  cryptoApi: Crypto = crypto,
): Promise<string> {
  if (
    !owner ||
    typeof owner.subject !== "string" ||
    owner.subject.length === 0 ||
    owner.subject.length > 255 ||
    (owner.environment !== "development" && owner.environment !== "production") ||
    typeof secret !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(secret)
  ) {
    throw new Error("Ungültige OSM-Kontobindung.");
  }
  try {
    const keyBytes = decodeBase64Url(secret);
    if (keyBytes.byteLength !== 32) throw new Error("invalid owner key");
    const keyBuffer = new Uint8Array(keyBytes.byteLength);
    keyBuffer.set(keyBytes);
    const key = await cryptoApi.subtle.importKey("raw", keyBuffer.buffer, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    const message = new TextEncoder().encode(`${owner.environment}\u0000${owner.subject}`);
    const messageBuffer = new Uint8Array(message.byteLength);
    messageBuffer.set(message);
    const digest = new Uint8Array(await cryptoApi.subtle.sign("HMAC", key, messageBuffer.buffer));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    throw new Error("Die OSM-Kontobindung konnte nicht sicher abgeleitet werden.");
  }
}

/** Re-key records from the pre-migration session partition before its session row is removed. */
export async function migrateLegacyOSMDevelopmentWriteOwner(
  database: D1Database,
  legacySessionHash: string,
  ownerHash: string,
): Promise<void> {
  if (!isSha256(legacySessionHash) || !isSha256(ownerHash)) throw new Error("Ungültige OSM-Kontobindung.");
  try {
    const result = await database
      .prepare(
        `UPDATE osm_development_write_operations SET owner_hash = ?, legacy_session_hash = NULL
       WHERE legacy_session_hash = ?`,
      )
      .bind(ownerHash, legacySessionHash)
      .run();
    if (!result.success) throw new Error("D1 owner migration failed");
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher an das Konto gebunden werden.");
  }
}

/** Atomically reserves one write ID for this OSM account before any external OSM request. */
export async function reserveOSMDevelopmentWrite(
  database: D1Database,
  ownerHash: string,
  operationId: string,
  requestHash: string,
  now: number,
): Promise<{ operation: OSMDevelopmentWriteOperation; created: boolean }> {
  if (!isSha256(ownerHash) || !isUuid(operationId) || !isSha256(requestHash) || !isTimestamp(now)) {
    throw new Error("Ungültige OSM-Teständerung.");
  }
  try {
    // Expiry cleanup is owner-independent so abandoned accounts do not leave activity rows behind forever.
    const cleanup = await database
      .prepare("DELETE FROM osm_development_write_operations WHERE expires_at <= ?")
      .bind(now)
      .run();
    if (!cleanup.success) throw new Error("D1 cleanup failed");

    const insert = await database
      .prepare(
        `INSERT OR IGNORE INTO osm_development_write_operations
        (owner_hash, operation_id, request_hash, state, changeset_id, result_version, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, 'started', NULL, NULL, ?, ?, ?)`,
      )
      .bind(ownerHash, operationId, requestHash, now, now, now + OPERATION_LIFETIME_MS)
      .run();
    if (!insert.success) throw new Error("D1 insert failed");

    const operation = await database
      .prepare(
        `SELECT request_hash, state, changeset_id, result_version, result_node_id, updated_at
       FROM osm_development_write_operations
       WHERE owner_hash = ? AND operation_id = ? AND expires_at > ?`,
      )
      .bind(ownerHash, operationId, now)
      .first<OSMDevelopmentWriteOperation>();
    if (
      !operation ||
      !isState(operation.state) ||
      (operation.changeset_id !== null && !isPositiveIntegerString(operation.changeset_id)) ||
      (operation.result_version !== null &&
        (!Number.isSafeInteger(operation.result_version) || operation.result_version <= 0)) ||
      (operation.result_node_id !== null && !isPositiveIntegerString(operation.result_node_id)) ||
      !isTimestamp(operation.updated_at)
    ) {
      throw new Error("D1 read failed");
    }
    return { operation, created: insert.meta?.changes === 1 };
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher gespeichert werden.");
  }
}

/** Aufbewahrung von Vorgängen am echten OSM: 90 Tage (Entscheidung vom 26.11.2026). */
export const PRODUCTION_OPERATION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Grenzen für das echte OSM. 20 je Konto und UTC-Tag (Entscheidung vom 26.11.2026) und 5 Änderungen je Objekt in
 * 24 Stunden (Entscheidung vom 27.11.2026: Wer sich vertippt hat, muss es gleich korrigieren können; eine einzige
 * Änderung pro Tag war zu streng).
 */
export type ProductionWriteLimits = { perAccountPerDay: number; perObjectPerWindow: number; perObjectWindowMs: number };
export const PRODUCTION_WRITE_LIMITS: ProductionWriteLimits = {
  perAccountPerDay: 20,
  perObjectPerWindow: 5,
  perObjectWindowMs: DAY_MS,
};

export type ProductionReservation =
  | { kind: "reserved"; operation: OSMDevelopmentWriteOperation; created: boolean }
  | { kind: "limited"; reason: "daily_limit" | "object_recently_changed" };

/**
 * Reserviert einen Schreibvorgang am echten OSM, bevor irgendetwas an OSM geht (Etappe Q3).
 *
 * Ablauf:
 *  1. Gibt es die Vorgangs-ID dieses Kontos schon (Wiederholung nach Netzabbruch), wird sie zurückgegeben. Eine
 *     Wiederholung zählt nie ein zweites Mal gegen die Limits und kann nie einen zweiten Upload auslösen.
 *  2. Sonst legt EINE SQL-Anweisung den Vorgang nur an, wenn beide Grenzen eingehalten sind. Weil Prüfen und Anlegen in
 *     einer einzigen Anweisung stecken, können zwei gleichzeitige Anfragen ein Limit nicht gemeinsam überschreiten.
 *     - je Konto: höchstens `perAccountPerDay` Vorgänge seit Mitternacht UTC,
 *     - je Objekt: höchstens `perObjectPerWindow` Vorgänge am selben Objekt in den letzten 24 Stunden, egal von welchem
 *       Konto. Das bremst einen Änderungskrieg, lässt aber eine schnelle Korrektur eines eigenen Fehlers zu.
 *     Vorgänge, die mit „Konflikt“ oder „fehlgeschlagen“ endeten, haben nichts geändert und zählen nicht.
 */
export async function reserveOSMProductionWrite(
  database: D1Database,
  input: { ownerHash: string; operationId: string; requestHash: string; targetId: string; now: number },
  limits: ProductionWriteLimits = PRODUCTION_WRITE_LIMITS,
): Promise<ProductionReservation> {
  const { ownerHash, operationId, requestHash, targetId, now } = input;
  if (
    !isSha256(ownerHash) ||
    !isUuid(operationId) ||
    !isSha256(requestHash) ||
    !/^node\/[1-9]\d{0,15}$/u.test(targetId) ||
    !isTimestamp(now) ||
    !Number.isSafeInteger(limits.perAccountPerDay) ||
    limits.perAccountPerDay < 1 ||
    !Number.isSafeInteger(limits.perObjectPerWindow) ||
    limits.perObjectPerWindow < 1 ||
    !Number.isSafeInteger(limits.perObjectWindowMs) ||
    limits.perObjectWindowMs < 0
  ) {
    throw new Error("Ungültige OSM-Änderung.");
  }
  try {
    const cleanup = await database
      .prepare("DELETE FROM osm_development_write_operations WHERE expires_at <= ?")
      .bind(now)
      .run();
    if (!cleanup.success) throw new Error("D1 cleanup failed");

    const existing = await readOperation(database, ownerHash, operationId, now);
    if (existing) return { kind: "reserved", operation: existing, created: false };

    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const insert = await database
      .prepare(
        `INSERT OR IGNORE INTO osm_development_write_operations
        (owner_hash, operation_id, request_hash, state, changeset_id, result_version, created_at, updated_at, expires_at,
         osm_environment, target_id)
       SELECT ?, ?, ?, 'started', NULL, NULL, ?, ?, ?, 'production', ?
       WHERE (SELECT COUNT(*) FROM osm_development_write_operations
              WHERE owner_hash = ? AND osm_environment = 'production' AND created_at >= ?
                AND state NOT IN ('failed', 'conflict')) < ?
         AND (SELECT COUNT(*) FROM osm_development_write_operations
              WHERE osm_environment = 'production' AND target_id = ? AND created_at > ?
                AND state NOT IN ('failed', 'conflict')) < ?`,
      )
      .bind(
        ownerHash,
        operationId,
        requestHash,
        now,
        now,
        now + PRODUCTION_OPERATION_LIFETIME_MS,
        targetId,
        ownerHash,
        dayStart,
        limits.perAccountPerDay,
        targetId,
        now - limits.perObjectWindowMs,
        limits.perObjectPerWindow,
      )
      .run();
    if (!insert.success) throw new Error("D1 insert failed");

    const operation = await readOperation(database, ownerHash, operationId, now);
    if (operation) return { kind: "reserved", operation, created: insert.meta?.changes === 1 };

    // Nicht angelegt: Welche Grenze greift? Das Objekt zuerst, weil es die genauere Auskunft ist.
    const recent = await database
      .prepare(
        `SELECT COUNT(*) AS n FROM osm_development_write_operations
       WHERE osm_environment = 'production' AND target_id = ? AND created_at > ? AND state NOT IN ('failed', 'conflict')`,
      )
      .bind(targetId, now - limits.perObjectWindowMs)
      .first<{ n: number }>();
    return {
      kind: "limited",
      reason: (recent?.n ?? 0) >= limits.perObjectPerWindow ? "object_recently_changed" : "daily_limit",
    };
  } catch {
    throw new Error("Der OSM-Vorgang konnte nicht sicher gespeichert werden.");
  }
}

/**
 * Gibt die Reservierung eines Vorgangs am echten OSM wieder frei, der nichts geschrieben hat („schon aktuell“).
 *
 * Warum: Solche Vorgänge ändern OSM nicht und dürfen weder das Tageslimit noch die Grenze je AED verbrauchen. Gelöscht wird
 * nur ein Vorgang, der noch nie ein Changeset hatte und noch am Anfang steht (`started`); einen begonnenen Upload rührt diese
 * Funktion nie an. Eine spätere Wiederholung derselben Vorgangs-ID liest den AED einfach neu.
 */
export async function releaseUnchangedOSMProductionWrite(
  database: D1Database,
  ownerHash: string,
  operationId: string,
): Promise<void> {
  if (!isSha256(ownerHash) || !isUuid(operationId)) throw new Error("Ungültige OSM-Änderung.");
  const result = await database
    .prepare(
      `DELETE FROM osm_development_write_operations
       WHERE owner_hash = ? AND operation_id = ? AND osm_environment = 'production'
         AND state = 'started' AND changeset_id IS NULL`,
    )
    .bind(ownerHash, operationId)
    .run();
  if (!result.success) throw new Error("D1 delete failed");
}

/** Liest einen Vorgang und prüft jede Spalte, bevor ihr Inhalt verwendet wird. */
async function readOperation(
  database: D1Database,
  ownerHash: string,
  operationId: string,
  now: number,
): Promise<OSMDevelopmentWriteOperation | null> {
  const operation = await database
    .prepare(
      `SELECT request_hash, state, changeset_id, result_version, result_node_id, updated_at
     FROM osm_development_write_operations
     WHERE owner_hash = ? AND operation_id = ? AND expires_at > ?`,
    )
    .bind(ownerHash, operationId, now)
    .first<OSMDevelopmentWriteOperation>();
  if (!operation) return null;
  if (
    !isState(operation.state) ||
    (operation.changeset_id !== null && !isPositiveIntegerString(operation.changeset_id)) ||
    (operation.result_version !== null &&
      (!Number.isSafeInteger(operation.result_version) || operation.result_version <= 0)) ||
    (operation.result_node_id !== null && !isPositiveIntegerString(operation.result_node_id)) ||
    !isTimestamp(operation.updated_at)
  ) {
    throw new Error("D1 read failed");
  }
  return operation;
}

/**
 * Keep an active pre-upload request from being mistaken for an abandoned one.
 * This compare-and-set also stops a request whose lease was already expired.
 */
export async function touchStartedOSMDevelopmentWrite(
  database: D1Database,
  ownerHash: string,
  operationId: string,
  now: number,
): Promise<boolean> {
  try {
    const result = await database
      .prepare(
        `UPDATE osm_development_write_operations SET updated_at = ?
       WHERE owner_hash = ? AND operation_id = ? AND state = 'started' AND expires_at > ?`,
      )
      .bind(now, ownerHash, operationId, now)
      .run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher aktualisiert werden.");
  }
}

/** End a pre-upload operation only after its lease expires; the CAS prevents racing a live request. */
export async function failStaleStartedOSMDevelopmentWrite(
  database: D1Database,
  ownerHash: string,
  operationId: string,
  now: number,
): Promise<boolean> {
  try {
    const result = await database
      .prepare(
        `UPDATE osm_development_write_operations SET state = 'failed', updated_at = ?
       WHERE owner_hash = ? AND operation_id = ? AND state = 'started' AND updated_at <= ? AND expires_at > ?`,
      )
      .bind(now, ownerHash, operationId, now - STARTED_OPERATION_STALE_AFTER_MS, now)
      .run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher abgeschlossen werden.");
  }
}

/** Retire an uncertain create only after OSM confirms its changeset is closed and empty. */
export async function failEmptyUncertainOSMDevelopmentWrite(
  database: D1Database,
  input: { ownerHash: string; operationId: string; changesetId: string; now: number },
): Promise<boolean> {
  if (
    !isSha256(input.ownerHash) ||
    !isUuid(input.operationId) ||
    !isPositiveIntegerString(input.changesetId) ||
    !isTimestamp(input.now)
  ) {
    throw new Error("Ungültiger OSM-Testvorgang.");
  }
  try {
    const result = await database
      .prepare(
        `UPDATE osm_development_write_operations SET state = 'failed', updated_at = ?
       WHERE owner_hash = ? AND operation_id = ? AND changeset_id = ? AND state IN ('uploading', 'uncertain') AND expires_at > ?`,
      )
      .bind(input.now, input.ownerHash, input.operationId, input.changesetId, input.now)
      .run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher abgeschlossen werden.");
  }
}

/** Persist the changeset only if this request still owns the initial `started` operation. */
export async function recordOSMDevelopmentChangeset(
  database: D1Database,
  input: { ownerHash: string; operationId: string; changesetId: string; now: number },
): Promise<boolean> {
  if (
    !isSha256(input.ownerHash) ||
    !isUuid(input.operationId) ||
    !isPositiveIntegerString(input.changesetId) ||
    !isTimestamp(input.now)
  ) {
    throw new Error("Ungültiger OSM-Testvorgang.");
  }
  try {
    const result = await database
      .prepare(
        `UPDATE osm_development_write_operations SET state = 'changeset-created', changeset_id = ?, updated_at = ?
       WHERE owner_hash = ? AND operation_id = ? AND state = 'started' AND expires_at > ?`,
      )
      .bind(input.changesetId, input.now, input.ownerHash, input.operationId, input.now)
      .run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher aktualisiert werden.");
  }
}

/** Store a terminal pre-upload outcome without overwriting a stale-operation failure. */
export async function finishStartedOSMDevelopmentWrite(
  database: D1Database,
  input: { ownerHash: string; operationId: string; state: "conflict" | "failed"; now: number },
): Promise<boolean> {
  if (!isSha256(input.ownerHash) || !isUuid(input.operationId) || !isTimestamp(input.now)) {
    throw new Error("Ungültiger OSM-Testvorgang.");
  }
  try {
    const result = await database
      .prepare(
        `UPDATE osm_development_write_operations SET state = ?, updated_at = ?
       WHERE owner_hash = ? AND operation_id = ? AND state = 'started' AND expires_at > ?`,
      )
      .bind(input.state, input.now, input.ownerHash, input.operationId, input.now)
      .run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher aktualisiert werden.");
  }
}

/** A compare-and-set claim ensures only one concurrent retry can begin the upload. */
export async function claimOSMDevelopmentUpload(
  database: D1Database,
  ownerHash: string,
  operationId: string,
  now: number,
): Promise<boolean> {
  try {
    const result = await database
      .prepare(
        `UPDATE osm_development_write_operations
       SET state = 'uploading', updated_at = ?
       WHERE owner_hash = ? AND operation_id = ? AND state = 'changeset-created' AND expires_at > ?`,
      )
      .bind(now, ownerHash, operationId, now)
      .run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher aktualisiert werden.");
  }
}

export async function updateOSMDevelopmentWrite(
  database: D1Database,
  input: {
    ownerHash: string;
    operationId: string;
    state: Exclude<OSMDevelopmentWriteState, "started" | "uploading">;
    now: number;
    changesetId?: string;
    resultVersion?: number;
    resultNodeId?: string;
  },
): Promise<void> {
  const { ownerHash, operationId, state, now, changesetId, resultVersion, resultNodeId } = input;
  if (
    !isSha256(ownerHash) ||
    !isUuid(operationId) ||
    !isState(state) ||
    !isTimestamp(now) ||
    (changesetId !== undefined && !isPositiveIntegerString(changesetId)) ||
    (resultVersion !== undefined && (!Number.isSafeInteger(resultVersion) || resultVersion <= 0)) ||
    (resultNodeId !== undefined && !isPositiveIntegerString(resultNodeId))
  ) {
    throw new Error("Ungültiger OSM-Testvorgang.");
  }
  try {
    const result = await database
      .prepare(
        `UPDATE osm_development_write_operations
       SET state = ?, changeset_id = COALESCE(?, changeset_id), result_version = COALESCE(?, result_version), result_node_id = COALESCE(?, result_node_id), updated_at = ?
       WHERE owner_hash = ? AND operation_id = ?`,
      )
      .bind(state, changesetId ?? null, resultVersion ?? null, resultNodeId ?? null, now, ownerHash, operationId)
      .run();
    if (!result.success || result.meta?.changes !== 1) throw new Error("D1 update failed");
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher aktualisiert werden.");
  }
}

export async function hashOSMDevelopmentWriteValue(value: string, cryptoApi: Crypto = crypto): Promise<string> {
  return sha256Hex(value, cryptoApi);
}

function isState(value: unknown): value is OSMDevelopmentWriteState {
  return (
    value === "started" ||
    value === "changeset-created" ||
    value === "uploading" ||
    value === "uncertain" ||
    value === "uploaded" ||
    value === "complete" ||
    value === "conflict" ||
    value === "failed"
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

function isPositiveIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,15}$/u.test(value);
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function decodeBase64Url(value: string): Uint8Array {
  const binary = atob(`${value.replaceAll("-", "+").replaceAll("_", "/")}=`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
