import { describe, expect, it } from "vitest";
import { ExistingNodeError, requestExistingNode } from "../src/osm/existingNode";

/** Baut einen Fetch-Ersatz, der genau eine feste Antwort liefert und die Anfrage mitschreibt. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => { calls.push({ url: String(input), init }); return respond(); };
  return { fetcher, calls };
}
const ok = (body: unknown) => () => Response.json(body);
const good = { status: "ok", id: "node/42", version: 7, tags: { access: "yes", check_date: "2025-10-20" } };

async function failureCode(fetcher: typeof fetch): Promise<string> {
  try {
    await requestExistingNode("node/42", fetcher);
  } catch (error) {
    if (error instanceof ExistingNodeError) return error.code;
    throw error;
  }
  return "no-error";
}

describe("requestExistingNode", () => {
  it("returns the fresh version and tags and asks only our own server, without caching", async () => {
    const { fetcher, calls } = fakeFetch(ok(good));
    await expect(requestExistingNode("node/42", fetcher)).resolves.toEqual({ id: "node/42", version: 7, tags: { access: "yes", check_date: "2025-10-20" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/osm/development/node?id=node%2F42");
    expect(calls[0].init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store" });
  });

  it("maps HTTP statuses to short codes", async () => {
    expect(await failureCode(fakeFetch(() => new Response(null, { status: 401 })).fetcher)).toBe("authentication_required");
    expect(await failureCode(fakeFetch(() => new Response(null, { status: 403 })).fetcher)).toBe("authentication_required");
    expect(await failureCode(fakeFetch(() => new Response(null, { status: 404 })).fetcher)).toBe("node_unavailable");
    for (const status of [429, 500, 502, 503]) expect(await failureCode(fakeFetch(() => new Response(null, { status })).fetcher), String(status)).toBe("service_unavailable");
  });

  it("treats a network failure as an unavailable service", async () => {
    expect(await failureCode(async () => { throw new TypeError("network"); })).toBe("service_unavailable");
  });

  it("rejects answers that do not match the request or the contract", async () => {
    const bad: unknown[] = [
      "text", null, [], {},
      { ...good, status: "error" },
      { ...good, id: "node/43" },
      { ...good, version: 0 }, { ...good, version: 1.5 }, { ...good, version: "7" }, { ...good, version: Number.MAX_SAFE_INTEGER + 2 },
      { ...good, tags: null }, { ...good, tags: [] }, { ...good, tags: "access=yes" },
      // Unbekannte Schlüssel (auch der Zugangscode) und falsche Werttypen haben im Browser nichts verloren.
      { ...good, tags: { name: "Rathaus" } }, { ...good, tags: { "defibrillator:code": "1234" } },
      { ...good, tags: { access: 1 } }, { ...good, tags: { description: "x".repeat(256) } },
    ];
    for (const body of bad) expect(await failureCode(fakeFetch(ok(body)).fetcher), JSON.stringify(body)).toBe("invalid_response");
  });

  it("rejects an answer that is not JSON", async () => {
    expect(await failureCode(fakeFetch(() => new Response("<html>", { status: 200 })).fetcher)).toBe("invalid_response");
  });

  it("accepts an answer without any tags (nothing entered yet)", async () => {
    const { fetcher } = fakeFetch(ok({ status: "ok", id: "node/42", version: 1, tags: {} }));
    await expect(requestExistingNode("node/42", fetcher)).resolves.toEqual({ id: "node/42", version: 1, tags: {} });
  });
});
