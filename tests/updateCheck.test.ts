import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDeployedRevision, isNewerVersionDeployed, startUpdateWatcher, UPDATE_CHECK_INTERVAL_MS } from "../src/pwa/updateCheck";

// Kleine Ersatzobjekte für document und window: So lässt sich der Wächter ohne Browser prüfen.
function fakeEventSource() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    visibilityState: "visible",
    addEventListener(type: string, listener: () => void) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener); },
    removeEventListener(type: string, listener: () => void) { listeners.get(type)?.delete(listener); },
    emit(type: string) { listeners.get(type)?.forEach((listener) => listener()); },
    count(type: string) { return listeners.get(type)?.size ?? 0; },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("fetchDeployedRevision", () => {
  it("reads a valid revision and bypasses every cache", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ revision: "mh3k9x2a" }));
    await expect(fetchDeployedRevision(fetcher)).resolves.toBe("mh3k9x2a");
    expect(fetcher).toHaveBeenCalledWith("/version.json", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  });

  it.each([
    ["a failed response", () => json({ revision: "mh3k9x2a" }, 503)],
    ["a body that is not JSON", () => new Response("<html>app shell</html>")],
    ["a JSON array", () => json(["mh3k9x2a"])],
    ["null", () => json(null)],
    ["a missing revision", () => json({})],
    ["a numeric revision", () => json({ revision: 12345 })],
    ["a revision with unsafe characters", () => json({ revision: "../etc" })],
    ["an upper-case revision", () => json({ revision: "ABCDEFGH" })],
    ["a too short revision", () => json({ revision: "ab" })],
  ])("returns null for %s", async (_name, response) => {
    await expect(fetchDeployedRevision(vi.fn<typeof fetch>().mockResolvedValue(response()))).resolves.toBeNull();
  });

  it("returns null when the network is unavailable", async () => {
    await expect(fetchDeployedRevision(vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")))).resolves.toBeNull();
  });

  it("gives up after the timeout instead of waiting forever", async () => {
    vi.useFakeTimers();
    try {
      // Antwortet nie, reagiert aber auf das Abbruchsignal wie ein echtes fetch.
      const hanging = vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
      const result = fetchDeployedRevision(hanging);
      await vi.advanceTimersByTimeAsync(9_000);
      await expect(result).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isNewerVersionDeployed", () => {
  it("is true only for a valid, different revision", () => {
    expect(isNewerVersionDeployed("aaaa1111", "bbbb2222")).toBe(true);
    expect(isNewerVersionDeployed("aaaa1111", "aaaa1111")).toBe(false);
    // Eine nicht lesbare Antwort darf nie wie „neue Version“ aussehen.
    expect(isNewerVersionDeployed("aaaa1111", null)).toBe(false);
  });
});

describe("startUpdateWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(responses: (() => Response | Promise<Response>)[], running = "aaaa1111") {
    const documentRef = fakeEventSource();
    const windowRef = fakeEventSource();
    const onUpdate = vi.fn();
    let call = 0;
    const fetcher = vi.fn<typeof fetch>(async () => responses[Math.min(call++, responses.length - 1)]());
    const stop = startUpdateWatcher({ runningRevision: running, onUpdate, fetcher, documentRef, windowRef });
    return { documentRef, windowRef, onUpdate, fetcher, stop };
  }

  it("reports a newer version once and then stops watching", async () => {
    const { onUpdate, fetcher, documentRef, windowRef } = setup([() => json({ revision: "bbbb2222" })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // Nach dem Fund gibt es keine weiteren Abfragen, Ereignisse oder Mehrfachmeldungen.
    documentRef.emit("visibilitychange");
    windowRef.emit("online");
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(documentRef.count("visibilitychange")).toBe(0);
    expect(windowRef.count("online")).toBe(0);
  });

  it("stays quiet while the published revision matches", async () => {
    const { onUpdate } = setup([() => json({ revision: "aaaa1111" })]);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 3);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("ignores errors and keeps watching until a real update appears", async () => {
    const { onUpdate, fetcher } = setup([
      () => { throw new TypeError("offline"); },
      () => json({ unexpected: true }),
      () => json({ revision: "bbbb2222" }),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(onUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("checks again when the app becomes visible or the connection returns", async () => {
    const { documentRef, windowRef, fetcher } = setup([() => json({ revision: "aaaa1111" })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);

    documentRef.visibilityState = "hidden";
    documentRef.emit("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1); // Wegwischen löst keine Abfrage aus.

    documentRef.visibilityState = "visible";
    documentRef.emit("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);

    windowRef.emit("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not stack requests while one is still running", async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const { windowRef, fetcher, onUpdate } = setup([() => pending]);
    windowRef.emit("online");
    windowRef.emit("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(json({ revision: "bbbb2222" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("can be stopped by the caller and then stays silent", async () => {
    const { stop, onUpdate, fetcher, windowRef } = setup([() => json({ revision: "aaaa1111" })]);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(windowRef.count("online")).toBe(0);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("does nothing when the running revision is not a valid build revision", async () => {
    const { fetcher, onUpdate, documentRef } = setup([() => json({ revision: "bbbb2222" })], "dev build!");
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(fetcher).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(documentRef.count("visibilitychange")).toBe(0);
  });
});
