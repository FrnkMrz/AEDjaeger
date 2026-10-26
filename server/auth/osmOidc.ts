import { OSM_SESSION_LIFETIME_MS } from "../storage/osmSessions";
import { getOSMProviderEndpoints, type OSMEnvironment } from "./osmProvider";

const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
const MAX_ACCESS_TOKEN_LENGTH = 8_192;
const MAX_CLIENT_SECRET_LENGTH = 1_024;

export type OSMIdentityToken = {
  subject: string;
};

export type OSMDevelopmentAuthorization = OSMIdentityToken & {
  accessToken: string;
  expiresAt: number;
};

type Fetcher = typeof fetch;
type OSMDiscoveryDocument = {
  issuer?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
  id_token_signing_alg_values_supported?: unknown;
};
type TokenResponse = Record<string, unknown> & { id_token: string };

export type OSMOAuthDiagnosticCode =
  | "provider_discovery_unreachable"
  | "provider_discovery_http_error"
  | "provider_discovery_invalid_response"
  | "provider_discovery_invalid_metadata"
  | "token_endpoint_unreachable"
  | "token_endpoint_rejected"
  | "identity_keys_unavailable"
  | "identity_token_invalid"
  | "development_scope_invalid"
  | "development_access_token_invalid";

/** Safe, bounded details for server logs; provider bodies and credentials stay private. */
export class OSMOAuthDiagnosticError extends Error {
  constructor(
    readonly diagnosticCode: OSMOAuthDiagnosticCode,
    readonly httpStatus?: number,
    message = "Die OpenStreetMap-Anmeldung konnte nicht abgeschlossen werden.",
  ) {
    super(message);
    this.name = "OSMOAuthDiagnosticError";
  }
}

/** Production login only verifies identity and never returns its access token. */
export async function exchangeOSMCodeForIdentity(input: {
  code: string;
  verifier: string;
  nonce: string;
  clientId: string;
  redirectUri: string;
  now?: number;
  fetcher?: Fetcher;
  cryptoApi?: Crypto;
}): Promise<OSMIdentityToken> {
  const { subject } = await exchangeCode(input, "production");
  return { subject };
}

/**
 * Exchanges a code at the fixed OSM test server and accepts only the small
 * development scope requested by AEDjaeger. The returned token stays server-side.
 */
export async function exchangeOSMDevelopmentCodeForAccess(input: {
  code: string;
  verifier: string;
  nonce: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  now?: number;
  fetcher?: Fetcher;
  cryptoApi?: Crypto;
}): Promise<OSMDevelopmentAuthorization> {
  const { subject, tokenResponse } = await exchangeCode(input, "development");
  const scopes = typeof tokenResponse.scope === "string"
    ? tokenResponse.scope.split(/\s+/u).filter(Boolean)
    : tokenResponse.scope === undefined ? ["openid", "write_api"] : [];
  const uniqueScopes = new Set(scopes);
  const accessToken = tokenResponse.access_token;
  if (typeof accessToken !== "string" || !isAccessToken(accessToken) || tokenResponse.token_type !== "Bearer") {
    throw new OSMOAuthDiagnosticError("development_access_token_invalid", undefined, "Die OSM-Testanmeldung hat nicht den erwarteten Zugriff erteilt.");
  }
  if (!uniqueScopes.has("openid") || !uniqueScopes.has("write_api") ||
    [...uniqueScopes].some((scope) => scope !== "openid" && scope !== "write_api")) {
    throw new OSMOAuthDiagnosticError("development_scope_invalid", undefined, "Die OSM-Testanmeldung hat nicht den erwarteten Zugriff erteilt.");
  }

  const now = input.now ?? Date.now();
  const expiresIn = tokenResponse.expires_in;
  // OSM access tokens currently may not provide an expiry. In that case the
  // app limits retention to its own short-lived session instead.
  const expiresAt = typeof expiresIn === "number" && Number.isSafeInteger(expiresIn) && expiresIn > 0
    ? now + expiresIn * 1_000
    : now + OSM_SESSION_LIFETIME_MS;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    throw new Error("Die OSM-Testanmeldung hat eine ungültige Tokenlaufzeit geliefert.");
  }

  return { subject, accessToken, expiresAt };
}

async function exchangeCode(
  input: {
    code: string;
    verifier: string;
    nonce: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    now?: number;
    fetcher?: Fetcher;
    cryptoApi?: Crypto;
  },
  environment: OSMEnvironment,
): Promise<{ subject: string; tokenResponse: TokenResponse }> {
  const fetcher = input.fetcher ?? fetch;
  const cryptoApi = input.cryptoApi ?? crypto;
  const endpoints = getOSMProviderEndpoints(environment);
  const discovery = await loadDiscovery(fetcher, endpoints);
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  });
  const tokenHeaders = new Headers({ "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" });

  if (environment === "development") {
    if (!isOAuthClientSecret(input.clientSecret)) throw new Error("Die OSM-Testanmeldung ist nicht korrekt konfiguriert.");
    // Der OSM-Testserver verlangt client_secret_basic zusätzlich zu PKCE.
    // Beide Werte werden nur für diesen HTTPS-Tokenaustausch verwendet und
    // bleiben serverseitig; der Browser erhält weder Secret noch Access-Token.
    tokenHeaders.set("Authorization", `Basic ${encodeBasicCredentials(input.clientId, input.clientSecret)}`);
  } else {
    // Der bestehende Produktionspfad nutzt weiterhin seine bisherige Anmeldung.
    tokenBody.set("client_id", input.clientId);
  }

  let response: Response;
  try {
    response = await fetcher(endpoints.token, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: tokenHeaders,
      body: tokenBody,
    });
  } catch {
    throw new OSMOAuthDiagnosticError("token_endpoint_unreachable");
  }

  let tokenResponse: unknown;
  try {
    tokenResponse = await readJson(response);
  } catch {
    throw new OSMOAuthDiagnosticError("token_endpoint_rejected", response.status);
  }
  if (!response.ok || !isRecord(tokenResponse) || typeof tokenResponse.id_token !== "string") {
    throw new OSMOAuthDiagnosticError("token_endpoint_rejected", response.status);
  }

  let jwksResponse: Response;
  let jwks: unknown;
  try {
    jwksResponse = await fetcher(endpoints.jwks, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    jwks = await readJson(jwksResponse);
  } catch {
    throw new OSMOAuthDiagnosticError("identity_keys_unavailable");
  }
  if (!jwksResponse.ok || !isRecord(jwks) || !Array.isArray(jwks.keys)) {
    throw new OSMOAuthDiagnosticError("identity_keys_unavailable", jwksResponse.status);
  }

  let subject: string;
  try {
    subject = await verifyIdToken(tokenResponse.id_token, jwks.keys, input, discovery, endpoints.issuer, cryptoApi);
  } catch {
    throw new OSMOAuthDiagnosticError("identity_token_invalid");
  }
  return { subject, tokenResponse: tokenResponse as TokenResponse };
}

async function loadDiscovery(fetcher: Fetcher, endpoints: ReturnType<typeof getOSMProviderEndpoints>): Promise<OSMDiscoveryDocument> {
  let response: Response;
  try {
    response = await fetcher(endpoints.discovery, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OSMOAuthDiagnosticError("provider_discovery_unreachable");
  }
  if (!response.ok) {
    throw new OSMOAuthDiagnosticError("provider_discovery_http_error", response.status);
  }

  let discovery: unknown;
  try {
    discovery = await readJson(response);
  } catch {
    // Status allein hilft zu erkennen, ob der Testserver z. B. statt JSON eine
    // HTML-Sperrseite geliefert hat. Der Antwortinhalt selbst bleibt vertraulich.
    throw new OSMOAuthDiagnosticError("provider_discovery_invalid_response", response.status);
  }
  if (
    !isRecord(discovery) ||
    discovery.issuer !== endpoints.issuer ||
    discovery.token_endpoint !== endpoints.token ||
    discovery.jwks_uri !== endpoints.jwks ||
    !Array.isArray(discovery.id_token_signing_alg_values_supported) ||
    !discovery.id_token_signing_alg_values_supported.includes("RS256")
  ) {
    throw new OSMOAuthDiagnosticError("provider_discovery_invalid_metadata", response.status);
  }
  return discovery;
}

async function verifyIdToken(
  token: string,
  keys: unknown[],
  input: { nonce: string; clientId: string; now?: number },
  discovery: OSMDiscoveryDocument,
  expectedIssuer: string,
  cryptoApi: Crypto,
): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 16_384) throw new Error("Ungültiges OSM-ID-Token.");

  const header = decodeJsonSegment(parts[0]);
  const claims = decodeJsonSegment(parts[1]);
  if (
    !isRecord(header) ||
    !isRecord(claims) ||
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    header.crit !== undefined ||
    header.jku !== undefined ||
    header.x5u !== undefined ||
    header.b64 === false
  ) {
    throw new Error("Ungültiges OSM-ID-Token.");
  }
  if (!Array.isArray(discovery.id_token_signing_alg_values_supported) || !discovery.id_token_signing_alg_values_supported.includes("RS256")) {
    throw new Error("Nicht unterstützte OSM-Signatur.");
  }

  const matchingKeys = keys.filter(
    (key): key is JsonWebKey & { kid: string } =>
      isRecord(key) &&
      key.kid === header.kid &&
      key.kty === "RSA" &&
      (key.use === undefined || key.use === "sig") &&
      (key.alg === undefined || key.alg === "RS256"),
  );
  if (matchingKeys.length !== 1) throw new Error("Ungültiger OSM-Signaturschlüssel.");

  const publicKey = await cryptoApi.subtle.importKey("jwk", matchingKeys[0], { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signatureValid = await cryptoApi.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    toArrayBuffer(decodeBase64Url(parts[2])),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!signatureValid) throw new Error("Ungültige OSM-Signatur.");

  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1_000);
  const audience = claims.aud;
  if (
    claims.iss !== expectedIssuer ||
    !(audience === input.clientId || (Array.isArray(audience) && audience.includes(input.clientId))) ||
    (claims.azp !== undefined && claims.azp !== input.clientId) ||
    (Array.isArray(audience) && audience.length > 1 && claims.azp !== input.clientId) ||
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    claims.sub.length > 255 ||
    !/^[\x20-\x7E]+$/u.test(claims.sub) ||
    typeof claims.exp !== "number" ||
    claims.exp <= nowSeconds ||
    typeof claims.iat !== "number" ||
    claims.iat > nowSeconds + 60 ||
    (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > nowSeconds)) ||
    claims.nonce !== input.nonce
  ) {
    throw new Error("Die OpenStreetMap-Anmeldung konnte nicht bestätigt werden.");
  }
  return claims.sub;
}

async function readJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("Antwort des OpenStreetMap-Dienstes ist ungültig.");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("Antwort des OpenStreetMap-Dienstes ist ungültig.");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("Antwort des OpenStreetMap-Dienstes ist ungültig.");
  }
}

function decodeJsonSegment(segment: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment))) as unknown;
  } catch {
    throw new Error("Ungültiges OSM-ID-Token.");
  }
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Ungültiges OSM-ID-Token.");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAccessToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ACCESS_TOKEN_LENGTH && /^[\x21-\x7E]+$/u.test(value);
}

function isOAuthClientSecret(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CLIENT_SECRET_LENGTH;
}

/** OAuth 2 form-encodes each credential before HTTP Basic base64 encoding. */
function encodeBasicCredentials(clientId: string, clientSecret: string): string {
  const formEncode = (value: string): string => new URLSearchParams({ value }).toString().slice("value=".length);
  return btoa(`${formEncode(clientId)}:${formEncode(clientSecret)}`);
}
