import { describe, expect, it } from "vitest";
import {
  buildOSMAuthorizationUrl,
  createCodeChallenge,
  createPkceTransaction,
  validateOSMAuthorizationCallback,
} from "../server/auth/osmOAuth";

describe("OSM OAuth PKCE building blocks", () => {
  it("creates the S256 challenge from the RFC 7636 example verifier", async () => {
    await expect(
      createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("creates a fresh state and verifier in the PKCE-supported length range", async () => {
    const first = await createPkceTransaction();
    const second = await createPkceTransaction();

    for (const transaction of [first, second]) {
      expect(transaction.state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(transaction.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(transaction.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(transaction.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }
    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.verifier).not.toBe(second.verifier);
  });

  it("rejects malformed PKCE verifiers before deriving a challenge", async () => {
    await expect(createCodeChallenge("not a valid verifier"))
      .rejects.toThrow("PKCE-Verifier");
  });

  it("builds only the fixed OSM authorization endpoint and login-only scope", async () => {
    const transaction = await createPkceTransaction();
    const authorizationUrl = buildOSMAuthorizationUrl({
      clientId: "aedjaeger-test-client",
      redirectUri: "https://aedjaeger.example/api/auth/osm/callback",
      transaction,
    });

    expect(authorizationUrl.origin).toBe("https://www.openstreetmap.org");
    expect(authorizationUrl.pathname).toBe("/oauth2/authorize");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("scope")).toBe("openid");
    expect(authorizationUrl.searchParams.get("state")).toBe(transaction.state);
    expect(authorizationUrl.searchParams.get("nonce")).toBe(transaction.nonce);
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(transaction.challenge);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("rejects insecure redirect URLs and caller-controlled OAuth state", async () => {
    const transaction = await createPkceTransaction();

    expect(() => buildOSMAuthorizationUrl({
      clientId: "client",
      redirectUri: "http://evil.example/callback",
      transaction,
    })).toThrow("HTTPS");
    expect(() => buildOSMAuthorizationUrl({
      clientId: "client",
      redirectUri: "https://aedjaeger.example/callback",
      transaction: { ...transaction, state: "caller-controlled" },
    })).toThrow("OAuth-Transaktion");
  });

  it("accepts one matching callback code and rejects state tampering or duplicate codes", async () => {
    const transaction = await createPkceTransaction();

    expect(
      validateOSMAuthorizationCallback(
        new URL(`https://aedjaeger.example/api/auth/osm/callback?state=${transaction.state}&code=one-time-code`),
        transaction.state,
      ),
    ).toEqual({ ok: true, code: "one-time-code" });
    expect(
      validateOSMAuthorizationCallback(
        new URL("https://aedjaeger.example/api/auth/osm/callback?state=wrong&code=one-time-code"),
        transaction.state,
      ),
    ).toEqual({ ok: false, reason: "invalid_state" });
    expect(
      validateOSMAuthorizationCallback(
        new URL(`https://aedjaeger.example/api/auth/osm/callback?state=${transaction.state}&code=first&code=second`),
        transaction.state,
      ),
    ).toEqual({ ok: false, reason: "invalid_response" });
  });
});
