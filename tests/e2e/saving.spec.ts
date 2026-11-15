import { expect, test } from "@playwright/test";
import {
  languageCodes,
  testDevelopmentOwnerHash,
  beginNearbySearch,
  publishNewVersion,
  installFakeAudio,
  readSound,
  openCheckDateSaveButton,
  openCandidateList,
  openExistingAedPreview,
  freshNode,
  knownNode,
  correctButton,
} from "./support";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: false,
        developmentSession: false,
      },
    }),
  );
});

test("the development-session preview sends one explicitly confirmed, versioned check-date update", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: true,
        developmentWriteAvailable: true,
        developmentWriteOwnerHash: testDevelopmentOwnerHash,
      },
    }),
  );
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({
      json: {
        status: "complete",
        coverage_radius_meters: 112,
        candidates: [
          {
            id: "node/123",
            osmType: "node",
            version: 7,
            coordinateQuality: "exact",
            position: { latitude: 52.52001, longitude: 13.40501 },
            tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2025-10-20" },
          },
        ],
      },
    }),
  );
  const writeRequests: Array<Record<string, unknown>> = [];
  // Die Antwort wird festgehalten, damit sich der Zustand „wird gesendet“ prüfen lässt.
  let releaseWrite: () => void = () => undefined;
  const writeMayFinish = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  await page.route("**/api/osm/development/check-date", async (route) => {
    expect(route.request().method()).toBe("POST");
    writeRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await writeMayFinish;
    await route.fulfill({ json: { status: "complete", version: 8 } });
  });

  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.locator('[data-action="confirm-sighting"]').click();
  await beginNearbySearch(page);
  await page.getByRole("button", { name: "Als noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("button", { name: "Testserver: Prüfdatum speichern" })).toBeVisible();
  // Mit Speichern-Knopf steht kein Hinweis „nur eine Vorschau“.
  await expect(page.locator(".capture-content")).not.toContainText("Nur eine Vorschau");
  await page.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();
  // Während des Sendens wäre „Nichts wurde gespeichert“ irreführend.
  await expect(page.getByRole("status")).toContainText("wird gesendet");
  await expect(page.locator(".capture-content")).not.toContainText("Nur eine Vorschau");
  releaseWrite();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");
  // Nach dem Speichern darf der Hinweis erst recht nicht neben der Erfolgsmeldung stehen.
  await expect(page.locator(".capture-content")).not.toContainText("Nur eine Vorschau");
  expect(writeRequests).toHaveLength(1);
  expect(writeRequests[0]).toMatchObject({
    confirmed: true,
    target: "node/123",
    expected_version: 7,
    expected_check_date: "2025-10-20",
  });
  expect(writeRequests[0].operation_id).toMatch(/^[0-9a-f-]{36}$/u);
});

test("an expired saved write is discarded instead of opening a stale recovery screen", async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
      JSON.stringify({
        version: 1,
        savedAt: now - 8 * 24 * 60 * 60 * 1_000,
        expiresAt: now - 24 * 60 * 60 * 1_000,
        request: {
          kind: "check-date",
          operationId: "d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
          target: "node/42",
          candidateLabel: "Rathaus",
          expectedVersion: 3,
          expectedCheckDate: null,
          observedOn: "2026-11-14",
        },
      }),
    );
  });
  await page.goto("/");
  await expect(page.locator("#camera-input")).toBeAttached();
  await expect(page.locator(".capture-content")).not.toContainText("Ergebnis unklar");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab"),
    ),
  ).toBeNull();
});

test("a pending write from the previous session-storage format is migrated", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: true,
        developmentWriteAvailable: true,
        developmentWriteOwnerHash: testDevelopmentOwnerHash,
      },
    }),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "aedjaeger-pending-osm-development-write",
      JSON.stringify({
        kind: "check-date",
        operationId: "d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
        target: "node/42",
        candidateLabel: "Rathaus",
        expectedVersion: 3,
        expectedCheckDate: null,
        observedOn: "2026-11-14",
      }),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Testserver: Status erneut prüfen" })).toBeVisible();
  const storage = await page.evaluate(() => ({
    local: localStorage.getItem("aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab"),
    legacy: sessionStorage.getItem("aedjaeger-pending-osm-development-write"),
  }));
  expect(JSON.parse(storage.local ?? "{}")).toMatchObject({
    version: 1,
    request: { operationId: "d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab" },
  });
  expect(storage.legacy).toBeNull();
});

test("a legacy pending write still recovers when localStorage migration fails", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: true,
        developmentWriteAvailable: true,
        developmentWriteOwnerHash: testDevelopmentOwnerHash,
      },
    }),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "aedjaeger-pending-osm-development-write",
      JSON.stringify({
        kind: "check-date",
        operationId: "d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
        target: "node/42",
        candidateLabel: "Rathaus",
        expectedVersion: 3,
        expectedCheckDate: null,
        observedOn: "2026-11-14",
      }),
    );
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("aedjaeger-pending-osm-development-write:"))
        throw new DOMException("quota exceeded", "QuotaExceededError");
      originalSetItem.call(this, key, value);
    };
  });

  await page.goto("/");

  await expect(page.getByRole("button", { name: "Mit OSM-Testserver verbunden" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Testserver: Status erneut prüfen" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("aedjaeger-pending-osm-development-write"))).not.toBeNull();
});

test("a pending write stays visible while signed out and continue starts test-server sign-in", async ({ page }) => {
  let testServerLoginStarted = false;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: false,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: false,
      },
    }),
  );
  await page.route("**/api/auth/osm/development/start", async (route) => {
    testServerLoginStarted = true;
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Testserver login</title>" });
  });
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
      JSON.stringify({
        version: 1,
        savedAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
        request: {
          kind: "check-date",
          operationId: "d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
          target: "node/42",
          candidateLabel: "Rathaus",
          expectedVersion: 3,
          expectedCheckDate: null,
          observedOn: "2026-11-14",
        },
      }),
    );
  });
  await page.goto("/");
  await expect(page.locator(".login-status-wrap")).toContainText("Melde dich beim OSM-Testserver an");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page).toHaveURL(/\/api\/auth\/osm\/development\/start$/u);
  expect(testServerLoginStarted).toBe(true);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab"),
    ),
  ).not.toBeNull();
});

test("a restored pending write uses its saved operation ID and ends with a clear success action", async ({ page }) => {
  const operationIds: unknown[] = [];
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: true,
        developmentWriteAvailable: true,
        developmentWriteOwnerHash: testDevelopmentOwnerHash,
      },
    }),
  );
  await page.route("**/api/osm/development/check-date", async (route) => {
    operationIds.push((route.request().postDataJSON() as Record<string, unknown>).operation_id);
    await route.fulfill({ json: { status: "complete", version: 9 } });
  });
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
      JSON.stringify({
        version: 1,
        savedAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
        ownerHash: "a".repeat(64),
        request: {
          kind: "check-date",
          operationId: "d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
          target: "node/42",
          candidateLabel: "Rathaus",
          expectedVersion: 3,
          expectedCheckDate: null,
          observedOn: "2026-11-14",
        },
      }),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Testserver: Status erneut prüfen" }).click();
  await expect(page.locator(".capture-content")).toContainText("Vor-Ort-Prüfung gespeichert");
  await expect(page.locator(".capture-content .status-good")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nächsten AED fotografieren" })).toBeVisible();
  expect(operationIds).toEqual(["d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab"]);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab"),
    ),
  ).toBeNull();
});

test("a restored write is not submitted under a different OSM test-server account", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: true,
        developmentWriteAvailable: true,
        developmentWriteOwnerHash: "b".repeat(64),
      },
    }),
  );
  await page.route("**/api/osm/development/check-date", async (route) => {
    writes += 1;
    await route.fulfill({ json: { status: "complete", version: 10 } });
  });
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
      JSON.stringify({
        version: 1,
        savedAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
        ownerHash: "a".repeat(64),
        request: {
          kind: "check-date",
          operationId: "d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
          target: "node/42",
          candidateLabel: "Rathaus",
          expectedVersion: 3,
          expectedCheckDate: null,
          observedOn: "2026-11-14",
        },
      }),
    );
  });
  await page.goto("/");
  await expect(page.locator(".capture-content")).toContainText("anderen OSM-Testserver-Konto");
  await expect(page.locator('[data-action="continue-recovery"]')).toHaveCount(0);
  expect(writes).toBe(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab"),
    ),
  ).not.toBeNull();
});

test("a recovery identity mismatch keeps the write when another tab changed the shared session", async ({ page }) => {
  let sessionChecks = 0;
  let writes = 0;
  await page.route("**/api/auth/session", (route) => {
    sessionChecks += 1;
    return route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: true,
        developmentWriteAvailable: true,
        developmentWriteOwnerHash: sessionChecks === 1 ? "a".repeat(64) : "b".repeat(64),
      },
    });
  });
  await page.route("**/api/osm/development/check-date", async (route) => {
    writes += 1;
    await route.fulfill({ status: 403, json: { error: "recovery_identity_mismatch" } });
  });
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
      JSON.stringify({
        version: 1,
        savedAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
        ownerHash: "a".repeat(64),
        request: {
          kind: "check-date",
          operationId: "d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab",
          target: "node/42",
          candidateLabel: "Rathaus",
          expectedVersion: 3,
          expectedCheckDate: null,
          observedOn: "2026-11-14",
        },
      }),
    );
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Testserver: Status erneut prüfen" }).click();

  await expect(page.locator(".capture-content")).toContainText("anderen OSM-Testserver-Konto");
  await expect(page.locator('[data-action="continue-recovery"]')).toHaveCount(0);
  expect(writes).toBe(1);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("aedjaeger-pending-osm-development-write:d5c1a2e3-5b6d-4a7c-8d9e-0123456789ab"),
    ),
  ).not.toBeNull();
});

test("separate tabs keep their own pending write when one tab completes", async ({ page, context }) => {
  const otherTab = await context.newPage();
  const first = await openExistingAedPreview(page, context, { nodes: [freshNode({})] });
  const second = await openExistingAedPreview(otherTab, context, {
    nodes: [freshNode({})],
    writeStatus: 202,
    writeBody: { status: "uncertain" },
  });

  await otherTab.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();
  await expect(otherTab.getByRole("status")).toContainText("Ergebnis unklar");
  const secondOperationId = second.writes[0].operation_id as string;
  await page.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");

  expect(first.writes[0].operation_id).not.toBe(secondOperationId);
  expect(
    await page.evaluate(
      (operationId) => localStorage.getItem(`aedjaeger-pending-osm-development-write:${operationId}`),
      secondOperationId,
    ),
  ).not.toBeNull();
  expect(
    await page.evaluate(
      (operationId) => localStorage.getItem(`aedjaeger-pending-osm-development-write:${operationId}`),
      first.writes[0].operation_id,
    ),
  ).toBeNull();
});

test("the information dialog and sound choice survive a confirmed save arriving in the background", async ({
  page,
  context,
}) => {
  await openExistingAedPreview(page, context, { nodes: [freshNode({})] });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/osm/development/check-date", async (route) => {
    await gate;
    await route.fulfill({ json: { status: "complete", version: 10 } });
  });
  await page.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();
  await expect(page.locator(".capture-content")).toContainText("wird gesendet");
  await page.locator("#open-info").click();
  await page.locator("#success-sound-toggle").check();
  release();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#success-sound-toggle")).toBeChecked();
  await expect(page.locator(".capture-content .status-good")).toBeVisible();
});

test("the confirmation page shows the earlier check date only when there is one", async ({ page }) => {
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({
      json: {
        status: "complete",
        coverage_radius_meters: 112,
        candidates: [
          {
            id: "node/123",
            osmType: "node",
            version: 7,
            coordinateQuality: "exact",
            position: { latitude: 52.52001, longitude: 13.40501 },
            tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2025-01-01" },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await page.locator('[data-action="preview-candidate"]').click();
  await expect(page.locator(".capture-content")).toContainText("Bisher: 1. Januar 2025");
});

test("the success sound plays once, only after the server confirmed the save, and is unlocked by the tap", async ({
  page,
  context,
}) => {
  await installFakeAudio(page);
  let releaseWrite: () => void = () => undefined;
  const writeMayFinish = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const saveButton = await openCheckDateSaveButton(page, context, async (route) => {
    await writeMayFinish;
    await route.fulfill({ json: { status: "complete", version: 8 } });
  });
  // Vor dem Tippen: kein Audio-Baustein, kein Ton (schont Musik im Hintergrund).
  expect(await readSound(page)).toEqual({ contexts: 0, resumes: 0, oscillators: 0 });
  await saveButton.click();
  await expect(page.getByRole("status")).toContainText("wird gesendet");
  // Beim Tippen freigeschaltet, aber noch kein Ton: Der Server hat noch nicht bestätigt.
  expect(await readSound(page)).toMatchObject({ contexts: 1, oscillators: 0 });
  releaseWrite();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");
  // Genau ein Ton aus vier Noten.
  expect((await readSound(page)).oscillators).toBe(4);
});

test("no success sound when the save ends unclear", async ({ page, context }) => {
  await installFakeAudio(page);
  const saveButton = await openCheckDateSaveButton(page, context, (route) =>
    route.fulfill({ status: 503, json: { error: "write_status_unavailable" } }),
  );
  await saveButton.click();
  await expect(page.getByRole("status")).toContainText("Ergebnis unklar");
  expect((await readSound(page)).oscillators).toBe(0);
});

test("no success sound when the server reports a conflict", async ({ page, context }) => {
  await installFakeAudio(page);
  const saveButton = await openCheckDateSaveButton(page, context, (route) =>
    route.fulfill({ status: 409, json: { error: "newer_check_date_exists" } }),
  );
  await saveButton.click();
  await expect(page.getByRole("status")).not.toContainText("wird gesendet");
  await page.waitForTimeout(300);
  expect((await readSound(page)).oscillators).toBe(0);
});

test("with the sound switched off, a confirmed save is silent and no audio is even created", async ({
  page,
  context,
}) => {
  await installFakeAudio(page);
  await page.addInitScript(() => localStorage.setItem("aedjaeger-success-sound", "off"));
  const saveButton = await openCheckDateSaveButton(page, context, (route) =>
    route.fulfill({ json: { status: "complete", version: 8 } }),
  );
  await saveButton.click();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");
  expect(await readSound(page)).toEqual({ contexts: 0, resumes: 0, oscillators: 0 });
});

test("the sound switch in the info dialog is saved, plays a preview when switched on, and exists in all six languages", async ({
  page,
}) => {
  await installFakeAudio(page);
  await page.goto("/");
  const expectedLabel: Record<string, string> = {
    de: "Ton, wenn das Speichern gelingt",
    en: "Sound when saving succeeds",
    pl: "Dźwięk po udanym zapisie",
    ja: "保存に成功したら音を鳴らす",
    fr: "Son lorsque l'enregistrement réussit",
    es: "Sonido cuando el guardado se completa",
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await page.locator("#open-info").click();
    await expect(page.locator(".sound-toggle"), `Beschriftung in ${code}`).toContainText(expectedLabel[code]);
    await page.keyboard.press("Escape");
  }
  await page.locator("#language").selectOption("de");
  await page.locator("#open-info").click();
  const toggle = page.locator("#success-sound-toggle");
  await expect(toggle).toBeChecked(); // Standard: an.
  await toggle.uncheck();
  expect(await page.evaluate(() => localStorage.getItem("aedjaeger-success-sound"))).toBe("off");
  expect((await readSound(page)).oscillators).toBe(0); // Ausschalten klingt nicht.
  await toggle.check();
  expect(await page.evaluate(() => localStorage.getItem("aedjaeger-success-sound"))).toBe("on");
  expect((await readSound(page)).oscillators).toBe(4); // Einschalten spielt einmal vor.
  // Nach dem Neuladen bleibt die Wahl erhalten.
  await toggle.uncheck();
  await page.reload();
  await page.locator("#open-info").click();
  await expect(page.locator("#success-sound-toggle")).not.toBeChecked();
});

test("the sound can be switched off for the open page even when the browser storage is blocked", async ({
  page,
  context,
}) => {
  await installFakeAudio(page);
  // Wie bei vollem oder gesperrtem Speicher: Das Schreiben der Ton-Einstellung schlägt fehl (QuotaExceededError).
  // Andere Schlüssel (zum Beispiel der offene Speichervorgang) bleiben schreibbar, sonst verweigert die App das
  // Speichern auf dem Testserver aus Sicherheitsgründen.
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "aedjaeger-success-sound") throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  let writes = 0;
  const saveButton = await openCheckDateSaveButton(page, context, async (route) => {
    writes += 1;
    await route.fulfill({ json: { status: "complete", version: 8 } });
  });
  // Der Schalter im Info-Dialog: ausschalten, und die Wahl hält bis zum Neuladen.
  await page.locator("#open-info").click();
  const toggle = page.locator("#success-sound-toggle");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");
  await saveButton.click();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");
  expect(writes).toBe(1);
  expect(await readSound(page)).toEqual({ contexts: 0, resumes: 0, oscillators: 0 });
  // Der Schalter springt nach einer neuen Darstellung nicht zurück auf „an“.
  await page.locator("#open-info").click();
  await expect(page.locator("#success-sound-toggle")).not.toBeChecked();
});

test("an already-current check date says nothing was changed, plays no sound and offers no second save", async ({
  page,
  context,
}) => {
  await installFakeAudio(page);
  let writes = 0;
  const saveButton = await openCheckDateSaveButton(page, context, async (route) => {
    writes += 1;
    await route.fulfill({ json: { status: "complete", version: 1, already_current: true } });
  });
  await saveButton.click();
  await expect(page.getByRole("status")).toContainText("Schon aktuell. Es wurde nichts geändert.");
  // Nicht als "gespeichert" ausgeben, kein Ton, kein zweiter Speichern-Knopf.
  await expect(page.getByRole("status")).not.toContainText("gespeichert");
  await expect(page.getByRole("button", { name: "Testserver: Prüfdatum speichern" })).toHaveCount(0);
  expect(writes).toBe(1);
  expect((await readSound(page)).oscillators).toBe(0);
  // Der Hinweis steht in allen sechs Sprachen da.
  const expected: Record<string, string> = {
    de: "Schon aktuell",
    en: "Already up to date",
    pl: "Już aktualne",
    ja: "すでに最新です",
    fr: "déjà à jour",
    es: "ya está actualizado",
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await expect(page.getByRole("status"), `Meldung in ${code}`).toContainText(expected[code]);
  }
});

test("a real change still says saved and plays the sound once", async ({ page, context }) => {
  await installFakeAudio(page);
  const saveButton = await openCheckDateSaveButton(page, context, (route) =>
    route.fulfill({ json: { status: "complete", version: 2 } }),
  );
  await saveButton.click();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");
  await expect(page.getByRole("status")).not.toContainText("Schon aktuell");
  expect((await readSound(page)).oscillators).toBe(4);
});

test("an AED from the real archive has no save button on the test server and says why, in all six languages", async ({
  page,
  context,
}) => {
  let writes = 0;
  await openCheckDateSaveButton(
    page,
    context,
    async (route) => {
      writes += 1;
      await route.fulfill({ json: { status: "complete", version: 8 } });
    },
    undefined,
    "archive",
  );
  await expect(page.getByRole("button", { name: "Testserver: Prüfdatum speichern" })).toHaveCount(0);
  await expect(page.locator(".result-message")).toContainText("Dieser AED stammt aus dem echten OSM");
  await expect(page.locator(".result-message")).not.toContainText("Nur eine Vorschau");
  const expected: Record<string, string> = {
    de: "stammt aus dem echten OSM",
    en: "comes from the real OSM",
    pl: "pochodzi z prawdziwego OSM",
    ja: "本番のOSMのもの",
    fr: "provient du vrai OSM",
    es: "procede del OSM real",
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await expect(page.locator(".result-message"), `Hinweis in ${code}`).toContainText(expected[code]);
  }
  expect(writes).toBe(0);
});

test("an AED found on the test server itself can be saved", async ({ page, context }) => {
  const saveButton = await openCheckDateSaveButton(
    page,
    context,
    (route) => route.fulfill({ json: { status: "complete", version: 2 } }),
    undefined,
    "development",
  );
  await expect(saveButton).toBeVisible();
  await expect(page.locator(".result-message")).not.toContainText("stammt aus dem echten OSM");
});

test("a photo older than the check date already in OSM cannot be saved, says why, and names that date, in all six languages", async ({
  page,
  context,
}) => {
  await openCandidateList(
    page,
    context,
    [
      {
        id: "node/101",
        name: "Rathaus",
        latitudeOffsetMeters: 3,
        tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2099-01-01" },
      },
    ],
    { development: true },
  );
  await page.locator('[data-action="preview-candidate"]').click();
  await expect(page.locator(".result-message")).toContainText(
    "In OpenStreetMap steht schon ein neueres Prüfdatum (1. Januar 2099)",
  );
  await expect(page.locator(".result-message")).toContainText("Es wird nichts geändert");
  // Kein Speichern-Knopf und kein „nur eine Vorschau“.
  await expect(page.getByRole("button", { name: "Testserver: Prüfdatum speichern" })).toHaveCount(0);
  await expect(page.locator(".result-message")).not.toContainText("Nur eine Vorschau");
  await expect(page.locator(".result-message")).not.toContainText("kein einzelner AED-Knoten");
  const expected: Record<string, string> = {
    de: "neueres Prüfdatum",
    en: "newer check date",
    pl: "nowsza data kontroli",
    ja: "新しい確認日",
    fr: "plus récente",
    es: "más reciente",
  };
  const dates: Record<string, string> = {
    de: "1. Januar 2099",
    en: "January 1, 2099",
    pl: "1 stycznia 2099",
    ja: "2099年1月1日",
    fr: "1 janvier 2099",
    es: "1 de enero de 2099",
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await expect(page.locator(".result-message"), `Hinweis in ${code}`).toContainText(expected[code]);
    await expect(page.locator(".result-message")).toContainText(dates[code]);
    await expect(page.locator(".result-message")).not.toContainText("2099-01-01");
  }
});

test("the same or an older check date in OSM still allows saving", async ({ page, context }) => {
  await openCandidateList(
    page,
    context,
    [
      {
        id: "node/101",
        name: "Rathaus",
        latitudeOffsetMeters: 3,
        tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2020-01-01" },
      },
    ],
    { development: true },
  );
  await page.locator('[data-action="preview-candidate"]').click();
  await expect(page.getByRole("button", { name: "Testserver: Prüfdatum speichern" })).toBeVisible();
});

test("going back from the preview keeps the changes and shows the old values again", async ({ page, context }) => {
  await openExistingAedPreview(page, context, { nodes: [freshNode(knownNode)], corrections: true });
  await correctButton(page).click();
  await page.getByText("Nur Kunden", { exact: true }).click();
  await page.locator("#detail-continue").click();
  await expect(page.locator(".capture-content")).toContainText("access=private → customers");
  await page.getByRole("button", { name: "Zurück zu den Angaben" }).click();
  await expect(page.locator("#detail-access-customers")).toBeChecked();
  await expect(page.locator("#detail-group-access")).toContainText("Vorher: Nicht öffentlich");
  await expect(page.locator("#detail-continue")).toHaveText("Weiter · 1 Angabe");
});

test("the brand link cannot discard a draft while the save result is unclear", async ({ page, context }) => {
  await openExistingAedPreview(page, context, {
    nodes: [freshNode({})],
    writeStatus: 202,
    writeBody: { status: "uncertain" },
  });
  await page.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Ergebnis unklar");

  const currentUrl = page.url();
  const brand = page.locator(".brand");
  await expect(brand).toHaveAttribute("aria-disabled", "true");
  await brand.dispatchEvent("click");

  // Der Entwurf bleibt: kein Seitenwechsel, das Foto steht noch da, und die Wiederaufnahme bleibt erreichbar.
  await expect(page).toHaveURL(currentUrl);
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Testserver: Status erneut prüfen" })).toBeVisible();
});

test("the brand link stays disabled while a save is being sent and is free again afterwards", async ({
  page,
  context,
}) => {
  await openExistingAedPreview(page, context, { nodes: [freshNode({})] });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Die spätere Route gewinnt: Die Antwort kommt erst, wenn der Test sie freigibt.
  await page.route("**/api/osm/development/check-date", async (route) => {
    await gate;
    await route.fulfill({ json: { status: "complete", version: 10 } });
  });
  await page.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();

  const brand = page.locator(".brand");
  await expect(page.getByRole("status")).toContainText("wird gesendet");
  await expect(brand).toHaveAttribute("aria-disabled", "true");
  await brand.dispatchEvent("click");
  await expect(page.getByRole("status")).toBeVisible();

  release();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");
  await expect(brand).not.toHaveAttribute("aria-disabled", "true");
});

test("the reload button stays blocked while a save result is unclear", async ({ page, context }) => {
  await publishNewVersion(page);
  await openExistingAedPreview(page, context, {
    nodes: [freshNode({})],
    writeStatus: 202,
    writeBody: { status: "uncertain" },
  });
  await expect(page.locator("#update-banner")).toBeVisible();
  await page.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();
  // Der Update-Hinweis ist selbst ein Status; die Meldung zum Speichern steht im Inhaltsbereich.
  await expect(page.locator(".capture-content").getByRole("status")).toContainText("Ergebnis unklar");

  // Ungeklärtes Speichern: Neuladen wäre gefährlich, der Knopf ist gesperrt und der Grund steht da.
  const banner = page.locator("#update-banner");
  await expect(banner.getByRole("button", { name: "Neu laden" })).toBeDisabled();
  await expect(banner).toContainText("Neu laden geht, sobald das Speichern abgeschlossen ist.");

  // Nach der Statusprüfung ist der Vorgang abgeschlossen und der Knopf wieder frei.
  await page.route("**/api/osm/development/check-date", (route) =>
    route.fulfill({ json: { status: "complete", version: 10 } }),
  );
  await page.getByRole("button", { name: "Testserver: Status erneut prüfen" }).click();
  await expect(page.locator(".capture-content")).toContainText("Vor-Ort-Prüfung gespeichert");
  await expect(banner.getByRole("button", { name: "Neu laden" })).toBeEnabled();
});

test("an uncertain test-server response survives reload and retries with the same operation ID", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: true,
        developmentWriteAvailable: true,
        developmentWriteOwnerHash: testDevelopmentOwnerHash,
      },
    }),
  );
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({
      json: {
        status: "complete",
        coverage_radius_meters: 112,
        candidates: [
          {
            id: "node/123",
            osmType: "node",
            version: 7,
            coordinateQuality: "exact",
            position: { latitude: 52.52001, longitude: 13.40501 },
            tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2025-10-20" },
          },
        ],
      },
    }),
  );
  const operationIds: unknown[] = [];
  let attempts = 0;
  await page.route("**/api/osm/development/check-date", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    operationIds.push(payload.operation_id);
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 202, json: { status: "uncertain" } });
    else await route.fulfill({ json: { status: "complete", version: 8 } });
  });

  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.locator('[data-action="confirm-sighting"]').click();
  await beginNearbySearch(page);
  await page.getByRole("button", { name: "Als noch vorhanden bestätigen" }).click();
  await page.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Ergebnis unklar");
  await page.reload();
  await expect(page.getByRole("button", { name: "Testserver: Status erneut prüfen" })).toBeVisible();
  await page.getByRole("button", { name: "Testserver: Status erneut prüfen" }).click();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");
  expect(operationIds).toHaveLength(2);
  expect(operationIds[1]).toBe(operationIds[0]);
});

test("the confirmation page shows only the essentials and offers no way out of the app", async ({ page }) => {
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({
      json: {
        status: "complete",
        coverage_radius_meters: 112,
        candidates: [
          {
            id: "node/123",
            osmType: "node",
            version: 7,
            coordinateQuality: "exact",
            position: { latitude: 52.52001, longitude: 13.40501 },
            tags: { emergency: "defibrillator", "defibrillator:location": "Links neben dem Garagentor" },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await page.locator('[data-action="preview-candidate"]').click();

  const content = page.locator(".capture-content");
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toBeVisible();
  await expect(content).toContainText("Links neben dem Garagentor");
  await expect(content).toContainText("Prüfdatum:");
  // Weg sind: Verweis nach OpenStreetMap, „Ausgewählter AED:“, „Einzige vorgeschlagene Änderung“, „Bisher: nicht gesetzt“.
  await expect(content.locator("a")).toHaveCount(0);
  for (const removed of [
    "In OpenStreetMap",
    "Ausgewählter AED",
    "Einzige vorgeschlagene",
    "Bisher",
    "nicht gesetzt",
    "Testserver",
  ]) {
    await expect(content).not.toContainText(removed);
  }
  // Ein einziger Treffer: „Zurück zu den Treffern“ hätte keine Bedeutung und entfällt.
  await expect(page.locator("[data-action='back-to-candidates']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Foto verwerfen" })).toBeVisible();
});

test("with several matches the confirmation page can go back to choose another one", async ({ page }) => {
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({
      json: {
        status: "complete",
        coverage_radius_meters: 112,
        candidates: [
          {
            id: "node/123",
            osmType: "node",
            version: 7,
            coordinateQuality: "exact",
            position: { latitude: 52.52001, longitude: 13.40501 },
            tags: { emergency: "defibrillator", name: "Rathaus" },
          },
          {
            id: "node/124",
            osmType: "node",
            version: 3,
            coordinateQuality: "exact",
            position: { latitude: 52.52002, longitude: 13.40502 },
            tags: { emergency: "defibrillator", name: "Bahnhof" },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await page.locator('[data-action="preview-candidate"]').first().click();
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toBeVisible();
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
});

test("a node without a name shows a readable label instead of the technical identifier, in all six languages", async ({
  page,
  context,
}) => {
  const saveButton = await openCheckDateSaveButton(
    page,
    context,
    (route) => route.fulfill({ json: { status: "complete", version: 2 } }),
    { emergency: "defibrillator", check_date: "2025-10-20" },
  );
  await expect(saveButton).toBeVisible();
  const preview = page.locator(".result-message");
  await expect(preview).not.toContainText("node/123");
  const expected: Record<string, string> = {
    de: "AED (ohne Namen)",
    en: "AED (no name)",
    pl: "AED (bez nazwy)",
    ja: "AED（名称なし）",
    fr: "DAE (sans nom)",
    es: "DEA (sin nombre)",
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await expect(preview, `Bezeichnung in ${code}`).toContainText(expected[code]);
  }
});

test("a named node still shows its name", async ({ page, context }) => {
  const saveButton = await openCheckDateSaveButton(page, context, (route) =>
    route.fulfill({ json: { status: "complete", version: 2 } }),
  );
  await expect(saveButton).toBeVisible();
  await expect(page.locator(".result-message")).toContainText("Rathaus");
});

test("a node that does not exist on the test server ends in a clear message without a retry button, in all six languages", async ({
  page,
  context,
}) => {
  let writes = 0;
  const saveButton = await openCheckDateSaveButton(page, context, async (route) => {
    writes += 1;
    await route.fulfill({ status: 404, json: { error: "target_not_found" } });
  });
  await saveButton.click();
  await expect(page.getByRole("status")).toContainText("existiert auf dem Testserver nicht");
  await expect(page.getByRole("status")).not.toContainText("unklar");
  // Kein Prüfen-Knopf: Ein Wiederholen ergäbe dasselbe.
  await expect(page.locator('[data-action="retry-development-write"]')).toHaveCount(0);
  expect(writes).toBe(1);
  const expected: Record<string, string> = {
    de: "existiert auf dem Testserver nicht",
    en: "does not exist on the test server",
    pl: "nie istnieje na serwerze testowym",
    ja: "テストサーバーには存在しません",
    fr: "n'existe pas sur le serveur de test",
    es: "no existe en el servidor de pruebas",
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await expect(page.getByRole("status"), `Meldung in ${code}`).toContainText(expected[code]);
  }
});

test("a definitive server failure is shown as failed, not as unclear, and has no retry button", async ({
  page,
  context,
}) => {
  const saveButton = await openCheckDateSaveButton(page, context, (route) =>
    route.fulfill({ status: 502, json: { error: "write_failed" } }),
  );
  await saveButton.click();
  await expect(page.getByRole("status")).toContainText("Änderung fehlgeschlagen");
  await expect(page.getByRole("status")).not.toContainText("unklar");
  await expect(page.locator('[data-action="retry-development-write"]')).toHaveCount(0);
});

test("a transient server error still counts as unclear and offers the retry button", async ({ page, context }) => {
  const saveButton = await openCheckDateSaveButton(page, context, (route) =>
    route.fulfill({ status: 503, json: { error: "write_status_unavailable" } }),
  );
  await saveButton.click();
  await expect(page.getByRole("status")).toContainText("Ergebnis unklar");
  await expect(page.locator('[data-action="retry-development-write"]')).toBeVisible();
});
