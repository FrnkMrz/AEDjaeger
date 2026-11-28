import { APP_VERSION } from "../version";
import { isRecord, readLimitedText } from "../http/requestGuards";
import { requestOSMApi, type OSMApiEnvironment } from "./developmentApi";
import { escapeXml } from "./xmlText";

const MAX_CHANGESET_STATUS_BYTES = 8_192;

/**
 * Öffnet ein Changeset mit App-Version und einem wahrheitsgemäßen, maskierten Kommentar.
 *
 * Beim echten OSM (Entscheidung vom 26.11.2026, Vorbild Hydrantenjäger) kommen dazu:
 *  - `source=survey`: Die Angabe beruht auf einer Prüfung vor Ort. Sie steht nur am Changeset, nie am AED-Objekt.
 *  - `locale`: die Sprache der Person, damit andere Mapper wissen, in welcher Sprache sie nachfragen können.
 * Weitere Tags (Standort, Foto, Konto) gibt es bewusst nicht.
 */
export async function createChangeset(
  token: string,
  comment: string,
  fetcher: typeof fetch,
  options: { environment?: OSMApiEnvironment; locale?: string } = {},
): Promise<string> {
  const environment = options.environment ?? "development";
  const tags: Array<[string, string]> = [
    ["created_by", `AEDjaeger ${APP_VERSION}`],
    ["comment", comment],
  ];
  if (environment === "production") {
    tags.push(["source", "survey"]);
    if (options.locale && /^[a-z]{2}$/u.test(options.locale)) tags.push(["locale", options.locale]);
  }
  const body = `<osm><changeset>${tags.map(([key, value]) => `<tag k="${escapeXml(key)}" v="${escapeXml(value)}"/>`).join("")}</changeset></osm>`;
  const response = await requestOSMApi(
    environment,
    "/api/0.6/changeset/create",
    token,
    { method: "PUT", body },
    fetcher,
  );
  if (!response.ok) throw new Error("OSM changeset could not be opened");
  const id = (await readLimitedText(response, 64)).trim();
  if (!/^[1-9]\d{0,15}$/u.test(id)) throw new Error("Invalid OSM changeset ID");
  return id;
}

/** Close a changeset; a conflict counts as closed only after a matching status read confirms it. */
export async function closeChangeset(
  token: string,
  changesetId: string,
  fetcher: typeof fetch,
  environment: OSMApiEnvironment = "development",
): Promise<boolean> {
  if (!/^[1-9]\d{0,15}$/u.test(changesetId)) return false;
  try {
    const response = await requestOSMApi(
      environment,
      `/api/0.6/changeset/${changesetId}/close`,
      token,
      { method: "PUT" },
      fetcher,
    );
    if (response.ok) return true;
    if (response.status !== 409) return false;
    const status = await requestOSMApi(
      environment,
      `/api/0.6/changeset/${changesetId}`,
      token,
      { method: "GET" },
      fetcher,
    );
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
  return new RegExp(
    `<changeset\\b(?=[^>]*\\bid="${changesetId}"(?=[\\s>]))(?=[^>]*\\bopen="false"(?=[\\s>]))[^>]*\\/?\\s*>`,
    "u",
  ).test(body);
}
