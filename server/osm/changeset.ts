import { APP_VERSION } from "../version";
import { isRecord, readLimitedText } from "../http/requestGuards";
import { requestOSMDevelopmentApi } from "./developmentApi";
import { escapeXml } from "./xmlText";

const MAX_CHANGESET_STATUS_BYTES = 8_192;

/** Open a changeset with the app version and a truthful, escaped public comment. */
export async function createChangeset(token: string, comment: string, fetcher: typeof fetch): Promise<string> {
  const createdBy = escapeXml(`AEDjaeger ${APP_VERSION}`);
  const body = `<osm><changeset><tag k="created_by" v="${createdBy}"/><tag k="comment" v="${escapeXml(comment)}"/></changeset></osm>`;
  const response = await requestOSMDevelopmentApi("development", "/api/0.6/changeset/create", token, { method: "PUT", body }, fetcher);
  if (!response.ok) throw new Error("OSM changeset could not be opened");
  const id = (await readLimitedText(response, 64)).trim();
  if (!/^[1-9]\d{0,15}$/u.test(id)) throw new Error("Invalid OSM changeset ID");
  return id;
}

/** Close a changeset; a conflict counts as closed only after a matching status read confirms it. */
export async function closeChangeset(token: string, changesetId: string, fetcher: typeof fetch): Promise<boolean> {
  if (!/^[1-9]\d{0,15}$/u.test(changesetId)) return false;
  try {
    const response = await requestOSMDevelopmentApi("development", `/api/0.6/changeset/${changesetId}/close`, token, { method: "PUT" }, fetcher);
    if (response.ok) return true;
    if (response.status !== 409) return false;
    const status = await requestOSMDevelopmentApi("development", `/api/0.6/changeset/${changesetId}`, token, { method: "GET" }, fetcher);
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
  return new RegExp(`<changeset\\b(?=[^>]*\\bid="${changesetId}"(?=[\\s>]))(?=[^>]*\\bopen="false"(?=[\\s>]))[^>]*\\/?\\s*>`, "u").test(body);
}
