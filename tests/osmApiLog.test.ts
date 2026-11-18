import { describe, expect, it } from "vitest";
import { createOSMApiLog, withOSMApiLog } from "../server/osm/osmApiLog";

// Tests für das Protokoll der OSM-Aufrufe, das die App im Speicher-Fenster zeigt.
// Wichtig sind vor allem die Datenschutz-Grenzen: kein Standort, keine fremden Pfade, keine Inhalte.
const DEV = "https://master.apis.dev.openstreetmap.org";

describe("OSM API log", () => {
  it("records method, path and status of allowed development calls", async () => {
    const log = createOSMApiLog(async () => new Response("77", { status: 200 }));
    await log.fetch(`${DEV}/api/0.6/changeset/create`, { method: "PUT", body: "<osm/>" });
    await log.fetch(`${DEV}/api/0.6/changeset/77/upload`, { method: "POST", body: "<osmChange/>" });
    await log.fetch(`${DEV}/api/0.6/changeset/77/close`, { method: "PUT" });
    expect(log.entries).toEqual([
      { method: "PUT", path: "/api/0.6/changeset/create", status: 200 },
      { method: "POST", path: "/api/0.6/changeset/77/upload", status: 200 },
      { method: "PUT", path: "/api/0.6/changeset/77/close", status: 200 },
    ]);
  });

  it("never records the map box, because it contains the location", async () => {
    const log = createOSMApiLog(async () => new Response("{}", { status: 200 }));
    await log.fetch(`${DEV}/api/0.6/map.json?bbox=11.03,49.42,11.04,49.43`, { method: "GET" });
    expect(log.entries).toEqual([{ method: "GET", path: "/api/0.6/map.json", status: 200 }]);
    expect(JSON.stringify(log.entries)).not.toContain("49.42");
  });

  it("ignores paths outside the fixed development API list", async () => {
    const log = createOSMApiLog(async () => new Response("", { status: 200 }));
    await log.fetch(`${DEV}/oauth2/token`, { method: "POST" });
    await log.fetch(`${DEV}/api/0.6/user/details.json`, { method: "GET" });
    expect(log.entries).toEqual([]);
  });

  it("records a network failure as status 0 and still passes the error on", async () => {
    const log = createOSMApiLog(async () => {
      throw new TypeError("network down");
    });
    await expect(log.fetch(`${DEV}/api/0.6/changeset/create`, { method: "PUT" })).rejects.toThrow("network down");
    expect(log.entries).toEqual([{ method: "PUT", path: "/api/0.6/changeset/create", status: 0 }]);
  });

  it("adds the log to a JSON route answer and keeps status and headers", async () => {
    const route = withOSMApiLog(
      async (_request: Request, _environment: unknown, dependencies?: { fetch?: typeof fetch }) => {
        await dependencies?.fetch?.(`${DEV}/api/0.6/changeset/create`, { method: "PUT" });
        return new Response(JSON.stringify({ status: "pending" }), {
          status: 202,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
      async () => new Response("9", { status: 200 }),
    );
    const response = await route(new Request("https://app.example/api"), {});
    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "pending",
      osm_log: [{ method: "PUT", path: "/api/0.6/changeset/create", status: 200 }],
    });
  });

  it("passes non-JSON answers through unchanged", async () => {
    const route = withOSMApiLog(async () => new Response("plain", { status: 500 }));
    const response = await route(new Request("https://app.example/api"), {});
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("plain");
  });
});
