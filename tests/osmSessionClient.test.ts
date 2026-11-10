import { describe, expect, it, vi } from "vitest";
import { endOSMSession, loadOSMSession } from "../src/auth/osmSession";

describe("OSM session client", () => {
  it("accepts only the small public session status", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false, developmentWriteAvailable: false })));

    // Ein fehlendes Feld „photoCheckAvailable“ muss als „aus“ gelesen werden.
    await expect(loadOSMSession(fetcher)).resolves.toEqual({ authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false, developmentWriteAvailable: false, photoCheckAvailable: false });
    expect(fetcher).toHaveBeenCalledWith("/api/auth/session", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("reads the photo check flag only when it is exactly true", async () => {
    const status = { authenticated: true, loginAvailable: true, developmentLoginAvailable: true, developmentSession: true };
    const enabled = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...status, photoCheckAvailable: true })));
    await expect(loadOSMSession(enabled)).resolves.toMatchObject({ photoCheckAvailable: true });

    const wrongType = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...status, photoCheckAvailable: "yes" })));
    await expect(loadOSMSession(wrongType)).rejects.toThrow("OSM session status is invalid.");
  });

  it("rejects malformed responses and does not assume the user is logged in", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ authenticated: "yes", osmToken: "must-not-be-used" })));

    await expect(loadOSMSession(fetcher)).rejects.toThrow("OSM session status is invalid.");
  });

  it("uses a same-origin POST for logout and reports a failed request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(endOSMSession(fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    fetcher.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(endOSMSession(fetcher)).rejects.toThrow("OSM logout failed.");
  });
});
