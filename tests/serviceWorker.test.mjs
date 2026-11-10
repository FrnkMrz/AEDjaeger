import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Führt public/sw.js in einer kleinen, künstlichen Worker-Umgebung aus und prüft, welche Anfragen der
// Worker an sich zieht. Reines JavaScript (.mjs), weil die Typprüfung des Projekts keine Node-Typen kennt.
const source = readFileSync("public/sw.js", "utf8");

function loadWorker() {
  const handlers = {};
  const self = {
    // Ein echtes URL-Objekt: Der Worker liest daraus origin und href. Ein Ersatz ohne origin würde
    // jede Anfrage als „fremd“ ablehnen und die Tests wertlos machen.
    location: new URL("https://aedjaeger.test/sw.js?revision=testbuild"),
    addEventListener: (type, handler) => { handlers[type] = handler; },
    skipWaiting: () => undefined,
    clients: { claim: () => undefined },
  };
  const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined), addAll: vi.fn(async () => undefined) };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => []), delete: vi.fn(async () => true) };
  const fetchSpy = vi.fn(async () => new Response("network"));
  vm.runInNewContext(source, { self, caches, fetch: fetchSpy, URL, Response });
  return { handlers, cache };
}

/** Simuliert eine Anfrage und meldet, ob der Worker sie selbst beantworten wollte. */
function takesOver(handlers, url, overrides = {}) {
  const respondWith = vi.fn();
  handlers.fetch({ request: { method: "GET", url, mode: "cors", ...overrides }, respondWith, waitUntil: () => undefined });
  return respondWith.mock.calls.length > 0;
}

describe("Service Worker: welche Anfragen er an sich zieht", () => {
  it("lässt /version.json immer direkt ins Netz, damit der Update-Hinweis nie einen alten Stand liest", () => {
    const { handlers, cache } = loadWorker();
    expect(takesOver(handlers, "https://aedjaeger.test/version.json")).toBe(false);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("lässt API-Aufrufe, fremde Herkunft und Nicht-GET-Anfragen unberührt", () => {
    const { handlers } = loadWorker();
    expect(takesOver(handlers, "https://aedjaeger.test/api/auth/session")).toBe(false);
    expect(takesOver(handlers, "https://other.example/assets/app.js")).toBe(false);
    expect(takesOver(handlers, "https://aedjaeger.test/assets/app.js", { method: "POST" })).toBe(false);
  });

  it("beantwortet weiterhin die App-Dateien und die Startseite selbst", () => {
    const { handlers } = loadWorker();
    expect(takesOver(handlers, "https://aedjaeger.test/assets/index-abc.js")).toBe(true);
    expect(takesOver(handlers, "https://aedjaeger.test/", { mode: "navigate" })).toBe(true);
  });
});
