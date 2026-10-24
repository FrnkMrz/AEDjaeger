import { importOAuthEncryptionKey } from "../auth/osmOAuth";
import { findOSMSession } from "../storage/osmSessions";
import { findOSMDevelopmentToken } from "../storage/osmDevelopmentTokens";
import {
  claimOSMDevelopmentUpload,
  failEmptyUncertainOSMDevelopmentWrite,
  failStaleStartedOSMDevelopmentWrite,
  finishStartedOSMDevelopmentWrite,
  hashOSMDevelopmentWriteValue,
  recordOSMDevelopmentChangeset,
  reserveOSMDevelopmentWrite,
  touchStartedOSMDevelopmentWrite,
  updateOSMDevelopmentWrite,
  type OSMDevelopmentWriteOperation,
} from "../storage/osmDevelopmentWriteOperations";
import type { D1Database } from "../storage/d1";
import { requestOSMDevelopmentApi } from "./developmentApi";

const SESSION_COOKIE = "aedjaeger_osm_session";
const MAX_BODY_BYTES = 2_048;
const MAX_MAP_BYTES = 512 * 1_024;
const MAX_RESPONSE_BYTES = 1_024;

type Environment = { DB?: D1Database; OSM_DEV_WRITES_ENABLED?: string; OSM_OAUTH_ENCRYPTION_KEY?: string };
type Dependencies = { fetch?: typeof fetch; now?: () => number; crypto?: Crypto };
type CreateRequest = {
  operation_id: string;
  confirmed: true;
  latitude: number;
  longitude: number;
  observed_on: string;
  location_description: string | null;
};
/** Creates one confirmed AED node, using only the fixed OSM development API. */
export async function handleDevelopmentCreateNode(
  request: Request,
  environment: Environment,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  const origin = new URL(request.url).origin;
  if (isCrossOrigin(request, origin)) return jsonResponse({ error: "invalid_origin" }, 403);
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

  let input: CreateRequest;
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
  if (operation.state === "conflict") return jsonResponse({ error: "nearby_aed_found" }, 409);
  if (operation.state === "failed") return jsonResponse({ error: "write_failed" }, 422);

  if (!reserved.created) {
    if (operation.state === "uploaded") return finishChangeset(environment.DB, sessionHash, input.operation_id, operation, token, dependencies);
    if (operation.state === "uploading" || operation.state === "uncertain") {
      return reconcileUncertainCreate(environment.DB, sessionHash, input, operation, token, dependencies);
    }
    if (operation.state === "changeset-created") {
      const claimed = await safelyClaimUpload(environment.DB, sessionHash, input.operation_id, (dependencies.now ?? Date.now)());
      if (!claimed) return jsonResponse({ status: "pending" }, 202);
      return uploadCreatedNode(environment.DB, sessionHash, input, operation, token, dependencies);
    }
    if (operation.state === "started") {
      const currentTime = (dependencies.now ?? Date.now)();
      try {
        if (await failStaleStartedOSMDevelopmentWrite(environment.DB, sessionHash, input.operation_id, currentTime)) {
          return jsonResponse({ error: "write_failed" }, 422);
        }
      } catch {
        return jsonResponse({ error: "write_status_unavailable" }, 503);
      }
    }
    return jsonResponse({ status: "pending" }, 202);
  }

  let possibleDuplicate: boolean;
  try {
    possibleDuplicate = await findNearbyAed(input, token, dependencies.fetch ?? fetch);
  } catch {
    await safelyFinishStarted(environment.DB, sessionHash, input.operation_id, "failed", (dependencies.now ?? Date.now)());
    return jsonResponse({ error: "development_api_unavailable" }, 502);
  }
  // If a second request retired this operation while the map lookup was slow,
  // this compare-and-set prevents it from opening a changeset afterwards.
  if (!await safelyTouchStarted(environment.DB, sessionHash, input.operation_id, (dependencies.now ?? Date.now)())) {
    return jsonResponse({ error: "write_failed" }, 422);
  }
  if (possibleDuplicate) {
    const marked = await safelyFinishStarted(environment.DB, sessionHash, input.operation_id, "conflict", (dependencies.now ?? Date.now)());
    return marked ? jsonResponse({ error: "nearby_aed_found" }, 409) : jsonResponse({ error: "write_failed" }, 422);
  }

  let changesetId: string;
  try {
    changesetId = await createChangeset(token, dependencies.fetch ?? fetch);
  } catch {
    // No node upload has started yet, so an empty changeset cannot create a duplicate AED.
    await safelyFinishStarted(environment.DB, sessionHash, input.operation_id, "failed", (dependencies.now ?? Date.now)());
    return jsonResponse({ error: "development_api_unavailable" }, 502);
  }
  let changesetRecorded: boolean;
  try {
    changesetRecorded = await recordOSMDevelopmentChangeset(environment.DB, {
      sessionHash, operationId: input.operation_id, changesetId, now: (dependencies.now ?? Date.now)(),
    });
  } catch {
    // A database error can happen after the update committed. Leave the changeset
    // open so a retry can use it if D1 recorded it; stale `started` rows are
    // retired separately after their lease expires.
    return jsonResponse({ error: "write_status_unavailable" }, 503);
  }
  if (!changesetRecorded) {
    await closeChangeset(token, changesetId, dependencies.fetch ?? fetch);
    return jsonResponse({ error: "write_failed" }, 422);
  }
  const claimed = await safelyClaimUpload(environment.DB, sessionHash, input.operation_id, (dependencies.now ?? Date.now)());
  if (!claimed) return jsonResponse({ status: "pending" }, 202);
  return uploadCreatedNode(environment.DB, sessionHash, input, { ...operation, state: "changeset-created", changeset_id: changesetId }, token, dependencies);
}

async function findNearbyAed(input: CreateRequest, token: string, fetcher: typeof fetch): Promise<boolean> {
  // The browser's earlier Overpass result is useful for the UI but is not trusted
  // to authorize a create. Re-read one small authoritative OSM API box here.
  const latitudePadding = 0.001;
  const longitudePadding = Math.min(0.01, 0.0015 / Math.max(0.1, Math.cos(input.latitude * Math.PI / 180)));
  const response = await requestOSMDevelopmentApi("development", "/api/0.6/map.json", token, {
    method: "GET",
    bbox: {
      west: Math.max(-180, input.longitude - longitudePadding),
      south: Math.max(-90, input.latitude - latitudePadding),
      east: Math.min(180, input.longitude + longitudePadding),
      north: Math.min(90, input.latitude + latitudePadding),
    },
  }, fetcher);
  if (!response.ok) throw new Error("OSM development map check failed");
  let payload: unknown;
  try { payload = JSON.parse(await readLimitedText(response, MAX_MAP_BYTES)); } catch { throw new Error("Invalid OSM map response"); }
  if (!isRecord(payload) || !Array.isArray(payload.elements) || payload.elements.length > 5_000) throw new Error("Incomplete OSM map response");
  for (const element of payload.elements) {
    if (!isRecord(element) || !["node", "way", "relation"].includes(String(element.type))
      || (element.tags !== undefined && !isStringRecord(element.tags))) {
      throw new Error("Invalid OSM map element");
    }
    if (isStringRecord(element.tags) && element.tags.emergency === "defibrillator") return true;
  }
  return false;
}

async function uploadCreatedNode(
  database: D1Database,
  sessionHash: string,
  input: CreateRequest,
  operation: OSMDevelopmentWriteOperation,
  token: string,
  dependencies: Dependencies,
): Promise<Response> {
  if (!operation.changeset_id) return jsonResponse({ status: "pending" }, 202);
  const tags: Record<string, string> = { emergency: "defibrillator", check_date: input.observed_on };
  if (input.location_description !== null) tags["defibrillator:location"] = input.location_description;
  const xml = buildCreateNodeChange(input, tags, operation.changeset_id);
  let response: Response;
  try {
    response = await requestOSMDevelopmentApi("development", `/api/0.6/changeset/${operation.changeset_id}/upload`, token, { method: "POST", body: xml }, dependencies.fetch ?? fetch);
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
  let result: { id: number; version: number } | null;
  try { result = parseCreatedDiff(await readLimitedText(response, MAX_RESPONSE_BYTES)); } catch { result = null; }
  if (!result) {
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "uncertain", changesetId: operation.changeset_id, now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ status: "uncertain" }, 202);
  }
  await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "uploaded", changesetId: operation.changeset_id, resultNodeId: String(result.id), resultVersion: result.version, now: (dependencies.now ?? Date.now)() });
  return finishChangeset(database, sessionHash, input.operation_id, { ...operation, state: "uploaded", result_node_id: String(result.id), result_version: result.version }, token, dependencies);
}

async function reconcileUncertainCreate(
  database: D1Database,
  sessionHash: string,
  input: CreateRequest,
  operation: OSMDevelopmentWriteOperation,
  token: string,
  dependencies: Dependencies,
): Promise<Response> {
  if (!operation.changeset_id) return jsonResponse({ status: "uncertain" }, 202);
  try {
    // Closing the changeset is a barrier: OSM will reject any upload that has
    // not committed yet. We can then inspect a stable snapshot without risking
    // that a late request creates a node after we retire this operation.
    if (!await closeChangeset(token, operation.changeset_id, dependencies.fetch ?? fetch)) {
      return jsonResponse({ status: "uncertain" }, 202);
    }
    const response = await requestOSMDevelopmentApi("development", `/api/0.6/changeset/${operation.changeset_id}/download`, token, { method: "GET" }, dependencies.fetch ?? fetch);
    if (!response.ok) return jsonResponse({ status: "uncertain" }, 202);
    const body = await readLimitedText(response, MAX_MAP_BYTES);
    const result = findCreatedNodeInChangeset(body, operation.changeset_id, input);
    if (!result) {
      if (isEmptyChangesetDownload(body)) {
        const failed = await failEmptyUncertainOSMDevelopmentWrite(database, {
          sessionHash,
          operationId: input.operation_id,
          changesetId: operation.changeset_id,
          now: (dependencies.now ?? Date.now)(),
        });
        if (failed) return jsonResponse({ error: "write_failed" }, 422);
      }
      return jsonResponse({ status: "uncertain" }, 202);
    }
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "uploaded", changesetId: operation.changeset_id, resultNodeId: String(result.id), resultVersion: result.version, now: (dependencies.now ?? Date.now)() });
    return finishChangeset(database, sessionHash, input.operation_id, { ...operation, state: "uploaded", result_node_id: String(result.id), result_version: result.version }, token, dependencies);
  } catch {
    return jsonResponse({ status: "uncertain" }, 202);
  }
}

async function finishChangeset(database: D1Database, sessionHash: string, operationId: string, operation: OSMDevelopmentWriteOperation, token: string, dependencies: Dependencies): Promise<Response> {
  if (!operation.changeset_id || !operation.result_node_id || !operation.result_version) return jsonResponse({ status: "uncertain" }, 202);
  if (!await closeChangeset(token, operation.changeset_id, dependencies.fetch ?? fetch)) return jsonResponse({ status: "uploaded", node_id: operation.result_node_id, version: operation.result_version, close_pending: true }, 202);
  await safelyUpdate(database, { sessionHash, operationId, state: "complete", changesetId: operation.changeset_id, resultNodeId: operation.result_node_id, resultVersion: operation.result_version, now: (dependencies.now ?? Date.now)() });
  return completeResponse(operation);
}

async function createChangeset(token: string, fetcher: typeof fetch): Promise<string> {
  const body = '<osm><changeset><tag k="created_by" v="AEDjaeger 0.1.0"/><tag k="comment" v="AEDjaeger: AED mapped on site"/></changeset></osm>';
  const response = await requestOSMDevelopmentApi("development", "/api/0.6/changeset/create", token, { method: "PUT", body }, fetcher);
  if (!response.ok) throw new Error("OSM changeset could not be opened");
  const id = (await readLimitedText(response, 64)).trim();
  if (!/^[1-9]\d{0,15}$/u.test(id)) throw new Error("Invalid OSM changeset ID");
  return id;
}

async function closeChangeset(token: string, changesetId: string, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await requestOSMDevelopmentApi("development", `/api/0.6/changeset/${changesetId}/close`, token, { method: "PUT" }, fetcher);
    if (response.ok) return true;
    // A 409 can mean either "already closed" or "not owned by this user".
    // Confirm the server's state instead of treating every conflict as success.
    if (response.status !== 409) return false;
    const status = await requestOSMDevelopmentApi("development", `/api/0.6/changeset/${changesetId}`, token, { method: "GET" }, fetcher);
    if (!status.ok) return false;
    const body = await readLimitedText(status, MAX_RESPONSE_BYTES);
    return new RegExp(`<changeset\\b(?=[^>]*\\bid="${changesetId}"(?=[\\s>]))(?=[^>]*\\bopen="false"(?=[\\s>]))[^>]*\\/?\\s*>`, "u").test(body);
  } catch { return false; }
}

/** Distinguish a valid, empty OSM Changeset from malformed or unknown data. */
function isEmptyChangesetDownload(value: string): boolean {
  const withoutDeclaration = value.replace(/^\s*<\?xml\s+version="1\.0"(?:\s+encoding="[^"]+")?\s*\?>\s*/iu, "");
  const root = /^<osmChange\b[^>]*>([\s\S]*)<\/osmChange>\s*$/u.exec(withoutDeclaration);
  if (!root) return false;
  const content = root[1].replace(/<!--([\s\S]*?)-->/gu, "").trim();
  if (!content) return true;
  // The API may serialize the three empty action groups explicitly.
  return content.replace(/<(create|modify|delete)\s*\/\s*>/giu, "")
    .replace(/<(create|modify|delete)\s*>\s*<\/\1\s*>/giu, "").trim().length === 0;
}

function buildCreateNodeChange(input: CreateRequest, tags: Record<string, string>, changesetId: string): string {
  const tagXml = Object.entries(tags).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `<tag k="${escapeXml(key)}" v="${escapeXml(value)}"/>`).join("");
  return `<osmChange version="0.6" generator="AEDjaeger"><create><node id="-1" changeset="${changesetId}" lat="${input.latitude}" lon="${input.longitude}">${tagXml}</node></create></osmChange>`;
}

function parseCreatedDiff(value: string): { id: number; version: number } | null {
  const match = /^\s*<diffResult\b[^>]*>\s*<node\s+old_id="-1"\s+new_id="([1-9]\d*)"\s+new_version="([1-9]\d*)"\s*\/>\s*<\/diffResult>\s*$/u.exec(value);
  if (!match) return null;
  const id = Number(match[1]);
  const version = Number(match[2]);
  return Number.isSafeInteger(id) && Number.isSafeInteger(version) ? { id, version } : null;
}

function findCreatedNodeInChangeset(value: string, changesetId: string, input: CreateRequest): { id: number; version: number } | null {
  const tags: Record<string, string> = { emergency: "defibrillator", check_date: input.observed_on };
  if (input.location_description !== null) tags["defibrillator:location"] = input.location_description;
  for (const match of value.matchAll(/<node\b([^>]*)>([\s\S]*?)<\/node>/gu)) {
    const attributes = parseXmlAttributes(match[1]);
    if (attributes.changeset !== changesetId || !isNumericId(attributes.id) || !isPositiveIntString(attributes.version)
      || !nearNumber(attributes.lat, input.latitude) || !nearNumber(attributes.lon, input.longitude)) continue;
    const actualTags: Record<string, string> = {};
    for (const tag of match[2].matchAll(/<tag\b([^>]*)\/?\s*>/gu)) {
      const tagAttributes = parseXmlAttributes(tag[1]);
      if (typeof tagAttributes.k === "string" && typeof tagAttributes.v === "string") actualTags[tagAttributes.k] = decodeXml(tagAttributes.v);
    }
    if (Object.entries(tags).every(([key, expected]) => actualTags[key] === expected)) {
      return { id: Number(attributes.id), version: Number(attributes.version) };
    }
  }
  return null;
}

function parseXmlAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([a-z_]+)="([^"]*)"/giu)) attributes[match[1]] = match[2];
  return attributes;
}
function decodeXml(value: string): string { return value.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"); }
function nearNumber(value: string | undefined, expected: number): boolean { return value !== undefined && Number.isFinite(Number(value)) && Math.abs(Number(value) - expected) < 0.0000001; }
function isNumericId(value: string | undefined): value is string { return typeof value === "string" && /^[1-9]\d{0,15}$/u.test(value); }
function isPositiveIntString(value: string | undefined): value is string { return typeof value === "string" && /^[1-9]\d{0,15}$/u.test(value); }

function parseRequest(bytes: Uint8Array, now: number): CreateRequest {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new Error("Invalid JSON"); }
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "confirmed,latitude,location_description,longitude,observed_on,operation_id"
    || value.confirmed !== true || typeof value.operation_id !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.operation_id)
    || typeof value.latitude !== "number" || !Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90
    || typeof value.longitude !== "number" || !Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180
    || !isCalendarDate(value.observed_on) || Math.abs(Date.parse(`${value.observed_on}T12:00:00.000Z`) - now) > 24 * 60 * 60 * 1_000
    || !(value.location_description === null || (typeof value.location_description === "string" && value.location_description.trim().length > 0
      && value.location_description.trim().length <= 160 && !/[\u0000-\u001f\u007f]/u.test(value.location_description)))) {
    throw new Error("Invalid request");
  }
  return { ...value, location_description: typeof value.location_description === "string" ? value.location_description.trim() : null } as CreateRequest;
}

function isCalendarDate(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false; const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function isStringRecord(value: unknown): value is Record<string, string> { return isRecord(value) && Object.keys(value).length <= 512 && Object.entries(value).every(([key, text]) => key.length > 0 && key.length <= 255 && typeof text === "string" && text.length <= 255); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function escapeXml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function isCrossOrigin(request: Request, origin: string): boolean { const requestOrigin = request.headers.get("Origin"); return (requestOrigin !== null && requestOrigin !== origin) || request.headers.get("Sec-Fetch-Site") === "cross-site"; }
function readCookie(header: string | null, name: string): string | null { if (!header || header.length > 8_192) return null; const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`)); if (values.length !== 1) return null; const value = values[0].slice(name.length + 1); return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null; }
async function readLimitedBody(request: Request | Response, maximum: number): Promise<Uint8Array> { const length = request.headers.get("Content-Length"); if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum)) throw new BodyTooLargeError(); if (!request.body) return new Uint8Array(); const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0; try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maximum) { await reader.cancel().catch(() => undefined); throw new BodyTooLargeError(); } chunks.push(value); } } finally { reader.releaseLock(); } const body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; } return body; }
async function readLimitedText(response: Response, maximum: number): Promise<string> { return new TextDecoder("utf-8", { fatal: true }).decode(await readLimitedBody(response, maximum)); }
async function safelyClaimUpload(database: D1Database, sessionHash: string, operationId: string, now: number): Promise<boolean> { try { return await claimOSMDevelopmentUpload(database, sessionHash, operationId, now); } catch { return false; } }
async function safelyTouchStarted(database: D1Database, sessionHash: string, operationId: string, now: number): Promise<boolean> { try { return await touchStartedOSMDevelopmentWrite(database, sessionHash, operationId, now); } catch { return false; } }
async function safelyFinishStarted(database: D1Database, sessionHash: string, operationId: string, state: "conflict" | "failed", now: number): Promise<boolean> { try { return await finishStartedOSMDevelopmentWrite(database, { sessionHash, operationId, state, now }); } catch { return false; } }
async function safelyUpdate(database: D1Database, input: Parameters<typeof updateOSMDevelopmentWrite>[1]): Promise<void> { try { await updateOSMDevelopmentWrite(database, input); } catch { /* Keep database internals out of user-facing errors. */ } }
function completeResponse(operation: OSMDevelopmentWriteOperation): Response { return jsonResponse({ status: "complete", node_id: operation.result_node_id, version: operation.result_version }, 200); }
function jsonResponse(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}): Response { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...headers } }); }
class BodyTooLargeError extends Error {}
