import { describe, expect, it, vi } from "vitest";
import { fetchWithoutRedirects } from "../server/http/fetchWithoutRedirects";

describe("external requests without redirects", () => {
  it("preserves HTTP errors for the caller's existing status handling", async () => {
    const response = new Response(null, { status: 401 });
    const fetcher = vi.fn(async () => response);
    expect(await fetchWithoutRedirects("https://provider.example", {}, fetcher)).toBe(response);
  });

  it.each([301, 302, 303, 307, 308])("rejects HTTP %s without exposing or following Location", async (status) => {
    const response = new Response("private provider body", { status, headers: { Location: "https://private-target.example" } });
    const fetcher = vi.fn(async () => response);
    const failure = await fetchWithoutRedirects("https://provider.example", { redirect: "follow" }, fetcher).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("private");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://provider.example", { redirect: "manual" });
    expect(response.bodyUsed).toBe(true);
  });
});
