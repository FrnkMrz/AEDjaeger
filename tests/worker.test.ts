import { describe, expect, it, vi } from "vitest";
import worker, { revokeOSMToken } from "../server/worker";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";
import { importOAuthEncryptionKey } from "../server/auth/osmOAuth";
import { createOSMSession } from "../server/storage/osmSessions";
import { storeOSMOAuthToken } from "../server/storage/osmOAuthTokens";

function environment() {
  return { ASSETS: { fetch: vi.fn(async () => new Response("app shell")) } };
}

describe("Cloudflare Worker shell", () => {
  it("revokes OSM tokens only at the fixed HTTPS issuer endpoint and never fails logout", async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const encryptionKey = btoa(String.fromCharCode(...rawKey)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    const requests: Array<{ url: string; body: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body) });
      return new Response("provider unavailable", { status: 503 });
    };
    const env = {
      ...environment(),
      OSM_CLIENT_ID: "aedjaeger-client",
      OSM_REDIRECT_URI: "https://aedjaeger.example/api/auth/osm/callback",
      OSM_OAUTH_ENCRYPTION_KEY: encryptionKey,
    };

    await expect(revokeOSMToken("secret-access-token", "production", env, fetcher)).resolves.toBeUndefined();
    expect(requests).toEqual([{
      url: "https://www.openstreetmap.org/oauth2/revoke",
      body: "token=secret-access-token&token_type_hint=access_token&client_id=aedjaeger-client",
    }]);
  });

  it("ends the local session even when OSM rejects the best-effort token revocation", async () => {
    const database = new LogoutDatabase();
    const sessionToken = "s".repeat(43);
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const encryptionSecret = btoa(String.fromCharCode(...rawKey)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    const encryptionKey = await importOAuthEncryptionKey(encryptionSecret);
    const now = Date.now();
    await createOSMSession(database, sessionToken, "12345", now, "production");
    await storeOSMOAuthToken(database, sessionToken, "stored-osm-access-token", now + 60_000, now, encryptionKey);
    const providerRequests: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      providerRequests.push({ url: String(input), body: String(init?.body) });
      return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
    });
    try {
      const response = await worker.fetch(new Request("https://aedjaeger.example/api/auth/logout", {
        method: "POST",
        headers: { Origin: "https://aedjaeger.example", Cookie: `__Host-aedjaeger_osm_session=${sessionToken}` },
      }), {
        ...environment(), DB: database,
        OSM_CLIENT_ID: "aedjaeger-client",
        OSM_REDIRECT_URI: "https://aedjaeger.example/api/auth/osm/callback",
        OSM_OAUTH_ENCRYPTION_KEY: encryptionSecret,
      });

      expect(response.status).toBe(204);
      expect(database.sessions.size).toBe(0);
      expect(providerRequests).toHaveLength(1);
      expect(providerRequests[0].url).toBe("https://www.openstreetmap.org/oauth2/revoke");
      expect(providerRequests[0].body).toContain("token=stored-osm-access-token");
      expect(response.headers.get("Set-Cookie")).toContain("__Host-aedjaeger_osm_session=");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns a minimal, non-cacheable health response", async () => {
    const env = environment();
    const response = await worker.fetch(new Request("https://aedjaeger.test/api/health"), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("allows only GET for the health route", async () => {
    const env = environment();
    const response = await worker.fetch(new Request("https://aedjaeger.test/api/health", { method: "POST" }), env);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
  });

  it.each(["/api", "/api/", "/api/analyze"])('keeps unimplemented API path "%s" closed', async (path) => {
    const env = environment();
    const response = await worker.fetch(new Request(`https://aedjaeger.test${path}`), env);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("routes AED candidate search through the authenticated static source", async () => {
    const env = environment();
    const response = await worker.fetch(new Request("https://aedjaeger.test/api/osm/candidates/search"), env);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  // Die Fotoprüfung ist ohne Betreiber-Konfiguration aus: Es darf kein Foto verarbeitet und
  // kein OpenAI-Aufruf gestartet werden. Der Test läuft ohne Netzwerk (kein fetch im Worker-Pfad).
  it("keeps the photo check closed until the operator configures it", async () => {
    const env = environment();
    const outgoingFetch = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(new Request("https://aedjaeger.test/api/vision/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }), env);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "analysis_unavailable" });
    expect(outgoingFetch).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    outgoingFetch.mockRestore();
  });

  it("allows only POST for the photo check route", async () => {
    const env = environment();
    const response = await worker.fetch(new Request("https://aedjaeger.test/api/vision/analyze"), env);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("does not start OSM login when the Worker has no server-side configuration", async () => {
    const env = environment();
    const response = await worker.fetch(new Request("https://aedjaeger.test/api/auth/osm/start"), env);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "login_unavailable" });
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("starts OSM login with a server-stored transaction and a browser-bound cookie", async () => {
    const queries: string[] = [];
    const database: D1Database = {
      prepare(query: string): D1Statement {
        queries.push(query);
        return {
          bind() { return this; },
          async run<T>() { return { success: true, meta: { changes: 1 } } as D1Result<T>; },
          async first<T>() { return null as T | null; },
        };
      },
    };
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const encryptionKey = btoa(String.fromCharCode(...rawKey)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    const env = {
      ...environment(),
      DB: database,
      OSM_CLIENT_ID: "aedjaeger-client",
      OSM_REDIRECT_URI: "https://aedjaeger.example/api/auth/osm/callback",
      OSM_OAUTH_ENCRYPTION_KEY: encryptionKey,
    };

    const response = await worker.fetch(new Request("https://aedjaeger.example/api/auth/osm/start"), env);
    const redirect = new URL(response.headers.get("Location") ?? "https://invalid.example");
    const cookie = response.headers.get("Set-Cookie") ?? "";

    expect(response.status).toBe(302);
    expect(redirect.origin).toBe("https://www.openstreetmap.org");
    expect(redirect.searchParams.get("scope")).toBe("openid");
    expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
    expect(redirect.searchParams.get("code_verifier")).toBeNull();
    expect(cookie).toContain("__Host-aedjaeger_osm_auth=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(queries.some((query) => query.startsWith("INSERT INTO osm_oauth_transactions"))).toBe(true);
  });

  it("keeps the development login disabled unless explicitly configured", async () => {
    const response = await worker.fetch(new Request("https://aedjaeger.test/api/auth/osm/development/start"), environment());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "login_unavailable" });
  });

  it("starts development login only at the OSM test server with write_api", async () => {
    const queries: string[] = [];
    const database: D1Database = {
      prepare(query: string): D1Statement {
        queries.push(query);
        return {
          bind() { return this; },
          async run<T>() { return { success: true, meta: { changes: 1 } } as D1Result<T>; },
          async first<T>() { return null as T | null; },
        };
      },
    };
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const encryptionKey = btoa(String.fromCharCode(...rawKey)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    const env = {
      ...environment(),
      DB: database,
      OSM_DEV_LOGIN_ENABLED: "true",
      OSM_DEV_CLIENT_ID: "aedjaeger-dev-client",
      OSM_DEV_CLIENT_SECRET: "aedjaeger-test-secret",
      OSM_DEV_REDIRECT_URI: "https://aedjaeger.example/api/auth/osm/development/callback",
      OSM_OAUTH_ENCRYPTION_KEY: encryptionKey,
    };

    const response = await worker.fetch(new Request("https://aedjaeger.example/api/auth/osm/development/start"), env);
    const redirect = new URL(response.headers.get("Location") ?? "https://invalid.example");

    expect(response.status).toBe(302);
    expect(redirect.origin).toBe("https://master.apis.dev.openstreetmap.org");
    expect(redirect.pathname).toBe("/oauth2/authorize");
    expect(redirect.searchParams.get("scope")).toBe("openid write_api");
    expect(redirect.searchParams.get("redirect_uri")).toBe(env.OSM_DEV_REDIRECT_URI);
    expect(queries.some((query) => query.startsWith("INSERT INTO osm_oauth_transactions"))).toBe(true);
  });

  it("reports development login availability only for its configured origin", async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const encryptionKey = btoa(String.fromCharCode(...rawKey)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    const env = {
      ...environment(),
      DB: {} as D1Database,
      OSM_DEV_LOGIN_ENABLED: "true",
      OSM_DEV_CLIENT_ID: "aedjaeger-dev-client",
      OSM_DEV_CLIENT_SECRET: "aedjaeger-test-secret",
      OSM_DEV_REDIRECT_URI: "https://aedjaeger.example/api/auth/osm/development/callback",
      OSM_OAUTH_ENCRYPTION_KEY: encryptionKey,
    };

    const configured = await worker.fetch(new Request("https://aedjaeger.example/api/auth/session"), env);
    expect(await configured.json()).toEqual({ authenticated: false, loginAvailable: false, developmentLoginAvailable: true, developmentSession: false, developmentWriteAvailable: false });

    const missingSecret = await worker.fetch(
      new Request("https://aedjaeger.example/api/auth/session"),
      { ...env, OSM_DEV_CLIENT_SECRET: undefined },
    );
    expect(await missingSecret.json()).toEqual({ authenticated: false, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false, developmentWriteAvailable: false });

    const otherOrigin = await worker.fetch(new Request("https://other.example/api/auth/session"), env);
    expect(await otherOrigin.json()).toEqual({ authenticated: false, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false, developmentWriteAvailable: false });
  });

  // Hilfsfunktion: eine Datenbank, die jede Sitzungsabfrage mit demselben Konto beantwortet.
  function sessionDatabase(subject: string, osmEnvironment: "development" | "production"): D1Database {
    const statement: D1Statement = {
      bind: () => statement,
      run: async () => ({ success: true }),
      first: async <T>() => ({ osm_subject: subject, osm_environment: osmEnvironment }) as T,
    };
    return { prepare: () => statement };
  }

  describe("corrections availability in the session status", () => {
    const sessionRequest = () => new Request("https://aedjaeger.example/api/auth/session", { headers: { Cookie: `aedjaeger_osm_session=${"a".repeat(43)}` } });
    // Test-Server-Anmeldung vollständig eingerichtet, sonst meldet die App „nicht verfügbar“.
    const devLogin = {
      OSM_DEV_LOGIN_ENABLED: "true",
      OSM_DEV_CLIENT_ID: "aedjaeger-dev-client",
      OSM_DEV_CLIENT_SECRET: "aedjaeger-test-secret",
      OSM_DEV_REDIRECT_URI: "https://aedjaeger.example/api/auth/osm/development/callback",
      OSM_OAUTH_ENCRYPTION_KEY: "k".repeat(43),
    };
    const sessionBody = async (override: Record<string, string | undefined>) => (await worker.fetch(sessionRequest(), { ...environment(), ...devLogin, DB: sessionDatabase("42", "development"), ...override })).json();

    it("exposes a stable opaque write-owner hash for recovery without exposing the OSM subject", async () => {
      const first = await sessionBody({ OSM_DEV_WRITES_ENABLED: "true" });
      const second = await sessionBody({ OSM_DEV_WRITES_ENABLED: "true" });
      expect(first.developmentWriteOwnerHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(second.developmentWriteOwnerHash).toBe(first.developmentWriteOwnerHash);
      expect(first).not.toHaveProperty("subject");
      expect(first).not.toHaveProperty("osm_subject");
    });

    it("reports corrections only when the operator allowed them and test-server writing is on", async () => {
      expect(await sessionBody({ OSM_DEV_WRITES_ENABLED: "true", OSM_DETAIL_CORRECTIONS_ENABLED: "true" }))
        .toMatchObject({ authenticated: true, developmentWriteAvailable: true, developmentCorrectionsAvailable: true });
    });

    it.each([
      ["no switch at all", { OSM_DEV_WRITES_ENABLED: "true" }],
      ["the switch set to false", { OSM_DEV_WRITES_ENABLED: "true", OSM_DETAIL_CORRECTIONS_ENABLED: "false" }],
      ["a switch with different capitalisation", { OSM_DEV_WRITES_ENABLED: "true", OSM_DETAIL_CORRECTIONS_ENABLED: "TRUE" }],
      ["test-server writing switched off", { OSM_DEV_WRITES_ENABLED: "false", OSM_DETAIL_CORRECTIONS_ENABLED: "true" }],
      ["test-server writing missing", { OSM_DETAIL_CORRECTIONS_ENABLED: "true" }],
    ])("omits the flag for %s", async (_name, override) => {
      const body = await sessionBody(override);
      expect(body).toMatchObject({ authenticated: true });
      expect(body).not.toHaveProperty("developmentCorrectionsAvailable");
    });
  });

  describe("photo check availability in the session status", () => {
    const sessionRequest = () => new Request("https://aedjaeger.test/api/auth/session", { headers: { Cookie: `aedjaeger_osm_session=${"a".repeat(43)}` } });
    // Vollständige Betreiber-Konfiguration: nur dann darf „verfügbar“ gemeldet werden.
    const configured = {
      OPENAI_API_KEY: "sk-test-not-a-real-key",
      AI_ANALYSIS_ENABLED: "true",
      AI_ANALYSIS_ALLOWED_OSM_SUBJECTS: "development:42",
      AI_ANALYSIS_COST_RESERVATION_MICROS: "20000",
      AI_ANALYSIS_USER_DAILY_LIMIT_MICROS: "200000",
      AI_ANALYSIS_GLOBAL_DAILY_LIMIT_MICROS: "1000000",
    };

    it("reports the photo check only for an allowed account with complete configuration", async () => {
      const env = { ...environment(), ...configured, DB: sessionDatabase("42", "development") };
      const body = await (await worker.fetch(sessionRequest(), env)).json();
      expect(body).toMatchObject({ authenticated: true, photoCheckAvailable: true });
    });

    it.each([
      ["a missing API key", { OPENAI_API_KEY: undefined }],
      ["a disabled switch", { AI_ANALYSIS_ENABLED: "false" }],
      ["a missing budget limit", { AI_ANALYSIS_GLOBAL_DAILY_LIMIT_MICROS: undefined }],
      ["an account that is not on the allow list", { AI_ANALYSIS_ALLOWED_OSM_SUBJECTS: "development:7" }],
      ["the same subject on the other OSM server", { AI_ANALYSIS_ALLOWED_OSM_SUBJECTS: "production:42" }],
    ])("omits the flag for %s", async (_name, override) => {
      const env = { ...environment(), ...configured, ...override, DB: sessionDatabase("42", "development") };
      const body = await (await worker.fetch(sessionRequest(), env)).json();
      expect(body).toMatchObject({ authenticated: true });
      expect(body).not.toHaveProperty("photoCheckAvailable");
    });

    it("never exposes configuration values in the session status", async () => {
      const env = { ...environment(), ...configured, DB: sessionDatabase("42", "development") };
      const text = await (await worker.fetch(sessionRequest(), env)).text();
      expect(text).not.toContain("sk-test");
      expect(text).not.toContain("development:42");
    });
  });

  it("keeps login and logout methods narrow", async () => {
    const env = environment();
    const start = await worker.fetch(new Request("https://aedjaeger.test/api/auth/osm/start", { method: "POST" }), env);
    const callback = await worker.fetch(new Request("https://aedjaeger.test/api/auth/osm/callback", { method: "POST" }), env);
    const logout = await worker.fetch(new Request("https://aedjaeger.test/api/auth/logout"), env);

    expect(start.headers.get("Allow")).toBe("GET");
    expect(callback.headers.get("Allow")).toBe("GET");
    expect(logout.headers.get("Allow")).toBe("POST");
    expect([start.status, callback.status, logout.status]).toEqual([405, 405, 405]);
  });

  it("returns an unauthenticated session without exposing cookie or OSM details", async () => {
    const env = environment();
    const response = await worker.fetch(new Request("https://aedjaeger.test/api/auth/session", {
      headers: { Cookie: `aedjaeger_osm_session=${"a".repeat(43)}` },
    }), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false, developmentWriteAvailable: false });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("offers login only when the redirect origin and encryption key are usable", async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const encryptionKey = btoa(String.fromCharCode(...rawKey)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    const base = {
      ...environment(),
      DB: {} as D1Database,
      OSM_CLIENT_ID: "aedjaeger-client",
      OSM_REDIRECT_URI: "https://aedjaeger.example/api/auth/osm/callback",
      OSM_OAUTH_ENCRYPTION_KEY: encryptionKey,
    };

    const configured = await worker.fetch(new Request("https://aedjaeger.example/api/auth/session"), base);
    expect(await configured.json()).toEqual({ authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false, developmentWriteAvailable: false });

    const wrongOrigin = await worker.fetch(new Request("https://other.example/api/auth/session"), base);
    expect(await wrongOrigin.json()).toEqual({ authenticated: false, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false, developmentWriteAvailable: false });

    const invalidKey = await worker.fetch(new Request("https://aedjaeger.example/api/auth/session"), {
      ...base,
      OSM_OAUTH_ENCRYPTION_KEY: "not-a-valid-key",
    });
    expect(await invalidKey.json()).toEqual({ authenticated: false, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false, developmentWriteAvailable: false });
  });

  it("rejects cross-origin logout requests before touching the session", async () => {
    const env = environment();
    const response = await worker.fetch(new Request("https://aedjaeger.test/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    }), env);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid_origin" });
  });

  it("passes non-API requests through to static assets", async () => {
    const env = environment();
    const request = new Request("https://aedjaeger.test/help");
    const response = await worker.fetch(request, env);

    expect(await response.text()).toBe("app shell");
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  });
});

class LogoutDatabase implements D1Database {
  sessions = new Map<string, { osm_subject: string; osm_environment: string; expires_at: number }>();
  tokens = new Map<string, { token_iv: string; token_ciphertext: string; token_expires_at: number }>();

  prepare(query: string): D1Statement {
    const database = this;
    let values: unknown[] = [];
    return {
      bind(...bound) { values = bound; return this; },
      async run<T>() { return database.execute<T>(query, values); },
      async first<T>() { return database.query<T>(query, values); },
    } as D1Statement;
  }

  private query<T>(sql: string, values: unknown[]): T | null {
    if (sql.includes("FROM osm_sessions") && sql.includes("osm_subject")) {
      const [hash] = values as [string];
      const session = this.sessions.get(hash);
      return session ? { osm_subject: session.osm_subject, osm_environment: session.osm_environment } as T : null;
    }
    if (sql.includes("SELECT session_hash FROM osm_sessions")) {
      const [hash] = values as [string];
      return this.sessions.has(hash) ? { session_hash: hash } as T : null;
    }
    if (sql.includes("FROM osm_oauth_tokens")) {
      const [hash] = values as [string];
      return this.tokens.get(hash) as T ?? null;
    }
    throw new Error(`Unexpected D1 query in logout test: ${sql}`);
  }

  private execute<T>(sql: string, values: unknown[]): D1Result<T> {
    if (sql.startsWith("DELETE FROM osm_sessions WHERE expires_at")) return { success: true, meta: { changes: 0 } };
    if (sql.startsWith("UPDATE osm_development_write_operations SET owner_hash")) return { success: true, meta: { changes: 0 } };
    if (sql.startsWith("INSERT INTO osm_sessions")) {
      const [hash, subject, env, , expiresAt] = values as [string, string, string, number, number];
      this.sessions.set(hash, { osm_subject: subject, osm_environment: env, expires_at: expiresAt });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO osm_oauth_tokens")) {
      const [hash, token_iv, token_ciphertext, token_expires_at] = values as [string, string, string, number];
      this.tokens.set(hash, { token_iv, token_ciphertext, token_expires_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM osm_sessions WHERE session_hash")) {
      const [hash] = values as [string];
      this.sessions.delete(hash);
      this.tokens.delete(hash);
      return { success: true, meta: { changes: 1 } };
    }
    throw new Error(`Unexpected D1 statement in logout test: ${sql}`);
  }
}
