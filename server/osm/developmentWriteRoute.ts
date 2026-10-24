import { importOAuthEncryptionKey } from "../auth/osmOAuth";
import { findOSMSession } from "../storage/osmSessions";
import { findOSMDevelopmentToken } from "../storage/osmDevelopmentTokens";
import {
  claimOSMDevelopmentUpload,
  hashOSMDevelopmentWriteValue,
  reserveOSMDevelopmentWrite,
  updateOSMDevelopmentWrite,
  type OSMDevelopmentWriteOperation,
} from "../storage/osmDevelopmentWriteOperations";
import type { D1Database } from "../storage/d1";
import { requestOSMDevelopmentApi } from "./developmentApi";

const SESSION_COOKIE = "aedjaeger_osm_session";
const MAX_BODY_BYTES = 2_048;
const MAX_NODE_BYTES = 64 * 1_024;
const MAX_WRITE_RESPONSE_BYTES = 1_024;

export type DevelopmentWriteEnvironment = {
  DB?: D1Database;
  OSM_DEV_WRITES_ENABLED?: string;
  OSM_OAUTH_ENCRYPTION_KEY?: string;
};

type Dependencies = { fetch?: typeof fetch; now?: () => number; crypto?: Crypto };

type ConfirmedCheckDate = {
  operation_id: string;
  confirmed: true;
  target: string;
  expected_version: number;
  expected_check_date: string | null;
  observed_on: string;
};

type OSMNode = {
  id: number;
  version: number;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
};

/** Updates only check_date on an existing OSM development-server node. */
export async function handleDevelopmentCheckDate(
  request: Request,
  environment: DevelopmentWriteEnvironment,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  const requestUrl = new URL(request.url);
  if (isCrossOrigin(request, requestUrl.origin)) return jsonResponse({ error: "invalid_origin" }, 403);
  if (environment.OSM_DEV_WRITES_ENABLED !== "true" || !environment.DB || !environment.OSM_OAUTH_ENCRYPTION_KEY) {
    return jsonResponse({ error: "development_write_unavailable" }, 503);
  }
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return jsonResponse({ error: "unsupported_media_type" }, 415);
  }

  const sessionToken = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!sessionToken) return jsonResponse({ error: "authentication_required" }, 401);
  const now = (dependencies.now ?? Date.now)();
  let session: { subject: string; environment: "production" | "development" } | null;
  try {
    session = await findOSMSession(environment.DB, sessionToken, now, dependencies.crypto);
  } catch {
    return jsonResponse({ error: "session_unavailable" }, 503);
  }
  if (!session || session.environment !== "development") return jsonResponse({ error: "development_session_required" }, 403);

  let input: ConfirmedCheckDate;
  try {
    input = parseRequest(await readLimitedBody(request, MAX_BODY_BYTES), now);
  } catch (error) {
    return jsonResponse({ error: error instanceof BodyTooLargeError ? "request_too_large" : "invalid_request" }, error instanceof BodyTooLargeError ? 413 : 400);
  }

  let token: string;
  let sessionHash: string;
  let requestHash: string;
  try {
    const key = await importOAuthEncryptionKey(environment.OSM_OAUTH_ENCRYPTION_KEY);
    const storedToken = await findOSMDevelopmentToken(environment.DB, sessionToken, now, key, dependencies.crypto);
    if (!storedToken) return jsonResponse({ error: "development_token_unavailable" }, 401);
    token = storedToken;
    sessionHash = await hashOSMDevelopmentWriteValue(sessionToken, dependencies.crypto);
    requestHash = await hashOSMDevelopmentWriteValue(JSON.stringify(input), dependencies.crypto);
  } catch {
    return jsonResponse({ error: "development_write_unavailable" }, 503);
  }

  let reserved: Awaited<ReturnType<typeof reserveOSMDevelopmentWrite>>;
  try {
    reserved = await reserveOSMDevelopmentWrite(environment.DB, sessionHash, input.operation_id, requestHash, now);
  } catch {
    return jsonResponse({ error: "write_status_unavailable" }, 503);
  }
  const operation = reserved.operation;
  if (operation.request_hash !== requestHash) return jsonResponse({ error: "operation_id_conflict" }, 409);
  if (operation.state === "complete") return completeResponse(operation);
  if (operation.state === "conflict") return jsonResponse({ error: "version_conflict" }, 409);
  if (operation.state === "failed") return jsonResponse({ error: "write_failed" }, 502);

  if (!reserved.created) {
    if (operation.state === "uploaded") return finishChangeset(environment.DB, sessionHash, input.operation_id, operation, token, dependencies);
    if (operation.state === "uploading" || operation.state === "uncertain") {
      return reconcileUncertainWrite(environment.DB, sessionHash, input, operation, token, dependencies);
    }
    if (operation.state === "changeset-created") {
      const claimed = await safelyClaimUpload(environment.DB, sessionHash, input.operation_id, (dependencies.now ?? Date.now)());
      if (!claimed) return jsonResponse({ status: "pending" }, 202);
      return uploadNodeChange(environment.DB, sessionHash, input, operation, token, dependencies);
    }
    // A request that vanished during its initial read cannot be safely replayed
    // automatically; this prevents a late retry from opening a second changeset.
    return jsonResponse({ status: "pending" }, 202);
  }

  let currentNode: OSMNode;
  try {
    currentNode = await readDevelopmentNode(input.target, token, dependencies.fetch ?? fetch);
  } catch (error) {
    const state = error instanceof VersionConflictError ? "conflict" : "failed";
    await safelyUpdate(environment.DB, { sessionHash, operationId: input.operation_id, state, now: (dependencies.now ?? Date.now)() });
    return error instanceof VersionConflictError
      ? jsonResponse({ error: "version_conflict" }, 409)
      : jsonResponse({ error: "development_api_unavailable" }, 502);
  }

  if (currentNode.version !== input.expected_version
    || (currentNode.tags.check_date ?? null) !== input.expected_check_date
    || currentNode.tags.emergency !== "defibrillator") {
    await safelyUpdate(environment.DB, { sessionHash, operationId: input.operation_id, state: "conflict", now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ error: "version_conflict" }, 409);
  }
  if (input.expected_check_date && input.expected_check_date > input.observed_on) {
    await safelyUpdate(environment.DB, { sessionHash, operationId: input.operation_id, state: "conflict", now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ error: "newer_check_date_exists" }, 409);
  }
  if (currentNode.tags.check_date === input.observed_on) {
    await safelyUpdate(environment.DB, { sessionHash, operationId: input.operation_id, state: "complete", resultVersion: currentNode.version, now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ status: "complete", version: currentNode.version, already_current: true }, 200);
  }

  let changesetId: string;
  try {
    changesetId = await createChangeset(token, dependencies.fetch ?? fetch);
  } catch {
    await safelyUpdate(environment.DB, { sessionHash, operationId: input.operation_id, state: "uncertain", now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ status: "uncertain" }, 202);
  }
  try {
    await updateOSMDevelopmentWrite(environment.DB, {
      sessionHash, operationId: input.operation_id, state: "changeset-created", changesetId, now: (dependencies.now ?? Date.now)(),
    });
  } catch {
    // An empty changeset may remain open, but no map object has been sent.
    return jsonResponse({ error: "write_status_unavailable" }, 503);
  }

  const claimed = await safelyClaimUpload(environment.DB, sessionHash, input.operation_id, (dependencies.now ?? Date.now)());
  if (!claimed) return jsonResponse({ status: "pending" }, 202);
  const changeset = { ...operation, state: "changeset-created" as const, changeset_id: changesetId };
  return uploadNodeChange(environment.DB, sessionHash, input, changeset, token, dependencies, currentNode);
}

async function uploadNodeChange(
  database: D1Database,
  sessionHash: string,
  input: ConfirmedCheckDate,
  operation: OSMDevelopmentWriteOperation,
  token: string,
  dependencies: Dependencies,
  knownNode?: OSMNode,
): Promise<Response> {
  if (!operation.changeset_id) return jsonResponse({ status: "pending" }, 202);
  let node = knownNode;
  try {
    node ??= await readDevelopmentNode(input.target, token, dependencies.fetch ?? fetch);
  } catch (error) {
    const state = error instanceof VersionConflictError ? "conflict" : "failed";
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state, changesetId: operation.changeset_id, now: (dependencies.now ?? Date.now)() });
    return error instanceof VersionConflictError ? jsonResponse({ error: "version_conflict" }, 409) : jsonResponse({ error: "development_api_unavailable" }, 502);
  }
  if (node.version !== input.expected_version || (node.tags.check_date ?? null) !== input.expected_check_date || node.tags.emergency !== "defibrillator") {
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "conflict", changesetId: operation.changeset_id, now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ error: "version_conflict" }, 409);
  }

  const updatedTags = { ...node.tags, check_date: input.observed_on };
  let response: Response;
  try {
    const xml = buildNodeUpdateChange(node, updatedTags, operation.changeset_id);
    response = await requestOSMDevelopmentApi("development", `/api/0.6/changeset/${operation.changeset_id}/upload`, token, {
      method: "POST", body: xml,
    }, dependencies.fetch ?? fetch);
  } catch {
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "uncertain", changesetId: operation.changeset_id, now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ status: "uncertain" }, 202);
  }

  if (response.status === 409) {
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "conflict", changesetId: operation.changeset_id, now: (dependencies.now ?? Date.now)() });
    await closeChangeset(token, operation.changeset_id, dependencies.fetch ?? fetch);
    return jsonResponse({ error: "version_conflict" }, 409);
  }
  if (!response.ok) {
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: response.status >= 500 ? "uncertain" : "failed", changesetId: operation.changeset_id, now: (dependencies.now ?? Date.now)() });
    if (response.status < 500) await closeChangeset(token, operation.changeset_id, dependencies.fetch ?? fetch);
    return response.status >= 500 ? jsonResponse({ status: "uncertain" }, 202) : jsonResponse({ error: "write_failed" }, 502);
  }

  let version: number | null;
  try {
    version = parseDiffResult(await readLimitedText(response, MAX_WRITE_RESPONSE_BYTES), node.id);
  } catch {
    version = null;
  }
  if (version === null) {
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "uncertain", changesetId: operation.changeset_id, now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ status: "uncertain" }, 202);
  }

  // Save the acknowledged object version before closing. A close failure may
  // never cause the edit upload to be repeated.
  await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "uploaded", changesetId: operation.changeset_id, resultVersion: version, now: (dependencies.now ?? Date.now)() });
  return finishChangeset(database, sessionHash, input.operation_id, { ...operation, state: "uploaded", result_version: version }, token, dependencies);
}

async function reconcileUncertainWrite(
  database: D1Database,
  sessionHash: string,
  input: ConfirmedCheckDate,
  operation: OSMDevelopmentWriteOperation,
  token: string,
  dependencies: Dependencies,
): Promise<Response> {
  if (!operation.changeset_id) return jsonResponse({ status: "uncertain" }, 202);
  try {
    const node = await readDevelopmentNode(input.target, token, dependencies.fetch ?? fetch);
    if (node.version > input.expected_version && node.tags.check_date === input.observed_on) {
      await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "uploaded", changesetId: operation.changeset_id, resultVersion: node.version, now: (dependencies.now ?? Date.now)() });
      return finishChangeset(database, sessionHash, input.operation_id, { ...operation, state: "uploaded", result_version: node.version }, token, dependencies);
    }
  } catch {
    // A lost connection or untrusted upstream response keeps the operation blocked.
  }
  return jsonResponse({ status: "uncertain" }, 202);
}

async function finishChangeset(
  database: D1Database,
  sessionHash: string,
  operationId: string,
  operation: OSMDevelopmentWriteOperation,
  token: string,
  dependencies: Dependencies,
): Promise<Response> {
  if (!operation.changeset_id) return jsonResponse({ status: "uncertain" }, 202);
  if (await closeChangeset(token, operation.changeset_id, dependencies.fetch ?? fetch)) {
    await safelyUpdate(database, { sessionHash, operationId, state: "complete", changesetId: operation.changeset_id, resultVersion: operation.result_version ?? undefined, now: (dependencies.now ?? Date.now)() });
    return completeResponse({ ...operation, state: "complete" });
  }
  return jsonResponse({ status: "uploaded", close_pending: true, version: operation.result_version }, 202);
}

async function readDevelopmentNode(path: string, token: string, fetcher: typeof fetch): Promise<OSMNode> {
  const id = Number(path.slice("node/".length));
  const response = await requestOSMDevelopmentApi("development", `/api/0.6/node/${id}.json`, token, { method: "GET" }, fetcher);
  if (response.status === 409 || response.status === 410) throw new VersionConflictError();
  if (!response.ok) throw new Error("OSM development read failed");
  let payload: unknown;
  try {
    payload = JSON.parse(await readLimitedText(response, MAX_NODE_BYTES));
  } catch {
    throw new Error("Invalid OSM node response");
  }
  if (!isRecord(payload) || !Array.isArray(payload.elements) || payload.elements.length !== 1) throw new Error("Invalid OSM node response");
  const element = payload.elements[0];
  if (!isRecord(element) || element.type !== "node" || element.id !== id || !isPositiveInteger(element.version)
    || typeof element.lat !== "number" || !Number.isFinite(element.lat) || element.lat < -90 || element.lat > 90
    || typeof element.lon !== "number" || !Number.isFinite(element.lon) || element.lon < -180 || element.lon > 180
    || !isStringRecord(element.tags) || element.tags.emergency !== "defibrillator") {
    throw new Error("Invalid or unsupported OSM node response");
  }
  return { id, version: element.version, latitude: element.lat, longitude: element.lon, tags: element.tags };
}

async function createChangeset(token: string, fetcher: typeof fetch): Promise<string> {
  const body = '<osm><changeset><tag k="created_by" v="AEDjaeger 0.1.0"/><tag k="comment" v="AEDjaeger: AED presence checked on site"/></changeset></osm>';
  const response = await requestOSMDevelopmentApi("development", "/api/0.6/changeset/create", token, { method: "PUT", body }, fetcher);
  if (!response.ok) throw new Error("OSM development changeset could not be opened");
  const id = (await readLimitedText(response, 64)).trim();
  if (!/^[1-9]\d{0,15}$/u.test(id)) throw new Error("Invalid OSM changeset ID");
  return id;
}

async function closeChangeset(token: string, changesetId: string, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await requestOSMDevelopmentApi("development", `/api/0.6/changeset/${changesetId}/close`, token, { method: "PUT" }, fetcher);
    return response.ok || response.status === 409;
  } catch {
    return false;
  }
}

function buildNodeUpdateChange(node: OSMNode, tags: Record<string, string>, changesetId: string): string {
  const tagXml = Object.entries(tags).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `<tag k="${escapeXml(key)}" v="${escapeXml(value)}"/>`).join("");
  return `<osmChange version="0.6" generator="AEDjaeger"><modify><node id="${node.id}" changeset="${changesetId}" version="${node.version}" lat="${node.latitude}" lon="${node.longitude}">${tagXml}</node></modify></osmChange>`;
}

function parseDiffResult(value: string, expectedNodeId: number): number | null {
  const match = /^\s*<diffResult\b[^>]*>\s*<node\s+old_id="(\d+)"\s+new_id="(\d+)"\s+new_version="(\d+)"\s*\/>\s*<\/diffResult>\s*$/u.exec(value);
  if (!match || Number(match[1]) !== expectedNodeId || Number(match[2]) !== expectedNodeId) return null;
  const version = Number(match[3]);
  return isPositiveInteger(version) ? version : null;
}

function parseRequest(bytes: Uint8Array, now: number): ConfirmedCheckDate {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Invalid JSON");
  }
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "confirmed,expected_check_date,expected_version,observed_on,operation_id,target"
    || value.confirmed !== true || typeof value.operation_id !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.operation_id)
    || typeof value.target !== "string" || !/^node\/[1-9]\d{0,15}$/u.test(value.target)
    || !isPositiveInteger(value.expected_version)
    || !(value.expected_check_date === null || isCalendarDate(value.expected_check_date))
    || !isCalendarDate(value.observed_on)
    || Math.abs(Date.parse(`${value.observed_on}T12:00:00.000Z`) - now) > 24 * 60 * 60 * 1_000) {
    throw new Error("Invalid request");
  }
  return value as ConfirmedCheckDate;
}

async function readLimitedBody(request: Request | Response, maxBytes: number): Promise<Uint8Array> {
  const length = request.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maxBytes)) throw new BodyTooLargeError();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const body = await readLimitedBody(response, maxBytes);
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length > 512) return false;
  return Object.entries(value).every(([key, text]) => key.length > 0 && [...key].length <= 255
    && typeof text === "string" && [...text].length <= 255 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(key + text));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function isCrossOrigin(request: Request, requestOrigin: string): boolean {
  const origin = request.headers.get("Origin");
  return (origin !== null && origin !== requestOrigin) || request.headers.get("Sec-Fetch-Site") === "cross-site";
}

function readCookie(header: string | null, name: string): string | null {
  if (!header || header.length > 8_192) return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}

async function safelyClaimUpload(database: D1Database, sessionHash: string, operationId: string, now: number): Promise<boolean> {
  try { return await claimOSMDevelopmentUpload(database, sessionHash, operationId, now); } catch { return false; }
}

async function safelyUpdate(database: D1Database, input: Parameters<typeof updateOSMDevelopmentWrite>[1]): Promise<void> {
  try { await updateOSMDevelopmentWrite(database, input); } catch { /* Keep upstream and storage details out of the HTTP error. */ }
}

function completeResponse(operation: OSMDevelopmentWriteOperation): Response {
  return jsonResponse({ status: "complete", version: operation.result_version }, 200);
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...headers },
  });
}

class BodyTooLargeError extends Error {}
class VersionConflictError extends Error {}
