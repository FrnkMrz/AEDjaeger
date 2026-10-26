import { describe, expect, it } from "vitest";
import { exchangeOSMCodeForIdentity, exchangeOSMDevelopmentCodeForAccess, OSMOAuthDiagnosticError } from "../server/auth/osmOidc";

const clientId = "aedjaeger-client";
const clientSecret = "aedjaeger-test-secret";
const nonce = "expected-nonce";
const now = 1_800_000_000_000;

function encode(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function signedFixture(claimOverrides: Record<string, unknown> = {}, environment: "production" | "development" = "production", tokenOverrides: Record<string, unknown> = {}) {
  const origin = environment === "development" ? "https://master.apis.dev.openstreetmap.org" : "https://www.openstreetmap.org";
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = encode({ alg: "RS256", kid: "osm-key-1", typ: "JWT" });
  const claims = encode({
    iss: origin,
    sub: "987654321",
    aud: clientId,
    exp: Math.floor(now / 1_000) + 300,
    iat: Math.floor(now / 1_000),
    nonce,
    ...claimOverrides,
  });
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signingInput));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  const token = `${signingInput}.${encodedSignature}`;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === `${origin}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: origin,
        token_endpoint: `${origin}/oauth2/token`,
        jwks_uri: `${origin}/oauth2/discovery/keys`,
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (url === `${origin}/oauth2/token`) {
      expect(init?.method).toBe("POST");
      const body = String(init?.body);
      expect(body).toContain("code_verifier=verifier-value");
      if (environment === "development") {
        const formEncode = (value: string): string => new URLSearchParams({ value }).toString().slice("value=".length);
        expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${btoa(`${formEncode(clientId)}:${formEncode(clientSecret)}`)}`);
        expect(body).not.toContain("client_secret");
      } else {
        expect(new Headers(init?.headers).get("Authorization")).toBeNull();
      }
      return Response.json({ id_token: token, access_token: "A".repeat(60), token_type: "Bearer", ...(environment === "development" ? { scope: "openid write_api" } : {}), ...tokenOverrides });
    }
    if (url === `${origin}/oauth2/discovery/keys`) {
      return Response.json({ keys: [{ ...publicJwk, kid: "osm-key-1", use: "sig", alg: "RS256" }] });
    }
    throw new Error(`Unexpected provider URL: ${url}`);
  };
  return { fetcher, token };
}

describe("OSM OpenID Connect verification", () => {
  it("exchanges the code and accepts a correctly signed, bound identity token", async () => {
    const { fetcher } = await signedFixture();

    await expect(exchangeOSMCodeForIdentity({
      code: "one-time-code",
      verifier: "verifier-value",
      nonce,
      clientId,
      redirectUri: "https://aedjaeger.example/api/auth/osm/callback",
      now,
      fetcher,
    })).resolves.toEqual({ subject: "987654321" });
  });

  it("exchanges development authorization only against the fixed test issuer and accepts write_api", async () => {
    const { fetcher } = await signedFixture({}, "development", { expires_in: 3_600 });
    await expect(exchangeOSMDevelopmentCodeForAccess({
      code: "one-time-code",
      verifier: "verifier-value",
      nonce,
      clientId,
      clientSecret,
      redirectUri: "https://aedjaeger.example/api/auth/osm/development/callback",
      now,
      fetcher,
    })).resolves.toMatchObject({
      subject: "987654321",
      accessToken: "A".repeat(60),
      expiresAt: now + 3_600_000,
    });
  });

  it("accepts an omitted scope field because the exact requested scope is unchanged", async () => {
    const { fetcher } = await signedFixture({}, "development", { scope: undefined });
    await expect(exchangeOSMDevelopmentCodeForAccess({
      code: "one-time-code",
      verifier: "verifier-value",
      nonce,
      clientId,
      clientSecret,
      redirectUri: "https://aedjaeger.example/api/auth/osm/development/callback",
      now,
      fetcher,
    })).resolves.toMatchObject({ subject: "987654321", accessToken: "A".repeat(60) });
  });

  it("rejects extra scopes from the OSM development authorization", async () => {
    const { fetcher } = await signedFixture({}, "development", { scope: "openid write_api read_prefs" });
    await expect(exchangeOSMDevelopmentCodeForAccess({
      code: "one-time-code",
      verifier: "verifier-value",
      nonce,
      clientId,
      clientSecret,
      redirectUri: "https://aedjaeger.example/api/auth/osm/development/callback",
      now,
      fetcher,
    })).rejects.toThrow("erwarteten Zugriff");
  });

  it("rejects development code exchange without a server-side client secret", async () => {
    const { fetcher } = await signedFixture({}, "development");
    await expect(exchangeOSMDevelopmentCodeForAccess({
      code: "one-time-code",
      verifier: "verifier-value",
      nonce,
      clientId,
      clientSecret: "",
      redirectUri: "https://aedjaeger.example/api/auth/osm/development/callback",
      now,
      fetcher,
    })).rejects.toThrow("nicht korrekt konfiguriert");
  });

  it("classifies token-endpoint rejection without exposing provider error text", async () => {
    const origin = "https://master.apis.dev.openstreetmap.org";
    const providerDescription = `private-detail-${clientSecret}`;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input) === `${origin}/.well-known/openid-configuration`) {
        return Response.json({
          issuer: origin,
          token_endpoint: `${origin}/oauth2/token`,
          jwks_uri: `${origin}/oauth2/discovery/keys`,
          id_token_signing_alg_values_supported: ["RS256"],
        });
      }
      return Response.json({ error: "invalid_client", error_description: providerDescription }, { status: 401 });
    };

    let failure: unknown;
    try {
      await exchangeOSMDevelopmentCodeForAccess({
        code: "one-time-code",
        verifier: "verifier-value",
        nonce,
        clientId,
        clientSecret,
        redirectUri: "https://aedjaeger.example/api/auth/osm/development/callback",
        fetcher,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OSMOAuthDiagnosticError);
    expect(failure).toMatchObject({ diagnosticCode: "token_endpoint_rejected", httpStatus: 401 });
    expect((failure as Error).message).not.toContain(providerDescription);
    expect((failure as Error).message).not.toContain(clientSecret);
  });

  it.each([
    ["issuer", { iss: "https://attacker.example" }],
    ["audience", { aud: "another-client" }],
    ["nonce", { nonce: "wrong-nonce" }],
    ["expiry", { exp: Math.floor(now / 1_000) }],
  ])("rejects a signed token with an invalid %s", async (_label, claimOverrides) => {
    const { fetcher } = await signedFixture(claimOverrides);
    await expect(exchangeOSMCodeForIdentity({
      code: "code",
      verifier: "verifier-value",
      nonce,
      clientId,
      redirectUri: "https://aedjaeger.example/api/auth/osm/callback",
      now,
      fetcher,
    })).rejects.toThrow();
  });

  it("rejects a token after its signature is changed", async () => {
    const { fetcher, token } = await signedFixture();
    const [header, claims, signature] = token.split(".");
    // Das erste Signaturzeichen liegt sicher in den Nutzbits; das letzte Base64-Zeichen kann Padding-Bits enthalten.
    const changedSignature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    const altered = `${header}.${claims}.${changedSignature}`;
    const changedFetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await fetcher(input, init);
      if (String(input) === "https://www.openstreetmap.org/oauth2/token") {
        return Response.json({ id_token: altered });
      }
      return response;
    };
    await expect(exchangeOSMCodeForIdentity({
      code: "code",
      verifier: "verifier-value",
      nonce,
      clientId,
      redirectUri: "https://aedjaeger.example/api/auth/osm/callback",
      now,
      fetcher: changedFetcher,
    })).rejects.toThrow();
  });

  it("refuses discovery metadata that points to another issuer", async () => {
    const fetcher = async (): Promise<Response> => Response.json({
      issuer: "https://attacker.example",
      token_endpoint: "https://www.openstreetmap.org/oauth2/token",
      jwks_uri: "https://www.openstreetmap.org/oauth2/discovery/keys",
      id_token_signing_alg_values_supported: ["RS256"],
    });
    await expect(exchangeOSMCodeForIdentity({
      code: "code",
      verifier: "verifier-value",
      nonce,
      clientId,
      redirectUri: "https://aedjaeger.example/api/auth/osm/callback",
      fetcher,
    })).rejects.toThrow();
  });
});
