import { importOAuthEncryptionKey } from "../auth/osmOAuth";
import { findOSMSession } from "../storage/osmSessions";
import { findOSMDevelopmentToken } from "../storage/osmDevelopmentTokens";
import type { D1Database } from "../storage/d1";
import { DETAIL_KEYS } from "../../src/contracts/aedDetails";
import { isCrossOrigin, jsonResponse, readCookie } from "../http/requestGuards";
import {
  SESSION_COOKIE, TargetNotFoundError, VersionConflictError, readDevelopmentNode,
} from "./developmentWriteRoute";

type Environment = { DB?: D1Database; OSM_DEV_WRITES_ENABLED?: string; OSM_OAUTH_ENCRYPTION_KEY?: string };
type Dependencies = { fetch?: typeof fetch; now?: () => number; crypto?: Crypto };

/**
 * Welche Tags der Browser zu sehen bekommt: die Detail-Schlüssel (damit das Formular zeigt, was schon eingetragen
 * ist) und das Prüfdatum. Alle anderen Tags des Objekts (zum Beispiel `name`) bleiben auf dem Server. Der Browser
 * braucht sie nicht, und der Server schreibt sie beim Speichern ohnehin unverändert zurück.
 */
const VISIBLE_KEYS: readonly string[] = [...DETAIL_KEYS, "check_date"];

/**
 * Liest EINEN bestehenden AED frisch vom OSM-Testserver (Etappe P4).
 *
 * Warum: Die Umgebungssuche kommt aus einem Archiv, das bis zu fünf Tage alt sein kann und nicht alle Tags enthält.
 * Wer Angaben ergänzen will, muss aber sehen, was GERADE in OSM steht, und braucht die aktuelle Objektversion
 * für den späteren Schreibvorgang. Die Route liest nur; sie ändert nichts.
 *
 * Schutz: nur GET, nur dieselbe Herkunft, nur mit angemeldeter Testserver-Sitzung, die Objektkennung wird streng
 * geprüft (`node/<Zahl>`), und es geht genau ein Lesezugriff an die feste Testserver-Adresse.
 */
export async function handleDevelopmentNodeRead(
  request: Request,
  environment: Environment,
  dependencies: Dependencies = {},
): Promise<Response> {
  if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  const url = new URL(request.url);
  if (isCrossOrigin(request, url.origin)) return jsonResponse({ error: "invalid_origin" }, 403);
  if (environment.OSM_DEV_WRITES_ENABLED !== "true" || !environment.DB || !environment.OSM_OAUTH_ENCRYPTION_KEY) {
    return jsonResponse({ error: "development_write_unavailable" }, 503);
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

  const id = url.searchParams.get("id");
  if (id === null || !/^node\/[1-9]\d{0,15}$/u.test(id)) return jsonResponse({ error: "invalid_request" }, 400);

  let token: string;
  try {
    const key = await importOAuthEncryptionKey(environment.OSM_OAUTH_ENCRYPTION_KEY);
    const storedToken = await findOSMDevelopmentToken(environment.DB, sessionToken, now, key, dependencies.crypto);
    if (!storedToken) return jsonResponse({ error: "development_token_unavailable" }, 401);
    token = storedToken;
  } catch {
    return jsonResponse({ error: "development_write_unavailable" }, 503);
  }

  try {
    const node = await readDevelopmentNode(id, token, dependencies.fetch ?? fetch);
    const tags: Record<string, string> = {};
    for (const key of VISIBLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(node.tags, key)) tags[key] = node.tags[key];
    }
    return jsonResponse({ status: "ok", id, version: node.version, tags }, 200);
  } catch (error) {
    // Gelöscht, verschoben, kein AED mehr oder auf dem Testserver nicht vorhanden (zum Beispiel ein AED aus dem Archiv des
    // echten OSM): Die Person soll neu suchen. Alles andere ist ein Fehler beim Testserver.
    if (error instanceof VersionConflictError || error instanceof TargetNotFoundError) return jsonResponse({ error: "node_unavailable" }, 404);
    return jsonResponse({ error: "development_api_unavailable" }, 502);
  }
}
