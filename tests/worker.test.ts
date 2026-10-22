import { describe, expect, it, vi } from "vitest";
import worker from "../server/worker";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";

function environment() {
  return { ASSETS: { fetch: vi.fn(async () => new Response("app shell")) } };
}

describe("Cloudflare Worker shell", () => {
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
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(queries.some((query) => query.startsWith("INSERT INTO osm_oauth_transactions"))).toBe(true);
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
    expect(await response.json()).toEqual({ authenticated: false, loginAvailable: false });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
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
