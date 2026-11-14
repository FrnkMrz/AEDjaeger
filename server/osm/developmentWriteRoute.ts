import { importOAuthEncryptionKey } from "../auth/osmOAuth";
import { findOSMSession } from "../storage/osmSessions";
import { findOSMDevelopmentToken } from "../storage/osmDevelopmentTokens";
import {
  claimOSMDevelopmentUpload,
  failEmptyUncertainOSMDevelopmentWrite,
  hashOSMDevelopmentWriteValue,
  reserveOSMDevelopmentWrite,
  updateOSMDevelopmentWrite,
  type OSMDevelopmentWriteOperation,
} from "../storage/osmDevelopmentWriteOperations";
import type { D1Database } from "../storage/d1";
import { requestOSMDevelopmentApi } from "./developmentApi";
import { withoutXmlDeclaration } from "./xmlText";
import { isAcceptableObservationDate } from "./observationDate";
import { validateDetailTags, type DetailTags } from "../../src/contracts/aedDetails";

export const SESSION_COOKIE = "aedjaeger_osm_session";
// Genug Platz für Detailtags auch mit Mehrbyte-Zeichen (Japanisch: 3 Byte je Zeichen); die Längengrenzen des Vertrags
// halten die Anfrage trotzdem klein.
const MAX_BODY_BYTES = 8_192;
const MAX_NODE_BYTES = 64 * 1_024;
const MAX_WRITE_RESPONSE_BYTES = 1_024;
const MAX_CHANGESET_STATUS_BYTES = 8_192;
const MAX_CHANGESET_DOWNLOAD_BYTES = 512 * 1_024;

export type DevelopmentWriteEnvironment = {
  DB?: D1Database;
  OSM_DEV_WRITES_ENABLED?: string;
  /** Betreiber-Schalter (Etappe P5): nur bei "true" darf die Route bestehende Detailwerte ERSETZEN. Standard: aus. */
  OSM_DETAIL_CORRECTIONS_ENABLED?: string;
  OSM_OAUTH_ENCRYPTION_KEY?: string;
};

type Dependencies = { fetch?: typeof fetch; now?: () => number; crypto?: Crypto };

type ConfirmedCheckDate = {
  operation_id: string;
  confirmed: true;
  target: string;
  expected_version?: number;
  expected_check_date: string | null;
  observed_on: string;
  /**
   * Detailtags, die ERGÄNZT werden sollen (Etappe P4, „nur Fehlendes“). Fehlt das Feld, schreibt die Route wie bisher
   * ausschließlich das Prüfdatum. Mit Details ist `expected_version` Pflicht: Die Person hat das Objekt frisch gesehen,
   * und der Server schreibt nur, wenn es seitdem unverändert blieb.
   */
  details?: DetailTags;
  /**
   * Korrekturen (Etappe P5): die alten Werte jener Detailschlüssel, die ersetzt werden sollen, genau so, wie die Person sie
   * gesehen hat. Der Server liest das Objekt vor dem Schreiben neu und schreibt nur, wenn jeder dieser Werte noch genau so
   * dasteht. Alle übrigen Schlüssel in `details` sind Ergänzungen und müssen am Objekt fehlen.
   * Gehört zusammen mit `confirmed_corrections`: Die Person hat ausdrücklich bestätigt, dass der alte Wert nicht stimmt.
   */
  expected_before?: Record<string, string>;
  confirmed_corrections?: true;
};

export type OSMNode = {
  id: number;
  version: number;
  latitude: number;
  longitude: number;
  tags: Record<string, string>;
};

/**
 * Aktualisiert einen bestehenden AED auf dem OSM-Testserver.
 *  - Ohne `details`: ändert ausschließlich `check_date` (Schnellweg „noch vorhanden“).
 *  - Mit `details` (Etappe P4): setzt zusätzlich die genannten Detailtags, aber NUR solche, die am Objekt noch fehlen.
 *    Ist einer davon inzwischen vorhanden, gilt das als Konflikt (409), und die Person prüft neu. Alle übrigen Tags
 *    des Objekts bleiben unverändert. Ersetzen bestehender Werte ist bewusst nicht möglich (das wäre Etappe P5).
 */
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

  // Korrekturen (bestehende Werte ersetzen) erlaubt nur der Betreiber-Schalter. Ohne ihn geschieht nichts: weder eine
  // Reservierung noch ein Lesen oder Schreiben bei OSM.
  if (input.expected_before !== undefined && environment.OSM_DETAIL_CORRECTIONS_ENABLED !== "true") {
    return jsonResponse({ error: "corrections_disabled" }, 403);
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
    if (error instanceof TargetNotFoundError) return jsonResponse({ error: "target_not_found" }, 404);
    return error instanceof VersionConflictError
      ? jsonResponse({ error: "version_conflict" }, 409)
      : jsonResponse({ error: "development_api_unavailable" }, 502);
  }

  if ((input.expected_version !== undefined && currentNode.version !== input.expected_version)
    || (currentNode.tags.check_date ?? null) !== input.expected_check_date
    || currentNode.tags.emergency !== "defibrillator"
    || detailsConflict(currentNode, input)) {
    await safelyUpdate(environment.DB, { sessionHash, operationId: input.operation_id, state: "conflict", now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ error: "version_conflict" }, 409);
  }
  if (input.expected_check_date && input.expected_check_date > input.observed_on) {
    await safelyUpdate(environment.DB, { sessionHash, operationId: input.operation_id, state: "conflict", now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ error: "newer_check_date_exists" }, 409);
  }
  // „Schon aktuell“ gilt nur, wenn es auch keine Detailtags zu schreiben gibt.
  if (currentNode.tags.check_date === input.observed_on && !hasDetails(input)) {
    await safelyUpdate(environment.DB, { sessionHash, operationId: input.operation_id, state: "complete", resultVersion: currentNode.version, now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ status: "complete", version: currentNode.version, already_current: true }, 200);
  }

  let changesetId: string;
  try {
    changesetId = await createChangeset(token, dependencies.fetch ?? fetch, hasCorrections(input) ? "corrections" : hasDetails(input) ? "details" : "none");
  } catch {
    // Without a changeset ID this request cannot upload a map object. Retire it
    // as failed so the same operation ID cannot remain uncertain for a week.
    await safelyUpdate(environment.DB, { sessionHash, operationId: input.operation_id, state: "failed", now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ error: "write_failed" }, 502);
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
  if ((input.expected_version !== undefined && node.version !== input.expected_version) || (node.tags.check_date ?? null) !== input.expected_check_date || node.tags.emergency !== "defibrillator" || detailsConflict(node, input)) {
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "conflict", changesetId: operation.changeset_id, now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ error: "version_conflict" }, 409);
  }

  // Alle bestehenden Tags bleiben; dazu kommen das Prüfdatum und (falls angefragt) die ergänzten Detailtags.
  // Die Reihenfolge ist wichtig: Detailtags können `check_date` und `emergency` nie überschreiben, weil der Vertrag
  // diese Schlüssel nicht enthält.
  const updatedTags = { ...node.tags, check_date: input.observed_on, ...(input.details ?? {}) };
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
  if (!operation.changeset_id) {
    // Older deployments recorded a failed changeset-open request as uncertain.
    // No upload can have been sent without its changeset ID.
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "failed", now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ error: "write_failed" }, 502);
  }
  try {
    // Closing is a barrier: once confirmed, a late upload cannot change the
    // node after the following changeset download has been inspected.
    if (!await closeChangeset(token, operation.changeset_id, dependencies.fetch ?? fetch)) {
      return jsonResponse({ status: "uncertain" }, 202);
    }

    const response = await requestOSMDevelopmentApi("development", `/api/0.6/changeset/${operation.changeset_id}/download`, token, { method: "GET" }, dependencies.fetch ?? fetch);
    if (!response.ok) return jsonResponse({ status: "uncertain" }, 202);
    const body = await readLimitedText(response, MAX_CHANGESET_DOWNLOAD_BYTES);
    const changeset = parseChangesetDownload(body, operation.changeset_id, input.target);
    // An HTTP 200 does not guarantee a complete XML document. Only classify a
    // fully parsed changeset; truncated or malformed downloads stay recoverable.
    if (!changeset) return jsonResponse({ status: "uncertain" }, 202);

    if (changeset.updatedNode && writeAppearsApplied(changeset.updatedNode, input)) {
      const updatedNode = changeset.updatedNode;
      await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "uploaded", changesetId: operation.changeset_id, resultVersion: updatedNode.version, now: (dependencies.now ?? Date.now)() });
      return finishChangeset(database, sessionHash, input.operation_id, { ...operation, state: "uploaded", result_version: updatedNode.version }, token, dependencies);
    }

    if (changeset.empty) {
      const failed = await failEmptyUncertainOSMDevelopmentWrite(database, {
        sessionHash,
        operationId: input.operation_id,
        changesetId: operation.changeset_id,
        now: (dependencies.now ?? Date.now)(),
      });
      return failed
        ? jsonResponse({ error: "write_failed" }, 502)
        : jsonResponse({ status: "pending" }, 202);
    }

    // The closed changeset contains a different or conflicting edit. Keep it
    // terminally blocked instead of inviting another upload with stale data.
    await safelyUpdate(database, { sessionHash, operationId: input.operation_id, state: "conflict", changesetId: operation.changeset_id, now: (dependencies.now ?? Date.now)() });
    return jsonResponse({ error: "version_conflict" }, 409);
  } catch {
    // A lost connection or malformed upstream response keeps the operation blocked.
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

/** Gibt es in dieser Anfrage Detailtags zu schreiben? */
function hasDetails(input: ConfirmedCheckDate): boolean {
  return input.details !== undefined && Object.keys(input.details).length > 0;
}

/**
 * Stimmt der frisch gelesene Stand nicht mehr mit dem überein, was die Person gesehen hat? Dann schreibt der Server nichts
 * (Konflikt), und die Person prüft neu. Es gelten zwei Regeln, je Schlüssel in `details`:
 *  - Ergänzung (nicht in `expected_before`): Der Schlüssel muss am Objekt noch FEHLEN. Hat ihn jemand anderes inzwischen
 *    gesetzt, wird nichts überschrieben (auch ein gleicher Wert zählt; der Fall ist selten und mit Neuprüfen harmlos).
 *  - Korrektur (in `expected_before`): Der Schlüssel muss noch GENAU den Wert haben, den die Person als alt gesehen hat.
 */
function detailsConflict(node: OSMNode, input: ConfirmedCheckDate): boolean {
  const before = input.expected_before ?? {};
  return Object.keys(input.details ?? {}).some((key) => {
    const present = Object.prototype.hasOwnProperty.call(node.tags, key);
    if (Object.prototype.hasOwnProperty.call(before, key)) return !present || node.tags[key] !== before[key];
    return present;
  });
}

/** Enthält die Anfrage Korrekturen (ersetzt sie bestehende Werte)? */
function hasCorrections(input: ConfirmedCheckDate): boolean {
  return input.expected_before !== undefined && Object.keys(input.expected_before).length > 0;
}

/**
 * Nach einem unklaren Upload: Sieht es so aus, als hätte genau diese Anfrage das Objekt geändert?
 *  - Ohne Details: Das Prüfdatum steht auf dem Beobachtungsdatum, war es vorher nicht, und die Version ist neuer.
 *  - Mit Details: Zusätzlich müssen ALLE Detailtags mit genau den angefragten Werten dastehen. Weil das Prüfdatum bereits
 *    vorher gleich gewesen sein kann, zählt hier vor allem die neue Version (sie ist bei Details Pflicht).
 * Im Zweifel bleibt der Vorgang „unklar“ und wird nie blind wiederholt.
 */
function writeAppearsApplied(node: Pick<OSMNode, "version" | "tags">, input: ConfirmedCheckDate): boolean {
  if (node.tags.emergency !== "defibrillator" || node.tags.check_date !== input.observed_on) return false;
  if (hasDetails(input)) {
    return input.expected_version !== undefined && node.version === input.expected_version + 1
      && Object.entries(input.details ?? {}).every(([key, value]) => node.tags[key] === value);
  }
  return input.expected_check_date !== input.observed_on
    && (input.expected_version === undefined || node.version === input.expected_version + 1);
}

export async function readDevelopmentNode(path: string, token: string, fetcher: typeof fetch): Promise<OSMNode> {
  const id = Number(path.slice("node/".length));
  const response = await requestOSMDevelopmentApi("development", `/api/0.6/node/${id}.json`, token, { method: "GET" }, fetcher);
  if (response.status === 409 || response.status === 410) throw new VersionConflictError();
  // 404: Diesen Knoten gibt es auf dem Testserver nicht. Typisch bei einem AED aus dem Archiv des echten OSM: Die
  // Entwicklungsinstanz hat eine eigene, getrennte Datenbank. Das ist ein eindeutiges Ergebnis (nichts wurde geschrieben),
  // kein "unklar" und kein Grund zu wiederholen.
  if (response.status === 404) throw new TargetNotFoundError();
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

async function createChangeset(token: string, fetcher: typeof fetch, kind: "none" | "details" | "corrections" = "none"): Promise<string> {
  // Der Kommentar steht öffentlich im Änderungsverlauf von OSM und sagt ehrlich, was geschah.
  const comment = kind === "corrections" ? "AEDjaeger: AED checked on site, details added and corrected"
    : kind === "details" ? "AEDjaeger: AED checked on site, missing details added"
      : "AEDjaeger: AED presence checked on site";
  const body = `<osm><changeset><tag k="created_by" v="AEDjaeger 0.1.0"/><tag k="comment" v="${comment}"/></changeset></osm>`;
  const response = await requestOSMDevelopmentApi("development", "/api/0.6/changeset/create", token, { method: "PUT", body }, fetcher);
  if (!response.ok) throw new Error("OSM development changeset could not be opened");
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
    const status = await requestOSMDevelopmentApi("development", "/api/0.6/changeset/" + changesetId, token, { method: "GET" }, fetcher);
    if (!status.ok) return false;
    return isChangesetClosed(await readLimitedText(status, MAX_CHANGESET_STATUS_BYTES), changesetId);
  } catch {
    return false;
  }
}

function isChangesetClosed(body: string, changesetId: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed) || !isRecord(parsed.changeset)) return false;
    return String(parsed.changeset.id) === changesetId && parsed.changeset.open === false;
  } catch {
    // The OSM API may return XML instead of JSON.
  }
  return new RegExp("<changeset\\b(?=[^>]*\\bid=\"" + changesetId + "\"(?=[\\s>]))(?=[^>]*\\bopen=\"false\"(?=[\\s>]))[^>]*\\/?\\s*>", "u").test(body);
}

type ParsedChangesetDownload = {
  empty: boolean;
  updatedNode: Pick<OSMNode, "version" | "tags"> | null;
};

/** Parse only the OSM Change XML shape we need, rejecting incomplete XML. */
function parseChangesetDownload(
  value: string,
  changesetId: string,
  target: string,
): ParsedChangesetDownload | null {
  const stack: string[] = [];
  let cursor = 0;
  let sawRoot = false;
  let closedRoot = false;
  let hasObjects = false;
  let declarationSeen = false;
  let capture: { version: number; tags: Record<string, string> } | null = null;
  let updatedNode: Pick<OSMNode, "version" | "tags"> | null = null;
  const targetId = target.slice("node/".length);

  while (cursor < value.length) {
    if (value[cursor] !== "<") {
      const nextTag = value.indexOf("<", cursor);
      const text = value.slice(cursor, nextTag < 0 ? value.length : nextTag);
      if (!/^[\t\n\r ]*$/u.test(text)) return null;
      cursor = nextTag < 0 ? value.length : nextTag;
      continue;
    }

    if (value.startsWith("<!--", cursor)) {
      const end = value.indexOf("-->", cursor + 4);
      const comment = end < 0 ? "" : value.slice(cursor + 4, end);
      if (end < 0 || comment.includes("--") || comment.endsWith("-")) return null;
      cursor = end + 3;
      continue;
    }

    if (value.startsWith("<?", cursor)) {
      const end = value.indexOf("?>", cursor + 2);
      const declaration = end < 0 ? "" : value.slice(cursor, end + 2);
      if (cursor !== 0 || sawRoot || declarationSeen || !/^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?(?:\s+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>$/u.test(declaration)) return null;
      declarationSeen = true;
      cursor = end + 2;
      continue;
    }

    const tagEnd = findXmlTagEnd(value, cursor + 1);
    if (tagEnd < 0) return null;
    const rawTag = value.slice(cursor + 1, tagEnd);
    if (rawTag.startsWith("!")) return null; // No DTD or CDATA in OSM Change responses.

    if (rawTag.startsWith("/")) {
      const closingName = /^\/([A-Za-z_][\w:.-]*)\s*$/u.exec(rawTag)?.[1];
      const openName = stack.pop();
      if (!closingName || openName !== closingName) return null;
      if (closingName === "node" && capture) {
        if (updatedNode) return null;
        updatedNode = { version: capture.version, tags: capture.tags };
        capture = null;
      }
      if (closingName === "osmChange") closedRoot = true;
    } else {
      const parsed = parseXmlStartTag(rawTag);
      if (!parsed) return null;
      const parent = stack.at(-1);
      if (!parent) {
        if (sawRoot || parsed.name !== "osmChange" || parsed.attributes.version !== "0.6") return null;
        sawRoot = true;
      } else if (parent === "osmChange") {
        if (!["create", "modify", "delete"].includes(parsed.name)) return null;
      } else if (["create", "modify", "delete"].includes(parent)) {
        if (!["node", "way", "relation"].includes(parsed.name)) return null;
        hasObjects = true;
        const version = Number(parsed.attributes.version);
        if (parent === "modify" && parsed.name === "node" && parsed.attributes.id === targetId
          && parsed.attributes.changeset === changesetId && /^[1-9]\d{0,15}$/u.test(parsed.attributes.version ?? "")
          && Number.isSafeInteger(version)) {
          capture = { version, tags: {} };
        }
      } else if (["node", "way", "relation"].includes(parent)) {
        const allowed = parsed.name === "tag" || (parent === "way" && parsed.name === "nd") || (parent === "relation" && parsed.name === "member");
        if (!allowed) return null;
        if (parsed.name === "tag" && (!parsed.attributes.k || parsed.attributes.v === undefined)) return null;
        if (parsed.name === "tag" && capture && parent === "node") {
          if (Object.hasOwn(capture.tags, parsed.attributes.k!)) return null;
          capture.tags[parsed.attributes.k!] = parsed.attributes.v!;
        }
      } else {
        return null;
      }
      if (!parsed.selfClosing) stack.push(parsed.name);
      else if (parsed.name === "node" && capture) {
        if (updatedNode) return null;
        updatedNode = { version: capture.version, tags: capture.tags };
        capture = null;
      }
    }
    cursor = tagEnd + 1;
  }

  if (!sawRoot || !closedRoot || stack.length !== 0) return null;
  return { empty: !hasObjects, updatedNode };
}

function findXmlTagEnd(value: string, cursor: number): number {
  let quote: "\"" | "'" | null = null;
  for (let index = cursor; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parseXmlStartTag(value: string): { name: string; attributes: Record<string, string>; selfClosing: boolean } | null {
  const match = /^([A-Za-z_][\w:.-]*)([\s\S]*)$/u.exec(value);
  if (!match) return null;
  const name = match[1];
  let rest = match[2];
  const selfClosing = /\/\s*$/u.test(rest);
  if (selfClosing) rest = rest.replace(/\/\s*$/u, "");
  const attributes: Record<string, string> = {};
  let cursor = 0;
  while (cursor < rest.length) {
    const whitespace = /^\s*/u.exec(rest.slice(cursor))?.[0].length ?? 0;
    cursor += whitespace;
    if (cursor === rest.length) break;
    if (whitespace === 0) return null;
    const attribute = /^([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/u.exec(rest.slice(cursor));
    if (!attribute || Object.hasOwn(attributes, attribute[1])) return null;
    const decoded = decodeXmlAttribute(attribute[3] ?? attribute[4] ?? "");
    if (decoded === null) return null;
    attributes[attribute[1]] = decoded;
    cursor += attribute[0].length;
  }
  return { name, attributes, selfClosing };
}

function decodeXmlAttribute(value: string): string | null {
  const validXmlCharacters = Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
  });
  if (!validXmlCharacters) return null;
  let invalid = false;
  const decoded = value.replace(/&([^;]+);/gu, (_entity, name: string) => {
    if (name === "amp") return "&";
    if (name === "quot") return '"';
    if (name === "apos") return "'";
    if (name === "lt") return "<";
    if (name === "gt") return ">";
    const numeric = /^#(?:x([\da-f]+)|(\d+))$/iu.exec(name);
    if (!numeric) { invalid = true; return ""; }
    const codePoint = numeric[1] ? Number.parseInt(numeric[1], 16) : Number.parseInt(numeric[2], 10);
    const validCodePoint = codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!Number.isInteger(codePoint) || !validCodePoint) {
      invalid = true;
      return "";
    }
    return String.fromCodePoint(codePoint);
  });
  if (invalid || /&(?![^;]+;)/u.test(value) || value.includes("<")) return null;
  return decoded;
}

function buildNodeUpdateChange(node: OSMNode, tags: Record<string, string>, changesetId: string): string {
  const tagXml = Object.entries(tags).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `<tag k="${escapeXml(key)}" v="${escapeXml(value)}"/>`).join("");
  return `<osmChange version="0.6" generator="AEDjaeger"><modify><node id="${node.id}" changeset="${changesetId}" version="${node.version}" lat="${node.latitude}" lon="${node.longitude}">${tagXml}</node></modify></osmChange>`;
}

function parseDiffResult(rawValue: string, expectedNodeId: number): number | null {
  const value = withoutXmlDeclaration(rawValue);
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
  // `details` ist ein optionales zusätzliches Feld. Alle übrigen Felder müssen genau einer der beiden bekannten Formen entsprechen.
  const keysWithoutDetails = isRecord(value) ? Object.keys(value).filter((key) => key !== "details" && key !== "expected_before" && key !== "confirmed_corrections").sort().join(",") : "";
  if (!isRecord(value) || !["confirmed,expected_check_date,expected_version,observed_on,operation_id,target", "confirmed,expected_check_date,observed_on,operation_id,target"].includes(keysWithoutDetails)
    || value.confirmed !== true || typeof value.operation_id !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.operation_id)
    || typeof value.target !== "string" || !/^node\/[1-9]\d{0,15}$/u.test(value.target)
    || (value.expected_version !== undefined && !isPositiveInteger(value.expected_version))
    || !(value.expected_check_date === null || isCalendarDate(value.expected_check_date))
    || !isAcceptableObservationDate(value.observed_on, now)) {
    throw new Error("Invalid request");
  }
  const hasCorrectionFields = "expected_before" in value || "confirmed_corrections" in value;
  if (hasCorrectionFields && !("details" in value)) throw new Error("Invalid request");
  if ("details" in value) {
    // Details brauchen die Version, die die Person gesehen hat, und mindestens ein gültiges Detailtag. Ein leeres
    // Objekt ist ein Fehler: Die App lässt das Feld in diesem Fall einfach weg.
    const checked = validateDetailTags(value.details);
    if (!checked.ok || Object.keys(checked.tags).length === 0 || !isPositiveInteger(value.expected_version)) throw new Error("Invalid request");
    if (hasCorrectionFields) {
      // Korrekturen: beide Felder gehören zusammen. Die Person hat ausdrücklich bestätigt (confirmed_corrections), und die
      // alten Werte gehören zu Schlüsseln, die auch in `details` stehen. Die alten Werte stammen aus OSM und müssen
      // nicht unserem Vertrag entsprechen (zum Beispiel access=permissive); sie dienen nur dem Vergleich und sind darum
      // nur auf Länge und Zeichen geprüft. Ein „Korrektur“ ohne tatsächlichen Unterschied ist ein Fehler.
      const before = value.expected_before;
      if (value.confirmed_corrections !== true || !isStringRecord(before) || Object.keys(before).length === 0
        || Object.entries(before).some(([key, old]) => !(key in checked.tags) || old.length === 0 || /[\x00-\x1f\x7f]/u.test(old) || old.trim() === checked.tags[key as keyof typeof checked.tags])) {
        throw new Error("Invalid request");
      }
      return { ...value, details: checked.tags, expected_before: before } as ConfirmedCheckDate;
    }
    return { ...value, details: checked.tags } as ConfirmedCheckDate;
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

export function isCrossOrigin(request: Request, requestOrigin: string): boolean {
  const origin = request.headers.get("Origin");
  return (origin !== null && origin !== requestOrigin) || request.headers.get("Sec-Fetch-Site") === "cross-site";
}

export function readCookie(header: string | null, name: string): string | null {
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

export function jsonResponse(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...headers },
  });
}

class BodyTooLargeError extends Error {}
export class VersionConflictError extends Error {}
export class TargetNotFoundError extends Error {}
