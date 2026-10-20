const OSM_ISSUER = "https://www.openstreetmap.org";
const OSM_DISCOVERY_URL = `${OSM_ISSUER}/.well-known/openid-configuration`;
const OSM_TOKEN_URL = `${OSM_ISSUER}/oauth2/token`;
const OSM_JWKS_URL = `${OSM_ISSUER}/oauth2/discovery/keys`;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

export type OSMIdentityToken = {
  subject: string;
};

type Fetcher = typeof fetch;
type OSMDiscoveryDocument = {
  issuer?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
  id_token_signing_alg_values_supported?: unknown;
};

/** Tauscht den einmaligen Code ein und validiert das OSM-ID-Token vollständig. */
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
  const fetcher = input.fetcher ?? fetch;
  const cryptoApi = input.cryptoApi ?? crypto;
  const discovery = await loadDiscovery(fetcher);
  const response = await fetcher(OSM_TOKEN_URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    }),
  });

  const tokenResponse = await readJson(response);
  if (!response.ok || !isRecord(tokenResponse) || typeof tokenResponse.id_token !== "string") {
    throw new Error("Die OpenStreetMap-Anmeldung konnte nicht abgeschlossen werden.");
  }

  const jwksResponse = await fetcher(OSM_JWKS_URL, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const jwks = await readJson(jwksResponse);
  if (!jwksResponse.ok || !isRecord(jwks) || !Array.isArray(jwks.keys)) {
    throw new Error("Die OpenStreetMap-Anmeldung konnte nicht geprüft werden.");
  }

  return { subject: await verifyIdToken(tokenResponse.id_token, jwks.keys, input, discovery, cryptoApi) };
}

async function loadDiscovery(fetcher: Fetcher): Promise<OSMDiscoveryDocument> {
  const response = await fetcher(OSM_DISCOVERY_URL, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const discovery = await readJson(response);
  if (
    !response.ok ||
    !isRecord(discovery) ||
    discovery.issuer !== OSM_ISSUER ||
    discovery.token_endpoint !== OSM_TOKEN_URL ||
    discovery.jwks_uri !== OSM_JWKS_URL ||
    !Array.isArray(discovery.id_token_signing_alg_values_supported) ||
    !discovery.id_token_signing_alg_values_supported.includes("RS256")
  ) {
    throw new Error("Die OpenStreetMap-Anmeldung konnte nicht geprüft werden.");
  }
  return discovery;
}

async function verifyIdToken(
  token: string,
  keys: unknown[],
  input: { nonce: string; clientId: string; now?: number },
  discovery: OSMDiscoveryDocument,
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
    claims.iss !== OSM_ISSUER ||
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
    throw new Error("Die OSM-Anmeldung konnte nicht bestätigt werden.");
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
