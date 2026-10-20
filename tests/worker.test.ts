import { describe, expect, it, vi } from "vitest";
import worker from "../server/worker";

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

  it("passes non-API requests through to static assets", async () => {
    const env = environment();
    const request = new Request("https://aedjaeger.test/help");
    const response = await worker.fetch(request, env);

    expect(await response.text()).toBe("app shell");
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  });
});
