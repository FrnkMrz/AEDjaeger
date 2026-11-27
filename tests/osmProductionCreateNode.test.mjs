// Neuer AED im ECHTEN OSM, Etappe Q5.
//
// Echte SQLite-Datenbank aus allen Migrationen, nachgebildete OSM-API. Kein Test spricht je mit api.openstreetmap.org.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { importOAuthEncryptionKey } from "../server/auth/osmOAuth";
import { handleProductionCreateNode } from "../server/osm/developmentCreateNodeRoute";
import { createOSMSession } from "../server/storage/osmSessions";
import { storeOSMOAuthToken } from "../server/storage/osmOAuthTokens";

const migrationsDir = resolve(import.meta.dirname, "../migrations");
const keySecret = "k".repeat(43);
const sessionToken = "s".repeat(43);
const now = Date.UTC(2026, 10, 27, 12);
const PROD = "https://api.openstreetmap.org";
let counter = 0;

function nextId() {
  counter += 1;
  return `20000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(resolve(migrationsDir, file), "utf8"));
  }
  return {
    sqlite,
    d1: {
      prepare(query) {
        let values = [];
        return {
          bind(...next) {
            values = next;
            return this;
          },
          async run() {
            const result = sqlite.prepare(query).run(...values);
            return { success: true, meta: { changes: Number(result.changes) } };
          },
          async first() {
            return sqlite.prepare(query).get(...values) ?? null;
          },
        };
      },
    },
  };
}

async function signedIn(environment = "production") {
  const database = createDatabase();
  await createOSMSession(database.d1, sessionToken, "osm-subject-1", now, environment);
  const key = await importOAuthEncryptionKey(keySecret);
  await storeOSMOAuthToken(database.d1, sessionToken, "prod-access-token", now + 60 * 60_000, now, key);
  return database;
}

/** Nachgebildete OSM-API: Kartenabfrage (Nachbarn), Changeset, Upload, Schließen. */
function fakeOsm(neighbours = []) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({
      origin: url.origin,
      method: init.method ?? "GET",
      path: url.pathname,
      body: init.body === undefined ? "" : String(init.body),
      authorization: new Headers(init.headers).get("Authorization"),
    });
    if (url.pathname === "/api/0.6/map.json") return Response.json({ elements: neighbours });
    if (url.pathname === "/api/0.6/changeset/create") return new Response("888");
    if (url.pathname === "/api/0.6/changeset/888/upload")
      return new Response('<diffResult><node old_id="-1" new_id="5555" new_version="1"/></diffResult>');
    if (url.pathname === "/api/0.6/changeset/888/close") return new Response("");
    return new Response("unexpected", { status: 500 });
  };
  return { calls, fetcher };
}

function request(body) {
  return new Request("https://aedjaeger.de/api/osm/create-node", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://aedjaeger.de",
      Cookie: `__Host-aedjaeger_osm_session=${sessionToken}`,
    },
    body: JSON.stringify(body),
  });
}

function createBody(overrides = {}) {
  return {
    operation_id: nextId(),
    confirmed: true,
    absence_confirmed: true,
    latitude: 49.5,
    longitude: 11.4,
    observed_on: "2026-11-27",
    details: { "defibrillator:location": "Eingang", access: "yes" },
    locale: "de",
    ...overrides,
  };
}

function environment(database, overrides = {}) {
  return {
    DB: database.d1,
    OSM_OAUTH_ENCRYPTION_KEY: keySecret,
    OSM_PROD_WRITES_ENABLED: "true",
    OSM_PROD_NEW_AEDS_ENABLED: "true",
    ...overrides,
  };
}

describe("echtes OSM: neuen AED eintragen (Etappe Q5)", () => {
  it("braucht beide Schalter und fragt ohne sie OSM gar nicht erst", async () => {
    const database = await signedIn();
    const osm = fakeOsm();
    for (const overrides of [{ OSM_PROD_NEW_AEDS_ENABLED: undefined }, { OSM_PROD_WRITES_ENABLED: undefined }]) {
      const response = await handleProductionCreateNode(request(createBody()), environment(database, overrides), {
        fetch: osm.fetcher,
        now: () => now,
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "production_write_unavailable" });
    }
    expect(osm.calls).toEqual([]);
  });

  it("prüft frisch auf Doppelte, legt den Knoten an und schreibt source=survey nur ans Changeset", async () => {
    const database = await signedIn();
    const osm = fakeOsm();
    const response = await handleProductionCreateNode(request(createBody()), environment(database), {
      fetch: osm.fetcher,
      now: () => now,
    });
    expect(response.status).toBe(200);
    expect(osm.calls.every((call) => call.origin === PROD && call.authorization === "Bearer prod-access-token")).toBe(
      true,
    );
    expect(osm.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/0.6/map.json",
      "PUT /api/0.6/changeset/create",
      "POST /api/0.6/changeset/888/upload",
      "PUT /api/0.6/changeset/888/close",
    ]);
    const changeset = osm.calls[1].body;
    expect(changeset).toContain(
      '<tag k="comment" v="AED vor Ort neu eingetragen / New AED mapped on site (AEDjaeger)"/>',
    );
    expect(changeset).toContain('<tag k="source" v="survey"/>');
    expect(changeset).toContain('<tag k="locale" v="de"/>');
    const upload = osm.calls[2].body;
    expect(upload).toContain('<tag k="emergency" v="defibrillator"/>');
    expect(upload).toContain('<tag k="check_date" v="2026-11-27"/>');
    expect(upload).toContain('<tag k="access" v="yes"/>');
    expect(upload).not.toContain('k="source"');
  });

  it("legt nichts an, wenn die frische Abfrage einen ungeprüften AED in der Nähe findet", async () => {
    const database = await signedIn();
    const osm = fakeOsm([{ type: "node", id: 77, lat: 49.5001, lon: 11.4, tags: { emergency: "defibrillator" } }]);
    const response = await handleProductionCreateNode(request(createBody()), environment(database), {
      fetch: osm.fetcher,
      now: () => now,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "nearby_aed_found" });
    expect(osm.calls.some((call) => call.path === "/api/0.6/changeset/create")).toBe(false);
  });

  it("zählt gegen das Tageslimit von 20 und lehnt danach ab, ohne OSM zu fragen", async () => {
    const database = await signedIn();
    const first = fakeOsm();
    await handleProductionCreateNode(request(createBody()), environment(database), {
      fetch: first.fetcher,
      now: () => now,
    });
    const owner = database.sqlite.prepare("SELECT owner_hash FROM osm_development_write_operations").get().owner_hash;
    for (let index = 0; index < 19; index += 1) {
      database.sqlite
        .prepare(
          `INSERT INTO osm_development_write_operations
           (owner_hash, operation_id, request_hash, state, created_at, updated_at, expires_at, osm_environment, target_id)
           VALUES (?, ?, ?, 'complete', ?, ?, ?, 'production', ?)`,
        )
        .run(owner, nextId(), "e".repeat(64), now + index, now + index, now + 1e10, `node/${900 + index}`);
    }
    const blocked = fakeOsm();
    const response = await handleProductionCreateNode(request(createBody()), environment(database), {
      fetch: blocked.fetcher,
      now: () => now + 1_000,
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "daily_limit" });
    expect(blocked.calls).toEqual([]);
  });

  it("verlangt eine Anmeldung am echten OSM", async () => {
    const database = await signedIn("development");
    const osm = fakeOsm();
    const response = await handleProductionCreateNode(request(createBody()), environment(database), {
      fetch: osm.fetcher,
      now: () => now,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "production_session_required" });
    expect(osm.calls).toEqual([]);
  });

  it("legt bei einer Wiederholung derselben Vorgangs-ID keinen zweiten AED an", async () => {
    const database = await signedIn();
    const body = createBody();
    await handleProductionCreateNode(request(body), environment(database), {
      fetch: fakeOsm().fetcher,
      now: () => now,
    });
    const again = fakeOsm();
    const response = await handleProductionCreateNode(request(body), environment(database), {
      fetch: again.fetcher,
      now: () => now + 1_000,
    });
    expect(response.status).toBe(200);
    expect(again.calls.some((call) => call.path.endsWith("/upload"))).toBe(false);
  });

  it("prüft beim Fortsetzen nach einem Datenbankfehler erneut frisch auf Doppelte und lädt dann nicht hoch", async () => {
    const database = await signedIn();
    // Die Datenbank speichert die Changeset-Nummer, meldet aber einen Fehler (z. B. Zeitüberschreitung nach dem Schreiben).
    let failAfterCommit = true;
    const flaky = {
      prepare(query) {
        const statement = database.d1.prepare(query);
        if (!query.includes("SET state = 'changeset-created'")) return statement;
        return {
          bind(...values) {
            statement.bind(...values);
            return this;
          },
          async run() {
            const result = await statement.run();
            if (failAfterCommit) {
              failAfterCommit = false;
              throw new Error("D1 timeout after commit");
            }
            return result;
          },
          first: (...args) => statement.first(...args),
        };
      },
    };
    const body = createBody();
    const first = fakeOsm();
    const firstResponse = await handleProductionCreateNode(request(body), environment(database, { DB: flaky }), {
      fetch: first.fetcher,
      now: () => now,
    });
    expect(firstResponse.status).toBe(503);
    expect(first.calls.some((call) => call.path.endsWith("/upload"))).toBe(false);

    // Inzwischen hat jemand einen AED direkt daneben eingetragen. Die Wiederholung muss das bemerken.
    const retry = fakeOsm([{ type: "node", id: 99, lat: 49.5, lon: 11.4, tags: { emergency: "defibrillator" } }]);
    const response = await handleProductionCreateNode(request(body), environment(database), {
      fetch: retry.fetcher,
      now: () => now + 5_000,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "nearby_aed_found" });
    expect(retry.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/0.6/map.json",
      "PUT /api/0.6/changeset/888/close",
    ]);
  });
});
