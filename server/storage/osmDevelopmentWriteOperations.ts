import type { D1Database } from "./d1";

export type OSMDevelopmentWriteState = "started" | "changeset-created" | "uploading" | "uncertain" | "uploaded" | "complete" | "conflict" | "failed";

export type OSMDevelopmentWriteOperation = {
  request_hash: string;
  state: OSMDevelopmentWriteState;
  changeset_id: string | null;
  result_version: number | null;
  result_node_id: string | null;
  updated_at: number;
};

const OPERATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
export const STARTED_OPERATION_STALE_AFTER_MS = 2 * 60 * 1_000;

/** Atomically reserves one write ID for this session before any external OSM request. */
export async function reserveOSMDevelopmentWrite(
  database: D1Database,
  sessionHash: string,
  operationId: string,
  requestHash: string,
  now: number,
): Promise<{ operation: OSMDevelopmentWriteOperation; created: boolean }> {
  if (!isSha256(sessionHash) || !isUuid(operationId) || !isSha256(requestHash) || !isTimestamp(now)) {
    throw new Error("Ungültige OSM-Teständerung.");
  }
  try {
    const cleanup = await database.prepare("DELETE FROM osm_development_write_operations WHERE session_hash = ? AND expires_at <= ?")
      .bind(sessionHash, now).run();
    if (!cleanup.success) throw new Error("D1 cleanup failed");

    const insert = await database.prepare(
      `INSERT OR IGNORE INTO osm_development_write_operations
        (session_hash, operation_id, request_hash, state, changeset_id, result_version, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, 'started', NULL, NULL, ?, ?, ?)`,
    ).bind(sessionHash, operationId, requestHash, now, now, now + OPERATION_LIFETIME_MS).run();
    if (!insert.success) throw new Error("D1 insert failed");

    const operation = await database.prepare(
      `SELECT request_hash, state, changeset_id, result_version, result_node_id, updated_at
       FROM osm_development_write_operations
       WHERE session_hash = ? AND operation_id = ? AND expires_at > ?`,
    ).bind(sessionHash, operationId, now).first<OSMDevelopmentWriteOperation>();
    if (!operation || !isState(operation.state) || (operation.changeset_id !== null && !isPositiveIntegerString(operation.changeset_id))
      || (operation.result_version !== null && (!Number.isSafeInteger(operation.result_version) || operation.result_version <= 0))
      || (operation.result_node_id !== null && !isPositiveIntegerString(operation.result_node_id))
      || !isTimestamp(operation.updated_at)) {
      throw new Error("D1 read failed");
    }
    return { operation, created: insert.meta?.changes === 1 };
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher gespeichert werden.");
  }
}

/**
 * Keep an active pre-upload request from being mistaken for an abandoned one.
 * This compare-and-set also stops a request whose lease was already expired.
 */
export async function touchStartedOSMDevelopmentWrite(
  database: D1Database,
  sessionHash: string,
  operationId: string,
  now: number,
): Promise<boolean> {
  try {
    const result = await database.prepare(
      `UPDATE osm_development_write_operations SET updated_at = ?
       WHERE session_hash = ? AND operation_id = ? AND state = 'started' AND expires_at > ?`,
    ).bind(now, sessionHash, operationId, now).run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher aktualisiert werden.");
  }
}

/** End a pre-upload operation only after its lease expires; the CAS prevents racing a live request. */
export async function failStaleStartedOSMDevelopmentWrite(
  database: D1Database,
  sessionHash: string,
  operationId: string,
  now: number,
): Promise<boolean> {
  try {
    const result = await database.prepare(
      `UPDATE osm_development_write_operations SET state = 'failed', updated_at = ?
       WHERE session_hash = ? AND operation_id = ? AND state = 'started' AND updated_at <= ? AND expires_at > ?`,
    ).bind(now, sessionHash, operationId, now - STARTED_OPERATION_STALE_AFTER_MS, now).run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher abgeschlossen werden.");
  }
}

/** Persist the changeset only if this request still owns the initial `started` operation. */
export async function recordOSMDevelopmentChangeset(
  database: D1Database,
  input: { sessionHash: string; operationId: string; changesetId: string; now: number },
): Promise<boolean> {
  if (!isSha256(input.sessionHash) || !isUuid(input.operationId) || !isPositiveIntegerString(input.changesetId) || !isTimestamp(input.now)) {
    throw new Error("Ungültiger OSM-Testvorgang.");
  }
  try {
    const result = await database.prepare(
      `UPDATE osm_development_write_operations SET state = 'changeset-created', changeset_id = ?, updated_at = ?
       WHERE session_hash = ? AND operation_id = ? AND state = 'started' AND expires_at > ?`,
    ).bind(input.changesetId, input.now, input.sessionHash, input.operationId, input.now).run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher aktualisiert werden.");
  }
}

/** Store a terminal pre-upload outcome without overwriting a stale-operation failure. */
export async function finishStartedOSMDevelopmentWrite(
  database: D1Database,
  input: { sessionHash: string; operationId: string; state: "conflict" | "failed"; now: number },
): Promise<boolean> {
  if (!isSha256(input.sessionHash) || !isUuid(input.operationId) || !isTimestamp(input.now)) {
    throw new Error("Ungültiger OSM-Testvorgang.");
  }
  try {
    const result = await database.prepare(
      `UPDATE osm_development_write_operations SET state = ?, updated_at = ?
       WHERE session_hash = ? AND operation_id = ? AND state = 'started' AND expires_at > ?`,
    ).bind(input.state, input.now, input.sessionHash, input.operationId, input.now).run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher aktualisiert werden.");
  }
}

/** A compare-and-set claim ensures only one concurrent retry can begin the upload. */
export async function claimOSMDevelopmentUpload(
  database: D1Database,
  sessionHash: string,
  operationId: string,
  now: number,
): Promise<boolean> {
  try {
    const result = await database.prepare(
      `UPDATE osm_development_write_operations
       SET state = 'uploading', updated_at = ?
       WHERE session_hash = ? AND operation_id = ? AND state = 'changeset-created' AND expires_at > ?`,
    ).bind(now, sessionHash, operationId, now).run();
    return result.success && result.meta?.changes === 1;
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher aktualisiert werden.");
  }
}

export async function updateOSMDevelopmentWrite(
  database: D1Database,
  input: {
    sessionHash: string;
    operationId: string;
    state: Exclude<OSMDevelopmentWriteState, "started" | "uploading">;
    now: number;
    changesetId?: string;
    resultVersion?: number;
    resultNodeId?: string;
  },
): Promise<void> {
  const { sessionHash, operationId, state, now, changesetId, resultVersion, resultNodeId } = input;
  if (!isSha256(sessionHash) || !isUuid(operationId) || !isState(state) || !isTimestamp(now)
    || (changesetId !== undefined && !isPositiveIntegerString(changesetId))
    || (resultVersion !== undefined && (!Number.isSafeInteger(resultVersion) || resultVersion <= 0))
    || (resultNodeId !== undefined && !isPositiveIntegerString(resultNodeId))) {
    throw new Error("Ungültiger OSM-Testvorgang.");
  }
  try {
    const result = await database.prepare(
      `UPDATE osm_development_write_operations
       SET state = ?, changeset_id = COALESCE(?, changeset_id), result_version = COALESCE(?, result_version), result_node_id = COALESCE(?, result_node_id), updated_at = ?
       WHERE session_hash = ? AND operation_id = ?`,
    ).bind(state, changesetId ?? null, resultVersion ?? null, resultNodeId ?? null, now, sessionHash, operationId).run();
    if (!result.success || result.meta?.changes !== 1) throw new Error("D1 update failed");
  } catch {
    throw new Error("Der OSM-Testvorgang konnte nicht sicher aktualisiert werden.");
  }
}

export async function hashOSMDevelopmentWriteValue(value: string, cryptoApi: Crypto = crypto): Promise<string> {
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isState(value: unknown): value is OSMDevelopmentWriteState {
  return value === "started" || value === "changeset-created" || value === "uploading" || value === "uncertain"
    || value === "uploaded" || value === "complete" || value === "conflict" || value === "failed";
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isPositiveIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,15}$/u.test(value);
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
