import { expect, test } from "@playwright/test";
import {
  languageCodes,
  testDevelopmentOwnerHash,
  beginNearbySearch,
  takeFreshCameraPhotoWithoutGps,
  setUpFailingFirstSearch,
  openCandidateList,
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

test("a user-confirmed location search shows nearby candidates without writing to OSM", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ latitude: 52.52, longitude: 13.405, accuracy_meters: 12 });
    await route.fulfill({
      json: {
        status: "complete",
        coverage_radius_meters: 112,
        candidates: [
          {
            id: "node/123",
            osmType: "node",
            coordinateQuality: "exact",
            position: { latitude: 52.52001, longitude: 13.40501 },
            tags: {
              emergency: "defibrillator",
              name: "Rathaus <img src=x onerror=alert(2)>",
              check_date: "<img src=x onerror=alert(1)>",
            },
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);

  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  await expect(page.locator(".candidate-list")).toContainText("Rathaus");
  await expect(page.locator(".candidate-list a")).toHaveCount(0);
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  // Bei Treffern zeigt die App eine Umgebungskarte mit einem nummerierten Marker je Treffer.
  await expect(page.locator("#candidate-overview-map")).toBeVisible();
  await expect(
    page.locator("#candidate-overview-map .position-map-marker:not(.position-map-marker-origin)"),
  ).toHaveText(["1"]);
  // Der gesuchte Standort ist ein fest verankerter roter Marker. Beim Verschieben der Karte
  // muss er mitwandern – sonst würde er eine falsche Stelle als Standort anzeigen.
  const origin = page.locator("#candidate-overview-map .position-map-marker-origin");
  await expect(origin).toHaveCount(1);
  await expect(page.locator("#candidate-overview-map .position-map-crosshair")).toBeHidden();
  const readMarkerPositions = () =>
    page.locator("#candidate-overview-map .position-map-marker").evaluateAll((markers) =>
      markers.map((marker) => ({
        x: Number.parseFloat((marker as HTMLElement).style.left),
        y: Number.parseFloat((marker as HTMLElement).style.top),
      })),
    );
  const [originBefore, candidateBefore] = await readMarkerPositions();
  await page.locator("#candidate-overview-map").focus();
  await page.keyboard.press("ArrowRight");
  const [originAfter, candidateAfter] = await readMarkerPositions();
  // Die Pfeiltaste verschiebt den Karteninhalt um 32 Pixel – der Standortmarker wandert mit.
  expect(originAfter.x).toBeCloseTo(originBefore.x + 32, 0);
  expect(candidateAfter.x - originAfter.x).toBeCloseTo(candidateBefore.x - originBefore.x, 0);
  const readMapZoom = async () => {
    const source = await page.locator("#candidate-overview-map .position-map-tiles img").first().getAttribute("src");
    expect(source).not.toBeNull();
    return Number(new URL(source!).pathname.split("/")[1]);
  };
  const zoomBeforeKey = await readMapZoom();
  await page.keyboard.press("-");
  await expect.poll(readMapZoom).toBe(zoomBeforeKey - 1);
  await page.keyboard.press("=");
  await expect.poll(readMapZoom).toBe(zoomBeforeKey);
  await expect(page.locator("#candidate-overview-map")).toHaveAttribute(
    "aria-describedby",
    "overview-map-instructions",
  );
  await expect(page.locator(".candidate-item strong")).toContainText("1. Rathaus");
  expect(searchRequests).toBe(1);

  await page.getByRole("button", { name: "Als noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText("Prüfdatum:");
  // Keine Zusatztexte und keine Verweise nach außen auf der Bestätigungsseite.
  await expect(page.locator(".capture-content")).not.toContainText("Einzige vorgeschlagene Änderung");
  await expect(page.locator(".capture-content a")).toHaveCount(0);
  await expect(page.locator(".capture-content")).toContainText("Rathaus <img src=x onerror=alert(2)>");
  await expect(page.locator(".capture-content")).toContainText("Bisher: <img src=x onerror=alert(1)>");
  await expect(page.locator(".capture-content img[onerror]")).toHaveCount(0);
  await expect(page.locator(".capture-content")).toContainText(
    await page.evaluate(() => {
      return new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date());
    }),
  );
  await expect(page.locator(".capture-content")).toContainText("Nur eine Vorschau. Nichts wurde gespeichert.");
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  // Ein einziger Treffer: „Zurück“ zu einer Auswahl hätte keine Bedeutung und entfällt.
  await expect(page.locator("[data-action='back-to-candidates']")).toHaveCount(0);
  expect(searchRequests).toBe(1);
});

test("retry keeps an explicitly chosen map location instead of silently switching to phone GPS", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  const requests: Array<{ latitude: number; longitude: number; accuracy_meters: number }> = [];
  await page.route("**/api/osm/candidates/search", async (route) => {
    requests.push(route.request().postDataJSON() as (typeof requests)[number]);
    if (requests.length === 1) {
      await route.fulfill({ status: 502, headers: { "Retry-After": "0" }, json: { error: "search_unavailable" } });
      return;
    }
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await page.locator('[data-action="choose-map-location"]').click();
  const map = page.locator("#search-location-map");
  for (let zoom = 0; zoom < 9; zoom += 1) await page.getByRole("button", { name: "Karte vergrößern" }).click();
  await map.focus();
  await page.keyboard.press("ArrowRight");
  const selectedCoordinates = await page.locator("#search-location-coordinates").innerText();
  await page.locator('[data-action="confirm-map-location"]').click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText("Standort auf der Karte ausgewählt");
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(`${requests[0].latitude.toFixed(5)}, ${requests[0].longitude.toFixed(5)}`).toBe(
    selectedCoordinates.match(/-?\d+\.\d{5}, -?\d+\.\d{5}/u)?.[0],
  );
});

test("a new AED preview requires confirmed GPS position and a complete empty search", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5ece3"/></svg>',
    }),
  );
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
  let searchRequests = 0;
  const nonSearchOsmRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/osm/") && !request.url().includes("/api/osm/candidates/search")) {
      nonSearchOsmRequests.push(request.url());
    }
  });
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);
  // Erste Bestätigung: Ohne den ausdrücklichen Tastendruck gibt es weder Karte noch Neuanlage.
  await expect(page.locator(".capture-content")).toContainText("Kein AED-Eintrag in der Nähe gefunden.");
  await expect(page.locator("#new-aed-position-map")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Neuen AED vorbereiten" })).toHaveCount(0);
  await page.getByRole("button", { name: "Hier fehlt ein AED – neu eintragen" }).click();
  await expect(page.getByRole("button", { name: "Neuen AED vorbereiten" })).toBeVisible();
  await expect(page.locator("#new-aed-position-map")).toBeVisible();
  await expect(page.locator(".position-map-attribution")).toContainText("OpenStreetMap contributors");
  const markerCenter = await page.locator(".position-map-crosshair").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  const mapCenter = await page.locator("#new-aed-position-map").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  expect(markerCenter.x).toBeCloseTo(mapCenter.x, 0);
  expect(markerCenter.y).toBeCloseTo(mapCenter.y, 0);

  await page.getByRole("button", { name: "Neuen AED vorbereiten" }).click();
  await expect(page.getByRole("heading", { name: "Vorschau für neuen AED" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText(
    "Bestätige zuerst, dass der AED genau an diesem GPS-Punkt steht.",
  );
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  await page.getByRole("button", { name: "Zurück", exact: true }).click();

  await page.locator("#new-aed-position-confirmed").check();
  await page.locator("#new-aed-position-map").evaluate((element) => {
    const map = element as HTMLDivElement;
    // Commit a pending one-finger pan when a second finger lands, even if it only taps.
    map.setPointerCapture = () => {};
    map.hasPointerCapture = () => false;
    const dispatch = (type: string, pointerId: number, clientX: number, clientY: number) => {
      map.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: pointerId === 1,
          button: 0,
          clientX,
          clientY,
        }),
      );
    };
    dispatch("pointerdown", 1, 120, 120);
    dispatch("pointermove", 1, 170, 120);
    dispatch("pointerdown", 2, 220, 120);
    dispatch("pointerup", 2, 220, 120);
    dispatch("pointerup", 1, 170, 120);
  });
  await expect(page.locator("#new-aed-position-confirmed")).not.toBeChecked();
  await expect(page.locator("#new-aed-position-coordinates")).not.toContainText("52.52000, 13.40500");
  expect(
    await page
      .locator("#new-aed-position-map .position-map-tiles")
      .evaluate((layer) => (layer as HTMLElement).style.transform),
  ).toBe("");

  await page.locator("#new-aed-position-confirmed").check();
  await page.locator("#new-aed-position-map").evaluate((element) => {
    const map = element as HTMLDivElement;
    map.setPointerCapture = () => {};
    map.hasPointerCapture = () => false;
    const dispatch = (type: string, pointerId: number, clientX: number, clientY: number) => {
      map.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: pointerId === 3,
          button: 0,
          clientX,
          clientY,
        }),
      );
    };
    dispatch("pointerdown", 3, 120, 120);
    dispatch("pointerdown", 4, 220, 120);
    dispatch("pointermove", 4, 160, 120);
    dispatch("pointerup", 4, 160, 120);
    dispatch("pointerup", 3, 120, 120);
  });
  const zoomAfterPinch = await page
    .locator("#new-aed-position-map .position-map-tiles img")
    .first()
    .getAttribute("src");
  expect(zoomAfterPinch).not.toBeNull();
  expect(Number(new URL(zoomAfterPinch!).pathname.split("/")[1])).toBeLessThan(19);
  await expect(page.locator("#new-aed-position-confirmed")).toBeChecked();

  await page.locator("#new-aed-position-map").evaluate((element) => {
    const map = element as HTMLDivElement;
    map.setPointerCapture = () => {};
    map.hasPointerCapture = () => false;
    const dispatch = (type: string, pointerId: number, clientX: number, clientY: number) => {
      map.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          clientX,
          clientY,
        }),
      );
    };
    dispatch("pointerdown", 3, 120, 120);
    dispatch("pointermove", 3, 140, 120);
    dispatch("pointerup", 3, 140, 120);
  });
  await expect(page.locator("#new-aed-position-confirmed")).not.toBeChecked();
  await expect(page.locator("#new-aed-position-coordinates")).not.toContainText("52.52000, 13.40500");
  await page.locator("#new-aed-position-confirmed").check();
  await page.getByRole("button", { name: "Neuen AED vorbereiten" }).click();
  // Seit Etappe P2 folgt auf die bestätigte Position das freiwillige Detailformular; ohne Angaben geht es sofort weiter.
  await expect(page.getByRole("heading", { name: "Angaben zum AED" })).toBeVisible();
  await page.getByRole("button", { name: "Weiter ohne Angaben" }).click();
  await expect(page.getByRole("heading", { name: "Vorschau für neuen AED" })).toBeVisible();
  await expect(page.locator(".capture-content")).not.toContainText("52.52000, 13.40500");
  await expect(page.locator(".capture-content")).toContainText("emergency=defibrillator");
  await expect(page.locator(".capture-content")).toContainText("check_date=");
  // Kein Verweis nach außen auf der Vorschau.
  await expect(page.locator(".capture-content a")).toHaveCount(0);
  // Mit Speichern-Knopf („Testserver: AED eintragen“) entfällt der Hinweis „nur eine Vorschau“.
  await expect(page.locator(".capture-content")).not.toContainText("Nur eine Vorschau");
  await expect(page.getByRole("button", { name: "Testserver: AED eintragen" })).toBeVisible();
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  expect(searchRequests).toBe(1);
  expect(nonSearchOsmRequests).toEqual([]);

  let createRequest: Record<string, unknown> | undefined;
  await page.route("**/api/osm/development/create-node", async (route) => {
    createRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { status: "complete", node_id: "456", version: 1 } });
  });
  // Zweite Bestätigung: Der Speichern-Knopf bleibt gesperrt, bis der Haken „vor Ort geprüft“ sitzt.
  const createButton = page.getByRole("button", { name: "Testserver: AED eintragen" });
  await expect(createButton).toBeDisabled();
  // Auch ein erzwungener Klick ohne Haken darf nichts senden.
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-action="create-development-node"]')!;
    button.disabled = false;
    button.click();
  });
  await expect(page.getByRole("heading", { name: "Vorschau für neuen AED" })).toBeVisible();
  expect(createRequest).toBeUndefined();
  await page.locator("#new-aed-absence-confirmed").check();
  await expect(createButton).toBeEnabled();
  const createResponse = page.waitForResponse("**/api/osm/development/create-node");
  await createButton.click();
  await expect.poll(() => createRequest).toBeDefined();
  const createResponseBody = await createResponse.then(
    (response) => response.json() as Promise<Record<string, unknown>>,
  );
  expect(createResponseBody).toEqual({ status: "complete", node_id: "456", version: 1 });
  await expect(page.getByRole("status")).toContainText("Neuer AED wurde eingetragen");
  // Nach dem Speichern steht „nur eine Vorschau“ nicht neben der Erfolgsmeldung.
  await expect(page.locator(".capture-content")).not.toContainText("Nur eine Vorschau");
  expect(createRequest).toMatchObject({
    confirmed: true,
    observed_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    // Ohne Angaben im Formular geht ein leeres Detail-Objekt an den Server (Etappe P2/P3).
    details: {},
  });
  // WebKit rundet die Mercator-Projektion minimal anders als Chromium.
  expect(Math.abs(Number(createRequest?.latitude) - 52.52)).toBeLessThan(0.00001);
  expect(Math.abs(Number(createRequest?.longitude) - 13.40476)).toBeLessThan(0.00001);
  expect(createRequest?.operation_id).toMatch(/^[0-9a-f-]{36}$/iu);
});

test("a reviewed nearby AED can be rejected before preparing a separate new entry", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5ece3"/></svg>',
    }),
  );
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
            tags: { emergency: "defibrillator", name: "Rathaus" },
          },
        ],
      },
    }),
  );
  let createRequest: Record<string, unknown> | undefined;
  await page.route("**/api/osm/development/create-node", async (route) => {
    createRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { status: "complete", node_id: "456", version: 1 } });
  });

  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);
  await expect(page.getByRole("button", { name: "Als noch vorhanden bestätigen" })).toBeVisible();
  await expect(page.locator("#candidate-overview-map")).toBeVisible();
  await expect(page.locator("#new-aed-position-map")).toHaveCount(0);
  await page.getByRole("button", { name: "Keiner davon – neuen AED eintragen" }).click();
  await expect(page.locator("#new-aed-position-map")).toBeVisible();
  // Der abgelehnte Treffer bleibt beim Setzen des neuen Punkts als Marker sichtbar.
  await expect(page.locator("#new-aed-position-map .position-map-marker")).toHaveText(["1"]);
  await page.locator("#new-aed-position-confirmed").check();
  await page.getByRole("button", { name: "Neuen AED vorbereiten" }).click();
  await page.getByRole("button", { name: "Weiter ohne Angaben" }).click();
  await expect(page.getByRole("heading", { name: "Vorschau für neuen AED" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText(
    "Die angezeigten nahen AED-Einträge wurden als andere Geräte bestätigt.",
  );
  await expect(page.getByRole("button", { name: "Testserver: AED eintragen" })).toBeDisabled();
  await page.locator("#new-aed-absence-confirmed").check();
  await page.getByRole("button", { name: "Testserver: AED eintragen" }).click();
  await expect.poll(() => createRequest).toBeDefined();
  expect(createRequest).toMatchObject({
    confirmed: true,
    absence_confirmed: true,
    confirmed_different_candidate_ids: ["node/123"],
  });
});

test("a partial nearby search never offers a new AED preview", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "partial", coverage_radius_meters: 112, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);
  await expect(page.locator(".capture-content")).toContainText("Suche unvollständig.");
  await expect(page.getByRole("button", { name: "Neuen AED vorbereiten" })).toHaveCount(0);
  expect(searchRequests).toBe(1);
});

test("a location outside the supported region gets a clear coverage message without a retry", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({ status: 422, json: { error: "outside_coverage" } }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);
  await expect(page.locator(".capture-content")).toContainText(
    "Dieser Standort liegt außerhalb der AED-Datenabdeckung",
  );
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Neuen AED vorbereiten" })).toHaveCount(0);
});

test("denied location access does not send a nearby search request", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition(_success: PositionCallback, error: PositionErrorCallback) {
          error({ code: 1, PERMISSION_DENIED: 1, message: "Denied" } as GeolocationPositionError);
        },
      },
    });
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 100, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);

  await expect(page.locator(".capture-content")).toContainText("Standortzugriff wurde abgelehnt");
  expect(searchRequests).toBe(0);
});

test("a denied phone location still allows choosing and searching an explicit map point", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__locationRequests", { value: 0, writable: true });
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition(_success: PositionCallback, error: PositionErrorCallback) {
          (window as typeof window & { __locationRequests: number }).__locationRequests += 1;
          error({ code: 1, PERMISSION_DENIED: 1, message: "Denied" } as GeolocationPositionError);
        },
      },
    });
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  let searchLocation: { latitude: number; longitude: number; accuracy_meters: number } | undefined;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchLocation = route.request().postDataJSON() as typeof searchLocation;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 100, candidates: [] } });
  });
  await page.goto("/");
  const locationRequests = () =>
    page.evaluate(() => (window as typeof window & { __locationRequests: number }).__locationRequests);
  // Die einmalige Standortanfrage nach dem Anmelden ist die einzige Abfrage; sie wird hier abgelehnt.
  await expect.poll(locationRequests).toBe(1);
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await page.locator('[data-action="choose-map-location"]').click();

  const map = page.locator("#search-location-map");
  await expect(map).toBeVisible();
  // Die Kartenwahl fragt den Handy-Standort nicht noch einmal ab.
  expect(await locationRequests()).toBe(1);
  await expect(page.locator(".capture-content")).toContainText("Verschiebe die Karte zum AED");
  await expect(page.locator("#search-location-coordinates")).toContainText("Noch kein Standort gewählt");
  const search = page.locator('[data-action="confirm-map-location"]');
  await expect(search).toBeDisabled();
  for (let zoom = 0; zoom < 8; zoom += 1) await page.getByRole("button", { name: "Karte vergrößern" }).click();
  await expect(search).toBeDisabled();
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await expect(search).toBeDisabled();
  await page.getByRole("button", { name: "Karte vergrößern" }).click();
  await expect(search).toBeEnabled();
  await search.click();
  await expect.poll(() => searchLocation).toBeDefined();
  expect(searchLocation?.latitude).toBeCloseTo(50, 2);
  expect(searchLocation?.longitude).toBeLessThan(10);
  await expect(page.locator(".capture-content")).toContainText("Standort auf der Karte ausgewählt");
});

test("an incomplete search cannot suggest a new AED and offers a retry", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    if (searchRequests === 2) {
      await route.fulfill({ status: 429, headers: { "Retry-After": "2" }, json: { error: "search_rate_limited" } });
      return;
    }
    if (searchRequests === 3) {
      await route.fulfill({ status: 502, headers: { "Retry-After": "2" }, json: { error: "source_unavailable" } });
      return;
    }
    await route.fulfill(
      searchRequests === 1
        ? { status: 503, headers: { "Retry-After": "2" }, json: { error: "coverage_unavailable" } }
        : { json: { status: "complete", coverage_radius_meters: 112, candidates: [] } },
    );
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);

  await expect(page.locator(".capture-content")).toContainText("Die Umgebungssuche ist vorübergehend nicht erreichbar");
  await expect(page.locator(".candidate-list")).toHaveCount(0);
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  await expect(page.locator(".capture-content")).toContainText(/Eine erneute Suche ist in \d+ Sekunden möglich\./);
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toHaveCount(0);
  await expect(page.locator(".capture-content")).toContainText(/Eine erneute Suche ist in \d+ Sekunden möglich\./);
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  await expect(page.locator(".capture-content")).toContainText("Die Suche ist vorübergehend begrenzt");
  await expect(page.locator(".capture-content")).toContainText(/Eine erneute Suche ist in \d+ Sekunden möglich\./);
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  await expect(page.locator(".capture-content")).toContainText("Die Umgebungssuche ist vorübergehend nicht erreichbar");
  await expect(page.locator(".capture-content")).toContainText(/Eine erneute Suche ist in \d+ Sekunden möglich\./);
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  await expect(page.locator(".capture-content")).toContainText("Kein AED-Eintrag in der Nähe gefunden.");
  expect(searchRequests).toBe(4);
});

test("an imprecise phone fix is not sent and retry acquires a fresh location", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 150 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    expect(route.request().postDataJSON()).toMatchObject({ latitude: 52.52, longitude: 13.405, accuracy_meters: 15 });
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 250, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);

  await expect(page.locator(".capture-content")).toContainText("Der Standort ist zu ungenau");
  expect(searchRequests).toBe(0);

  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 15 });
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  await expect(page.locator(".capture-content")).toContainText("Kein AED-Eintrag in der Nähe gefunden.");
  expect(searchRequests).toBe(1);
});

test.describe("the one-time location request", () => {
  /** Zählt die Standortabfragen der Seite über Neuladen hinweg (localStorage überlebt das Neuladen). */
  const countGeolocationCalls = async (page: import("@playwright/test").Page) =>
    Number(await page.evaluate(() => window.localStorage.getItem("test-geolocation-calls") ?? "0"));

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (...args: Parameters<Geolocation["getCurrentPosition"]>) => {
        window.localStorage.setItem(
          "test-geolocation-calls",
          String(Number(window.localStorage.getItem("test-geolocation-calls") ?? "0") + 1),
        );
        return original(...args);
      };
    });
  });

  test("asks exactly once after sign-in and never again after a restart", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".connection-lamp-on")).toBeVisible();
    await expect.poll(() => countGeolocationCalls(page)).toBe(1);
    await page.reload();
    await expect(page.locator(".connection-lamp-on")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await countGeolocationCalls(page)).toBe(1);
  });

  test("does not ask while signed out", async ({ page }) => {
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: {
          authenticated: false,
          loginAvailable: true,
          developmentLoginAvailable: false,
          developmentSession: false,
        },
      }),
    );
    await page.goto("/");
    await expect(page.locator(".connection-lamp-off")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await countGeolocationCalls(page)).toBe(0);
  });

  test("does not ask when the location was already allowed", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await page.goto("/");
    await expect(page.locator(".connection-lamp-on")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await countGeolocationCalls(page)).toBe(0);
  });
});

test("retrying an explicitly chosen phone location still reacquires it, however much time has passed", async ({
  page,
  context,
}) => {
  const requests = await setUpFailingFirstSearch(page, context);
  await page.goto("/");
  // Ein älteres Kamerafoto: Die App setzt den Standort nicht selbst ein, die Person wählt ihn ausdrücklich.
  await takeFreshCameraPhotoWithoutGps(page, 60 * 60 * 1_000);
  await page.locator('[data-action="confirm-sighting"]').click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await page.locator('[data-action="use-phone-location"]').click();
  await expect(page.locator(".capture-content")).toContainText("Die Umgebungssuche ist vorübergehend nicht erreichbar");

  await page.clock.fastForward("10:00");
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  expect(requests.count).toBe(2);
});

test("an unnamed AED in the candidate list gets a readable label in all six languages", async ({ page, context }) => {
  await openCandidateList(page, context, [
    { id: "node/114", name: "", latitudeOffsetMeters: 3, tags: { emergency: "defibrillator" } },
  ]);
  const item = page.locator(".candidate-item");
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
    await expect(item, `Bezeichnung in ${code}`).toContainText(expected[code]);
    await expect(item).not.toContainText("node/114");
  }
});

test("when the only AEDs are farther than 50 m, the search shows no match and offers a new entry", async ({
  page,
  context,
}) => {
  await openCandidateList(page, context, [{ id: "node/103", name: "Weit", latitudeOffsetMeters: 170 }]);
  await expect(page.locator(".candidate-item")).toHaveCount(0);
  await expect(page.locator(".capture-content")).toContainText("Kein AED-Eintrag in der Nähe gefunden");
  await expect(page.getByRole("button", { name: "Hier fehlt ein AED – neu eintragen" })).toBeVisible();
});

test("a GPS accuracy worse than 50 m sends no search and asks for the map position", async ({ page, context }) => {
  const { searchRequests } = await openCandidateList(
    page,
    context,
    [{ id: "node/101", name: "Nah", latitudeOffsetMeters: 3 }],
    { accuracy: 70 },
  );
  await expect(page.locator(".capture-content")).toContainText("Der Standort ist zu ungenau");
  expect(searchRequests()).toBe(0);
});

test("an unavailable regional snapshot cannot offer a new AED", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({ status: 503, json: { error: "coverage_unavailable" } }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);
  await expect(page.locator(".capture-content")).toContainText("Die Umgebungssuche ist vorübergehend nicht erreichbar");
  await expect(page.getByRole("button", { name: "Neuen AED vorbereiten" })).toHaveCount(0);
});
