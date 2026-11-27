// Schreiben ins ECHTE OSM, Etappe Q3 („noch vorhanden“ bestätigen).
//
// Diese Tests laufen gegen eine echte SQLite-Datenbank aus allen Migrationen und gegen eine NACHGEBILDETE OSM-API.
// Kein Test spricht je mit api.openstreetmap.org: Jeder Netzaufruf geht an die Funktion `fakeOsm` unten.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { importOAuthEncryptionKey } from "../server/auth/osmOAuth";
import { handleProductionNodeRead } from "../server/osm/developmentNodeRoute";
import { handleDevelopmentCheckDate, handleProductionCheckDate } from "../server/osm/developmentWriteRoute";
import { createOSMSession } from "../server/storage/osmSessions";
import { storeOSMOAuthToken } from "../server/storage/osmOAuthTokens";
import worker from "../server/worker";

const migrationsDir = resolve(import.meta.dirname, "../migrations");
const keySecret = "k".repeat(43);
const sessionToken = "s".repeat(43);
const now = Date.UTC(2026, 10, 27, 12);
const PROD = "https://api.openstreetmap.org";
let counter = 0;

function nextId() {
  counter += 1;
  return `10000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
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

/** Datenbank mit angemeldeter Sitzung (echtes OSM oder Testserver) und gespeichertem Token. */
async function signedIn(environment = "production") {
  const database = createDatabase();
  await createOSMSession(database.d1, sessionToken, "osm-subject-1", now, environment);
  const key = await importOAuthEncryptionKey(keySecret);
  await storeOSMOAuthToken(database.d1, sessionToken, "prod-access-token", now + 60 * 60_000, now, key);
  return database;
}

/** Nachgebildete OSM-API. Hält fest, welche Aufrufe ankamen. */
function fakeOsm(node = { version: 3, tags: { emergency: "defibrillator", check_date: "2025-10-20" } }) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({
      origin: url.origin,
      method: init.method ?? "GET",
      path: url.pathname,
      body: init.body === undefined ? "" : String(init.body),
      authorization: new Headers(init.headers).get("Authorization"),
      userAgent: new Headers(init.headers).get("User-Agent"),
    });
    if (url.pathname === "/api/0.6/node/42.json")
      return Response.json({ elements: [{ type: "node", id: 42, lat: 49.5, lon: 11.4, ...node }] });
    if (url.pathname === "/api/0.6/changeset/create") return new Response("777");
    if (url.pathname === "/api/0.6/changeset/777/upload")
      return new Response(`<diffResult><node old_id="42" new_id="42" new_version="${node.version + 1}"/></diffResult>`);
    if (url.pathname === "/api/0.6/changeset/777/close") return new Response("");
    return new Response("unexpected", { status: 500 });
  };
  return { calls, fetcher };
}

function request(body, path = "/api/osm/check-date") {
  return new Request(`https://aedjaeger.de${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://aedjaeger.de",
      Cookie: `__Host-aedjaeger_osm_session=${sessionToken}`,
    },
    body: JSON.stringify(body),
  });
}

function checkDate(overrides = {}) {
  return {
    operation_id: nextId(),
    confirmed: true,
    target: "node/42",
    expected_version: 3,
    expected_check_date: "2025-10-20",
    observed_on: "2026-11-27",
    locale: "de",
    ...overrides,
  };
}

function environment(database, overrides = {}) {
  return { DB: database.d1, OSM_OAUTH_ENCRYPTION_KEY: keySecret, OSM_PROD_WRITES_ENABLED: "true", ...overrides };
}

describe("echtes OSM: noch vorhanden bestätigen (Etappe Q3)", () => {
  it("ist ohne den Schalter aus und fragt OSM gar nicht erst", async () => {
    const database = await signedIn();
    const osm = fakeOsm();
    for (const value of [undefined, "false", "TRUE", "1"]) {
      const response = await handleProductionCheckDate(
        request(checkDate()),
        environment(database, { OSM_PROD_WRITES_ENABLED: value }),
        { fetch: osm.fetcher, now: () => now },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "production_write_unavailable" });
    }
    expect(osm.calls).toEqual([]);
  });

  it("schreibt nur das Prüfdatum, mit source=survey, locale und dem zweisprachigen Kommentar", async () => {
    const database = await signedIn();
    const osm = fakeOsm({
      version: 3,
      tags: { emergency: "defibrillator", check_date: "2025-10-20", name: "Rathaus", access: "yes" },
    });
    const response = await handleProductionCheckDate(request(checkDate()), environment(database), {
      fetch: osm.fetcher,
      now: () => now,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "complete", version: 4 });

    // Jeder Aufruf geht an das echte OSM, mit dem Token und mit App-Kennung, nie an den Testserver.
    expect(osm.calls.every((call) => call.origin === PROD)).toBe(true);
    expect(osm.calls.every((call) => call.authorization === "Bearer prod-access-token")).toBe(true);
    expect(osm.calls.every((call) => /^AEDjaeger\//u.test(call.userAgent ?? ""))).toBe(true);
    expect(osm.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/0.6/node/42.json",
      "PUT /api/0.6/changeset/create",
      "POST /api/0.6/changeset/777/upload",
      "PUT /api/0.6/changeset/777/close",
    ]);

    const changeset = osm.calls[1].body;
    expect(changeset).toContain('<tag k="source" v="survey"/>');
    expect(changeset).toContain('<tag k="locale" v="de"/>');
    expect(changeset).toContain(
      '<tag k="comment" v="AED vor Ort als vorhanden bestätigt / AED confirmed present on site (AEDjaeger)"/>',
    );
    expect(changeset).toMatch(/<tag k="created_by" v="AEDjaeger \d+\.\d+\.\d+"\/>/u);

    // Am Objekt ändert sich nur check_date; fremde Tags bleiben, source=survey kommt NICHT an das Objekt.
    const upload = osm.calls[2].body;
    expect(upload).toContain('<tag k="check_date" v="2026-11-27"/>');
    expect(upload).toContain('<tag k="name" v="Rathaus"/>');
    expect(upload).toContain('<tag k="access" v="yes"/>');
    expect(upload).not.toContain('k="source"');
  });

  it("verlangt eine Anmeldung am echten OSM; eine Testserver-Sitzung darf hier nie schreiben", async () => {
    const database = await signedIn("development");
    const osm = fakeOsm();
    const response = await handleProductionCheckDate(request(checkDate()), environment(database), {
      fetch: osm.fetcher,
      now: () => now,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "production_session_required" });
    expect(osm.calls).toEqual([]);
  });

  it("schickt ein Token vom echten OSM nie an den Testserver", async () => {
    const database = await signedIn("production");
    const osm = fakeOsm();
    const response = await handleDevelopmentCheckDate(
      request(checkDate(), "/api/osm/development/check-date"),
      { ...environment(database), OSM_DEV_WRITES_ENABLED: "true" },
      { fetch: osm.fetcher, now: () => now },
    );
    expect(response.status).toBe(403);
    expect(osm.calls).toEqual([]);
  });

  it("ergänzt fehlende Angaben (Etappe Q4) mit eigenem Kommentar und lässt alle anderen Tags unverändert", async () => {
    const database = await signedIn();
    const osm = fakeOsm({
      version: 3,
      tags: { emergency: "defibrillator", check_date: "2025-10-20", name: "Rathaus", operator: "Stadt" },
    });
    const response = await handleProductionCheckDate(
      request(checkDate({ details: { access: "yes", indoor: "yes", level: "1" } })),
      environment(database),
      { fetch: osm.fetcher, now: () => now },
    );
    expect(response.status).toBe(200);
    const changeset = osm.calls.find((call) => call.path === "/api/0.6/changeset/create").body;
    expect(changeset).toContain(
      '<tag k="comment" v="AED vor Ort geprüft, fehlende Angaben ergänzt / AED checked on site, missing details added (AEDjaeger)"/>',
    );
    expect(changeset).toContain('<tag k="source" v="survey"/>');
    const upload = osm.calls.find((call) => call.path.endsWith("/upload")).body;
    for (const tag of ['k="access" v="yes"', 'k="indoor" v="yes"', 'k="level" v="1"', 'k="check_date" v="2026-11-27"'])
      expect(upload).toContain(tag);
    // Fremde Tags bleiben; kein Tag wird gelöscht oder ersetzt.
    expect(upload).toContain('<tag k="name" v="Rathaus"/>');
    expect(upload).toContain('<tag k="operator" v="Stadt"/>');
  });

  it("überschreibt am echten OSM nie einen vorhandenen Wert: steht der Schlüssel schon da, ist es ein Konflikt", async () => {
    const database = await signedIn();
    const osm = fakeOsm({
      version: 3,
      tags: { emergency: "defibrillator", check_date: "2025-10-20", access: "private" },
    });
    const response = await handleProductionCheckDate(
      request(checkDate({ details: { access: "yes" } })),
      environment(database),
      { fetch: osm.fetcher, now: () => now },
    );
    expect(response.status).toBe(409);
    expect(osm.calls.some((call) => call.path.endsWith("/upload"))).toBe(false);
  });

  it("lehnt Korrekturen am echten OSM ohne eigenen Schalter ab, bevor etwas an OSM geht", async () => {
    const database = await signedIn();
    const osm = fakeOsm();
    const response = await handleProductionCheckDate(
      request(
        checkDate({ details: { access: "yes" }, expected_before: { access: "private" }, confirmed_corrections: true }),
      ),
      environment(database),
      { fetch: osm.fetcher, now: () => now },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "corrections_disabled" });
    expect(osm.calls).toEqual([]);
  });

  it("liest einen AED frisch vom echten OSM fürs Formular und gibt nur Detail-Schlüssel und Prüfdatum weiter", async () => {
    const database = await signedIn();
    const osm = fakeOsm({
      version: 9,
      tags: { emergency: "defibrillator", check_date: "2025-10-20", name: "Geheim", access: "yes" },
    });
    const response = await handleProductionNodeRead(
      new Request("https://aedjaeger.de/api/osm/node?id=node/42", {
        headers: { Cookie: `__Host-aedjaeger_osm_session=${sessionToken}` },
      }),
      environment(database),
      { fetch: osm.fetcher, now: () => now },
    );
    expect(await response.json()).toEqual({
      status: "ok",
      id: "node/42",
      version: 9,
      tags: { access: "yes", check_date: "2025-10-20" },
    });
    expect(osm.calls.map((call) => call.origin)).toEqual([PROD]);
    // Ohne Schalter liest die Route nichts.
    const off = await handleProductionNodeRead(
      new Request("https://aedjaeger.de/api/osm/node?id=node/42", {
        headers: { Cookie: `__Host-aedjaeger_osm_session=${sessionToken}` },
      }),
      environment(database, { OSM_PROD_WRITES_ENABLED: undefined }),
      { fetch: osm.fetcher, now: () => now },
    );
    expect(off.status).toBe(503);
  });

  it("erlaubt eine schnelle Korrektur am selben AED und sperrt erst die sechste Änderung in 24 Stunden", async () => {
    const database = await signedIn();
    // Eine zweite Änderung kurz nach der ersten geht durch (zum Beispiel, weil sich die Person vertippt hat).
    const first = fakeOsm();
    await handleProductionCheckDate(request(checkDate()), environment(database), {
      fetch: first.fetcher,
      now: () => now,
    });
    const second = fakeOsm({ version: 4, tags: { emergency: "defibrillator", check_date: "2026-11-26" } });
    const secondResponse = await handleProductionCheckDate(
      request(checkDate({ expected_version: 4, expected_check_date: "2026-11-26" })),
      environment(database),
      { fetch: second.fetcher, now: () => now + 60_000 },
    );
    expect(secondResponse.status).toBe(200);
    // Drei weitere Vorgänge am selben AED stehen schon in der Datenbank; damit sind es fünf.
    for (let index = 0; index < 3; index += 1) {
      database.sqlite
        .prepare(
          `INSERT INTO osm_development_write_operations
           (owner_hash, operation_id, request_hash, state, created_at, updated_at, expires_at, osm_environment, target_id)
           VALUES (?, ?, ?, 'complete', ?, ?, ?, 'production', 'node/42')`,
        )
        .run("d".repeat(64), nextId(), "e".repeat(64), now + index, now + index, now + 1e10);
    }
    const sixth = fakeOsm();
    const response = await handleProductionCheckDate(request(checkDate()), environment(database), {
      fetch: sixth.fetcher,
      now: () => now + 120_000,
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "object_recently_changed" });
    expect(sixth.calls).toEqual([]);
  });

  it("schreibt bei einer Wiederholung derselben Vorgangs-ID nicht ein zweites Mal", async () => {
    const database = await signedIn();
    const body = checkDate();
    const first = fakeOsm();
    await handleProductionCheckDate(request(body), environment(database), { fetch: first.fetcher, now: () => now });
    const again = fakeOsm();
    const response = await handleProductionCheckDate(request(body), environment(database), {
      fetch: again.fetcher,
      now: () => now + 1_000,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "complete" });
    expect(again.calls.filter((call) => call.path.endsWith("/upload"))).toEqual([]);
  });

  it("schreibt nichts, wenn sich der AED seit der Vorschau geändert hat (Versionskonflikt)", async () => {
    const database = await signedIn();
    const osm = fakeOsm({ version: 5, tags: { emergency: "defibrillator", check_date: "2025-10-20" } });
    const response = await handleProductionCheckDate(request(checkDate()), environment(database), {
      fetch: osm.fetcher,
      now: () => now,
    });
    expect(response.status).toBe(409);
    expect(osm.calls.some((call) => call.path.endsWith("/upload"))).toBe(false);
  });

  it("lehnt eine unbekannte Sprache für das Changeset ab", async () => {
    const database = await signedIn();
    const osm = fakeOsm();
    const response = await handleProductionCheckDate(request(checkDate({ locale: "xx" })), environment(database), {
      fetch: osm.fetcher,
      now: () => now,
    });
    expect(response.status).toBe(400);
    expect(osm.calls).toEqual([]);
  });

  it("meldet die Schreibfreigabe nur mit Schalter und nur einer Sitzung am echten OSM", async () => {
    const session = async (environmentName, writes) => {
      const database = await signedIn(environmentName);
      const response = await worker.fetch(
        new Request("https://aedjaeger.de/api/auth/session", {
          headers: { Cookie: `__Host-aedjaeger_osm_session=${sessionToken}` },
        }),
        {
          ASSETS: { fetch: async () => new Response("") },
          DB: database.d1,
          OSM_OAUTH_ENCRYPTION_KEY: keySecret,
          OSM_PROD_LOGIN_ENABLED: "true",
          OSM_CLIENT_ID: "client",
          OSM_CLIENT_SECRET: "secret",
          OSM_REDIRECT_URI: "https://aedjaeger.de/api/auth/osm/callback",
          ...(writes === undefined ? {} : { OSM_PROD_WRITES_ENABLED: writes }),
        },
      );
      return response.json();
    };
    const on = await session("production", "true");
    expect(on).toMatchObject({ authenticated: true, productionWriteAvailable: true });
    expect(on.productionWriteOwnerHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(await session("production", undefined)).not.toHaveProperty("productionWriteAvailable");
    expect(await session("production", "yes")).not.toHaveProperty("productionWriteAvailable");
    expect(await session("development", "true")).not.toHaveProperty("productionWriteAvailable");
  });

  it("verlangt die gesehene Version, sonst könnte eine veraltete Vorschau bestätigt werden", async () => {
    const database = await signedIn();
    const osm = fakeOsm();
    const body = checkDate();
    delete body.expected_version;
    const response = await handleProductionCheckDate(request(body), environment(database), {
      fetch: osm.fetcher,
      now: () => now,
    });
    expect(response.status).toBe(400);
    expect(osm.calls).toEqual([]);
  });

  it("zählt „schon aktuell“ nicht gegen die Limits, weil nichts geschrieben wurde", async () => {
    const database = await signedIn();
    // Fünfmal „schon aktuell“ am selben AED: Der AED hat das Datum bereits.
    for (let index = 0; index < 5; index += 1) {
      const osm = fakeOsm({ version: 3, tags: { emergency: "defibrillator", check_date: "2026-11-27" } });
      const response = await handleProductionCheckDate(
        request(checkDate({ expected_check_date: "2026-11-27" })),
        environment(database),
        { fetch: osm.fetcher, now: () => now + index },
      );
      expect(await response.json()).toMatchObject({ status: "complete", already_current: true });
      expect(osm.calls.some((call) => call.path.endsWith("/changeset/create"))).toBe(false);
    }
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM osm_development_write_operations").get()).toEqual({
      n: 0,
    });
    // Eine echte Änderung ist danach weiter möglich.
    const real = fakeOsm();
    const response = await handleProductionCheckDate(request(checkDate()), environment(database), {
      fetch: real.fetcher,
      now: () => now + 100,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "complete", version: 4 });
  });

  describe("Korrekturen am echten OSM (Etappe Q6)", () => {
    const corrections = { OSM_PROD_DETAIL_CORRECTIONS_ENABLED: "true" };

    it("ersetzt einen Wert nur, wenn er noch genau so dasteht, mit eigenem Kommentar", async () => {
      const database = await signedIn();
      const osm = fakeOsm({
        version: 3,
        tags: { emergency: "defibrillator", check_date: "2025-10-20", access: "private", name: "Rathaus" },
      });
      const response = await handleProductionCheckDate(
        request(
          checkDate({
            details: { access: "yes", level: "1", indoor: "yes" },
            expected_before: { access: "private" },
            confirmed_corrections: true,
          }),
        ),
        environment(database, corrections),
        { fetch: osm.fetcher, now: () => now },
      );
      expect(response.status).toBe(200);
      const changeset = osm.calls.find((call) => call.path === "/api/0.6/changeset/create").body;
      expect(changeset).toContain(
        '<tag k="comment" v="AED vor Ort geprüft, Angaben ergänzt und korrigiert / AED checked on site, details added and corrected (AEDjaeger)"/>',
      );
      const upload = osm.calls.find((call) => call.path.endsWith("/upload")).body;
      expect(upload).toContain('<tag k="access" v="yes"/>');
      expect(upload).not.toContain('v="private"');
      expect(upload).toContain('<tag k="name" v="Rathaus"/>');
    });

    it("schreibt nichts, wenn der alte Wert inzwischen ein anderer ist", async () => {
      const database = await signedIn();
      const osm = fakeOsm({
        version: 3,
        tags: { emergency: "defibrillator", check_date: "2025-10-20", access: "customers" },
      });
      const response = await handleProductionCheckDate(
        request(
          checkDate({
            details: { access: "yes" },
            expected_before: { access: "private" },
            confirmed_corrections: true,
          }),
        ),
        environment(database, corrections),
        { fetch: osm.fetcher, now: () => now },
      );
      expect(response.status).toBe(409);
      expect(osm.calls.some((call) => call.path.endsWith("/upload"))).toBe(false);
    });

    it("der Korrektur-Schalter des Testservers gilt nie für das echte OSM", async () => {
      const database = await signedIn();
      const osm = fakeOsm();
      const response = await handleProductionCheckDate(
        request(
          checkDate({
            details: { access: "yes" },
            expected_before: { access: "private" },
            confirmed_corrections: true,
          }),
        ),
        environment(database, { OSM_DETAIL_CORRECTIONS_ENABLED: "true" }),
        { fetch: osm.fetcher, now: () => now },
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "corrections_disabled" });
      expect(osm.calls).toEqual([]);
    });
  });
});
