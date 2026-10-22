import { buildOSMAuthorizationUrl, createOAuthSecret, createPkceTransaction, importOAuthEncryptionKey, validateOSMAuthorizationCallback } from "./auth/osmOAuth";
import { exchangeOSMCodeForIdentity } from "./auth/osmOidc";
import type { D1Database } from "./storage/d1";
import { consumeOSMOAuthTransaction, storeOSMOAuthTransaction } from "./storage/osmOAuthTransactions";
import { deleteOSMSession, findOSMSession, rotateOSMSession } from "./storage/osmSessions";
import { handleVisionAnalysis } from "./vision/analyzeRoute";

type StaticAssets = { fetch(request: Request): Promise<Response> };
type WorkerEnvironment = {
  ASSETS: StaticAssets;
  DB?: D1Database;
  OSM_CLIENT_ID?: string;
  OSM_REDIRECT_URI?: string;
  OSM_OAUTH_ENCRYPTION_KEY?: string;
  OPENAI_API_KEY?: string;
  AI_ANALYSIS_ENABLED?: string;
  AI_ANALYSIS_COST_RESERVATION_MICROS?: string;
  AI_ANALYSIS_USER_DAILY_LIMIT_MICROS?: string;
  AI_ANALYSIS_GLOBAL_DAILY_LIMIT_MICROS?: string;
};

const AUTH_COOKIE = "aedjaeger_osm_auth";
const SESSION_COOKIE = "aedjaeger_osm_session";

/** Cloudflare entry point for the PWA, OSM login, and health endpoint. */
const worker = {
  async fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") {
      if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET" });
      return jsonResponse({ status: "ok" }, 200);
    }
    if (pathname === "/api/auth/osm/start") {
      if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET" });
      return startOSMLogin(request, environment);
    }
    if (pathname === "/api/auth/osm/callback") {
      if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET" });
      return finishOSMLogin(request, environment);
    }
    if (pathname === "/api/auth/session") {
      if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET" });
      return getSession(request, environment);
    }
    if (pathname === "/api/auth/logout") {
      if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "POST" });
      return logout(request, environment);
    }
    if (pathname === "/api/vision/analyze") return handleVisionAnalysis(request, environment);
    if (pathname === "/api" || pathname.startsWith("/api/")) return jsonResponse({ error: "not_found" }, 404);
    return environment.ASSETS.fetch(request);
  },
};

async function startOSMLogin(request: Request, environment: WorkerEnvironment): Promise<Response> {
  const configuration = getAuthConfiguration(environment);
  if (!configuration || !environment.DB) return authUnavailable();
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== new URL(configuration.redirectUri).origin) return jsonResponse({ error: "invalid_origin" }, 400);

  try {
    const transaction = await createPkceTransaction();
    const browserBinding = createOAuthSecret();
    const key = await importOAuthEncryptionKey(configuration.encryptionKey);
    await storeOSMOAuthTransaction(environment.DB, { ...transaction, browserBinding, createdAt: Date.now() }, key);
    const authorizationUrl = buildOSMAuthorizationUrl({
      clientId: configuration.clientId,
      redirectUri: configuration.redirectUri,
      transaction,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizationUrl.toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Set-Cookie": buildCookie(AUTH_COOKIE, browserBinding, 10 * 60, requestUrl.protocol === "https:"),
      },
    });
  } catch {
    return authUnavailable();
  }
}

async function finishOSMLogin(request: Request, environment: WorkerEnvironment): Promise<Response> {
  const configuration = getAuthConfiguration(environment);
  if (!configuration || !environment.DB) return authUnavailable();
  const callbackUrl = new URL(request.url);
  if (callbackUrl.origin !== new URL(configuration.redirectUri).origin) return loginFailure(callbackUrl.protocol === "https:");
  const states = callbackUrl.searchParams.getAll("state");
  const browserBinding = readCookie(request.headers.get("Cookie"), AUTH_COOKIE);
  if (states.length !== 1 || !browserBinding) return loginFailure(callbackUrl.protocol === "https:");

  try {
    const key = await importOAuthEncryptionKey(configuration.encryptionKey);
    // Löschen vor dem Codeaustausch macht den Callback auch bei parallelen Requests einmalig.
    const transaction = await consumeOSMOAuthTransaction(environment.DB, states[0], browserBinding, Date.now(), key);
    if (!transaction) return loginFailure(callbackUrl.protocol === "https:");
    const callback = validateOSMAuthorizationCallback(callbackUrl, states[0]);
    if (!callback.ok) return loginFailure(callbackUrl.protocol === "https:");

    const identity = await exchangeOSMCodeForIdentity({
      code: callback.code,
      verifier: transaction.verifier,
      nonce: transaction.nonce,
      clientId: configuration.clientId,
      redirectUri: configuration.redirectUri,
    });
    const sessionToken = createOAuthSecret();
    // Die alte Sitzung wird widerrufen, bevor der neue Sitzungstoken ausgegeben wird.
    await rotateOSMSession(
      environment.DB,
      readCookie(request.headers.get("Cookie"), SESSION_COOKIE),
      sessionToken,
      identity.subject,
      Date.now(),
    );
    const headers = new Headers({
      Location: "/",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    headers.append("Set-Cookie", buildCookie(AUTH_COOKIE, "", 0, callbackUrl.protocol === "https:"));
    headers.append("Set-Cookie", buildCookie(SESSION_COOKIE, sessionToken, 12 * 60 * 60, callbackUrl.protocol === "https:"));
    return new Response(null, {
      status: 303,
      headers,
    });
  } catch {
    return loginFailure(callbackUrl.protocol === "https:");
  }
}

async function getSession(request: Request, environment: WorkerEnvironment): Promise<Response> {
  const token = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  const loginAvailable = await isOSMLoginAvailable(environment, new URL(request.url).origin);
  if (!token || !environment.DB) return jsonResponse({ authenticated: false, loginAvailable }, 200);
  try {
    const session = await findOSMSession(environment.DB, token, Date.now());
    return jsonResponse({ authenticated: session !== null, loginAvailable }, 200);
  } catch {
    return jsonResponse({ error: "session_unavailable" }, 503);
  }
}

async function logout(request: Request, environment: WorkerEnvironment): Promise<Response> {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if ((origin !== null && origin !== requestUrl.origin) || fetchSite === "cross-site") return jsonResponse({ error: "invalid_origin" }, 403);
  const token = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (token && !environment.DB) return jsonResponse({ error: "logout_unavailable" }, 503);
  if (token && environment.DB) {
    try {
      await deleteOSMSession(environment.DB, token);
    } catch {
      return jsonResponse({ error: "logout_unavailable" }, 503);
    }
  }
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store", "Set-Cookie": buildCookie(SESSION_COOKIE, "", 0, requestUrl.protocol === "https:") },
  });
}

function getAuthConfiguration(environment: WorkerEnvironment): { clientId: string; redirectUri: string; encryptionKey: string } | null {
  if (!environment.OSM_CLIENT_ID || !environment.OSM_REDIRECT_URI || !environment.OSM_OAUTH_ENCRYPTION_KEY) return null;
  if (environment.OSM_CLIENT_ID.length > 256 || environment.OSM_CLIENT_ID.trim().length === 0) return null;
  try {
    const redirectUri = new URL(environment.OSM_REDIRECT_URI);
    const secureRedirect = redirectUri.protocol === "https:";
    const localRedirect = redirectUri.protocol === "http:" && redirectUri.hostname === "127.0.0.1";
    if ((!secureRedirect && !localRedirect) || redirectUri.username || redirectUri.password || redirectUri.pathname !== "/api/auth/osm/callback" || redirectUri.search || redirectUri.hash) return null;
    return { clientId: environment.OSM_CLIENT_ID, redirectUri: redirectUri.toString(), encryptionKey: environment.OSM_OAUTH_ENCRYPTION_KEY };
  } catch {
    return null;
  }
}

/** Keep the UI login link hidden unless the same checks needed to start OAuth already pass. */
async function isOSMLoginAvailable(environment: WorkerEnvironment, requestOrigin: string): Promise<boolean> {
  const configuration = getAuthConfiguration(environment);
  if (!configuration || !environment.DB || new URL(configuration.redirectUri).origin !== requestOrigin) return false;
  try {
    await importOAuthEncryptionKey(configuration.encryptionKey);
    return true;
  } catch {
    return false;
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header || header.length > 8_192) return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}

function buildCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function authUnavailable(): Response {
  return jsonResponse({ error: "login_unavailable" }, 503);
}

function loginFailure(secure: boolean): Response {
  const headers = new Headers({
    Location: "/?login=error",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  headers.append("Set-Cookie", buildCookie(AUTH_COOKIE, "", 0, secure));
  return new Response(null, {
    status: 303,
    headers,
  });
}

function jsonResponse(body: Record<string, string | boolean>, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders },
  });
}

export default worker;
