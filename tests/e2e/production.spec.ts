import { expect, type Page, type BrowserContext } from "@playwright/test";
import { test } from "@playwright/test";
import { beginNearbySearch, closeSaveDialog } from "./support";

// Echtes OSM, Etappe Q3: „noch vorhanden“ bestätigen. Alle Antworten des Servers sind hier nachgebildet; kein Test
// spricht mit dem echten OSM. Geprüft wird, was die App zeigt und was sie an den Worker sendet.

const productionOwnerHash = "b".repeat(64);
const comment = "AED vor Ort als vorhanden bestätigt / AED confirmed present on site (AEDjaeger)";

type Options = {
  writeAvailable?: boolean;
  source?: "live" | "archive";
  searchStatus?: "complete" | "partial";
  withoutVersion?: boolean;
};

/** Anmeldung am echten OSM, Suche mit einem Treffer direkt am Standort, bis zur Vorschau mit dem Prüfdatum. */
async function openProductionPreview(page: Page, context: BrowserContext, options: Options = {}): Promise<void> {
  await openProductionList(page, context, options);
  await page.getByRole("button", { name: "Als noch vorhanden bestätigen" }).click();
}

/** Dasselbe, aber nur bis zur Trefferliste. */
async function openProductionList(page: Page, context: BrowserContext, options: Options = {}): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: false,
        developmentSession: false,
        developmentWriteAvailable: false,
        ...(options.writeAvailable === false
          ? {}
          : { productionWriteAvailable: true, productionWriteOwnerHash: productionOwnerHash }),
      },
    }),
  );
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({
      json: {
        status: options.searchStatus ?? "complete",
        coverage_radius_meters: 62,
        candidates: [
          {
            id: "node/123",
            osmType: "node",
            coordinateQuality: "exact",
            source: options.source ?? "live",
            ...(options.withoutVersion ? {} : { version: 7 }),
            position: { latitude: 52.52001, longitude: 13.40501 },
            tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2025-10-20" },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.locator('[data-action="confirm-sighting"]').click();
  await beginNearbySearch(page);
}

/** Hält fest, was an die beiden Schreibrouten geht. */
async function recordWrites(page: Page, answer: (index: number) => { status: number; json: unknown }) {
  const production: Array<Record<string, unknown>> = [];
  const development: Array<Record<string, unknown>> = [];
  await page.route("**/api/osm/check-date", async (route) => {
    production.push(route.request().postDataJSON() as Record<string, unknown>);
    const reply = answer(production.length - 1);
    await route.fulfill({ status: reply.status, json: reply.json });
  });
  await page.route("**/api/osm/development/check-date", async (route) => {
    development.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 500, json: { error: "unexpected" } });
  });
  return { production, development };
}

test("a confirmed check date goes to the real OSM route with the visible comment, the language and nothing else", async ({
  page,
  context,
}) => {
  const writes = await recordWrites(page, () => ({ status: 200, json: { status: "complete", version: 8 } }));
  await openProductionPreview(page, context);

  const save = page.getByRole("button", { name: "In OpenStreetMap speichern" });
  await expect(save).toBeVisible();
  // Vor dem Speichern steht offen da: öffentlich, unter dem eigenen Konto, mit genau diesem Kommentar.
  const preview = page.locator(".capture-content");
  await expect(preview).toContainText("öffentlich in OpenStreetMap");
  await expect(preview).toContainText(comment);
  await expect(preview).not.toContainText("Testserver");
  // Seit Etappe Q4 gibt es daneben den Weg „Fehlende Angaben ergänzen“ (ohne Korrekturen).
  await expect(page.getByRole("button", { name: "Fehlende Angaben ergänzen" })).toBeVisible();

  await save.click();
  await expect(page.locator(".capture-content").getByRole("status")).toContainText("In OpenStreetMap gespeichert.");
  expect(writes.development).toEqual([]);
  expect(writes.production).toHaveLength(1);
  expect(writes.production[0]).toMatchObject({
    confirmed: true,
    target: "node/123",
    expected_version: 7,
    expected_check_date: "2025-10-20",
    locale: "de",
    recovery_identity: productionOwnerHash,
  });
  expect(writes.production[0]).not.toHaveProperty("details");
  expect(writes.production[0]).not.toHaveProperty("expected_before");
});

test("without the operator switch there is no save button for the real OSM", async ({ page, context }) => {
  const writes = await recordWrites(page, () => ({ status: 200, json: { status: "complete", version: 8 } }));
  await openProductionPreview(page, context, { writeAvailable: false });
  await expect(page.getByRole("button", { name: "In OpenStreetMap speichern" })).toHaveCount(0);
  await expect(page.locator(".capture-content")).toContainText("Nur eine Vorschau");
  expect(writes.production).toEqual([]);
});

test("a hit known only from the archive is never saved to the real OSM", async ({ page, context }) => {
  const writes = await recordWrites(page, () => ({ status: 200, json: { status: "complete", version: 8 } }));
  await openProductionPreview(page, context, { source: "archive" });
  await expect(page.getByRole("button", { name: "In OpenStreetMap speichern" })).toHaveCount(0);
  expect(writes.production).toEqual([]);
});

test("a limit says clearly that nothing was changed and offers no retry", async ({ page, context }) => {
  const writes = await recordWrites(page, () => ({ status: 429, json: { error: "daily_limit" } }));
  await openProductionPreview(page, context);
  await page.getByRole("button", { name: "In OpenStreetMap speichern" }).click();
  await expect(page.locator(".capture-content").getByRole("status")).toContainText(
    "Nichts wurde geändert: Erlaubt sind 20 Änderungen pro Tag",
  );
  await expect(page.locator('[data-action="retry-development-write"]')).toHaveCount(0);
  expect(writes.production).toHaveLength(1);
});

test("an unclear answer keeps the same operation and checks it again on the real OSM route", async ({
  page,
  context,
}) => {
  const writes = await recordWrites(page, (index) =>
    index === 0
      ? { status: 202, json: { status: "uncertain" } }
      : { status: 200, json: { status: "complete", version: 8 } },
  );
  await openProductionPreview(page, context);
  await page.getByRole("button", { name: "In OpenStreetMap speichern" }).click();
  await expect(page.locator(".capture-content").getByRole("status").first()).toContainText("Ergebnis unklar");
  await closeSaveDialog(page);
  const retry = page.getByRole("button", { name: "Status erneut prüfen" });
  await expect(retry).toBeVisible();
  await expect(retry).not.toContainText("Testserver");
  await retry.click();
  await expect(page.locator(".capture-content").getByRole("status").first()).toContainText(
    "In OpenStreetMap gespeichert.",
  );
  expect(writes.production).toHaveLength(2);
  expect(writes.production[1].operation_id).toBe(writes.production[0].operation_id);
  expect(writes.development).toEqual([]);
});

test("a fresh hit without a version gets no save button, because the server could not detect a later change", async ({
  page,
  context,
}) => {
  const writes = await recordWrites(page, () => ({ status: 200, json: { status: "complete", version: 8 } }));
  await openProductionPreview(page, context, { withoutVersion: true });
  await expect(page.getByRole("button", { name: "In OpenStreetMap speichern" })).toHaveCount(0);
  expect(writes.production).toEqual([]);
});

test("a pending save in the real OSM sends a signed-out person to the OpenStreetMap login, not the test server", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
      JSON.stringify({
        version: 1,
        savedAt: now,
        expiresAt: now + 24 * 60 * 60 * 1_000,
        request: {
          kind: "check-date",
          environment: "production",
          locale: "de",
          operationId: "d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
          target: "node/42",
          candidateLabel: "Rathaus",
          expectedVersion: 3,
          expectedCheckDate: null,
          observedOn: "2026-11-27",
        },
      }),
    );
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: false,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: false,
        developmentWriteAvailable: false,
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Melde dich bei OpenStreetMap an, um den offenen Speichervorgang zu prüfen."),
  ).toBeVisible();
  await expect(page.locator("#osm-sign-in")).toBeFocused();
});

/** Nachgebildete Leseroute für das Formular: frischer Stand vom echten OSM (Standard: dieselbe Version 7 wie die Suche). */
async function routeProductionNode(
  page: Page,
  tags: Record<string, string> = { check_date: "2025-10-20" },
  version = 7,
) {
  const reads: string[] = [];
  await page.route("**/api/osm/node?**", async (route) => {
    reads.push(route.request().url());
    await route.fulfill({ json: { status: "ok", id: "node/123", version, tags } });
  });
  await page.route("**/api/osm/development/node?**", (route) => route.fulfill({ status: 500, json: {} }));
  return reads;
}

test("missing details can be added in the real OSM: the form reads the fresh object, and the save sends only additions", async ({
  page,
  context,
}) => {
  const writes = await recordWrites(page, () => ({ status: 200, json: { status: "complete", version: 10 } }));
  const reads = await routeProductionNode(page, { check_date: "2025-10-20", operator: "Stadt" });
  await openProductionPreview(page, context);
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  // Der vorhandene Wert ist gesperrt; Korrekturen gibt es am echten OSM noch nicht.
  await page.getByText("Jeder", { exact: true }).click();
  await page.locator("#detail-continue").click();

  const preview = page.locator(".capture-content");
  await expect(preview).toContainText("access=yes");
  await expect(preview).toContainText(
    "AED vor Ort geprüft, fehlende Angaben ergänzt / AED checked on site, missing details added (AEDjaeger)",
  );
  await page.getByRole("button", { name: "In OpenStreetMap speichern" }).click();
  await expect(page.locator(".capture-content").getByRole("status")).toContainText(
    "Prüfdatum und neue Angaben in OpenStreetMap gespeichert.",
  );
  expect(reads).toHaveLength(1);
  expect(writes.development).toEqual([]);
  expect(writes.production).toHaveLength(1);
  // Die Version aus der Suche, die das frisch gelesene Objekt bestätigt hat.
  expect(writes.production[0]).toMatchObject({ expected_version: 7, details: { access: "yes" } });
  expect(writes.production[0]).not.toHaveProperty("expected_before");
  expect(writes.production[0]).not.toHaveProperty("confirmed_corrections");
});

test("the hit list offers the details form for a fresh real-OSM hit, but not for an archive hit", async ({
  page,
  context,
}) => {
  const reads = await routeProductionNode(page);
  await openProductionList(page, context);
  await page.getByRole("button", { name: "Angaben ansehen und ergänzen" }).click();
  await expect(page.locator("#detail-continue")).toBeVisible();
  expect(reads).toHaveLength(1);
});

test("an archive hit in the real OSM gets no details button in the list", async ({ page, context }) => {
  await routeProductionNode(page);
  await openProductionList(page, context, { source: "archive" });
  await expect(page.getByRole("button", { name: "Als noch vorhanden bestätigen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Angaben ansehen und ergänzen" })).toHaveCount(0);
});

test("if the AED changed since the search, the form refuses to continue and asks for a new search", async ({
  page,
  context,
}) => {
  // Suche: Version 7. Beim Öffnen des Formulars liefert OSM Version 8, zum Beispiel weil jemand den AED verschoben hat.
  const writes = await recordWrites(page, () => ({ status: 200, json: { status: "complete", version: 9 } }));
  await routeProductionNode(page, { check_date: "2025-10-20" }, 8);
  await openProductionPreview(page, context);
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await expect(page.locator(".capture-content")).toContainText("nicht mehr verfügbar");
  await expect(page.locator("#detail-continue")).toHaveCount(0);
  expect(writes.production).toEqual([]);
});
