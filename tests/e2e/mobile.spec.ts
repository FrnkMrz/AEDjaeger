import { expect, test } from "@playwright/test";

const languageCodes = ["de", "en", "pl", "ja", "fr", "es"];

// Most workflow tests exercise the signed-in app; individual access-control tests override this.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false,
  } }));
});

async function beginNearbySearch(page: import("@playwright/test").Page): Promise<void> {
  const sighting = page.locator('[data-action="confirm-sighting"]');
  if (await sighting.isVisible()) await sighting.click();
  const dateConfirmation = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirmation.isVisible()) await dateConfirmation.click();
  // Photos without EXIF GPS require a separate, explicit choice before reading phone location.
  const usePhoneLocation = page.locator('[data-action="use-phone-location"]');
  if (await usePhoneLocation.isVisible()) await usePhoneLocation.click();
}

test("the information roadmap fits a narrow phone screen in all six languages", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");

  for (const language of languageCodes) {
    await page.locator("#language").selectOption(language);
    await page.locator("#open-info").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toContainText("AEDjaeger");
    await expect(dialog.getByRole("heading", { level: 3 }).last()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `horizontal page overflow in ${language}`).toBeLessThanOrEqual(320);
    expect(await dialog.locator(".info-dialog-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

test("changing the UI language keeps keyboard focus on the language selector", async ({ page }) => {
  await page.goto("/");
  await page.locator("#language").focus();
  await page.locator("#language").selectOption("fr");

  await expect(page.locator("#language")).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("the OSM account gate is shown before app features and is localized in all six languages", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");

  const expectedLabels = [
    "Mit OpenStreetMap anmelden",
    "Sign in with OpenStreetMap",
    "Zaloguj się przez OpenStreetMap",
    "OpenStreetMapでログイン",
    "Se connecter avec OpenStreetMap",
    "Iniciar sesión con OpenStreetMap",
  ];

  for (const [index, language] of languageCodes.entries()) {
    await page.locator("#language").selectOption(language);
    const signIn = page.getByRole("link", { name: expectedLabels[index] });
    await expect(signIn).toHaveAttribute("href", "/api/auth/osm/start");
    const createAccount = page.getByRole("link", { name: ["OpenStreetMap-Konto erstellen", "Create an OpenStreetMap account", "Utwórz konto OpenStreetMap", "OpenStreetMapアカウントを作成", "Créer un compte OpenStreetMap", "Crear una cuenta de OpenStreetMap"][index] });
    await expect(createAccount).toHaveAttribute("href", "https://www.openstreetmap.org/user/new");
    await expect(page.locator("#camera-input, #file-input, .demo-panel")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(language === "de" ? "OpenStreetMap-Konto" : "OpenStreetMap");
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `horizontal page overflow in ${language}`).toBeLessThanOrEqual(320);
  }
});

test("a sighting confirmation starts a search at the photo GPS location", async ({ page }) => {
  const searchLocations: unknown[] = [];
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchLocations.push(route.request().postDataJSON());
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await expect(page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" })).toBeVisible();
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  expect(searchLocations).toHaveLength(1);
  const usedPhotoLocation = searchLocations[0] as { latitude: number; longitude: number; accuracy_meters: number };
  expect(usedPhotoLocation.latitude).toBeCloseTo(52.52, 5);
  expect(usedPhotoLocation.longitude).toBeCloseTo(13.405, 5);
  expect(usedPhotoLocation.accuracy_meters).toBe(100);
  await expect(page.locator(".capture-content")).toContainText("Standort aus dem Foto verwendet");
});

test("an older gallery photo requires an explicit observation date before searching", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [
      { id: "node/123", osmType: "node", version: 7, coordinateQuality: "exact", position: { latitude: 52.52001, longitude: 13.40501 }, tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2025-01-01" } },
    ] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await expect(page.getByRole("heading", { name: "Wann hast du den AED gesehen?" })).toBeVisible();
  await page.locator("#photo-observed-on").fill("2025-10-20");
  await page.locator('[data-action="confirm-photo-date"]').click();
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  expect(searchRequests).toBe(0);
  await page.locator('[data-action="use-phone-location"]').click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  expect(searchRequests).toBe(1);
  await page.locator('[data-action="preview-candidate"]').click();
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText("Prüfdatum: 2025-10-20");
  // Der bisherige Wert steht dabei, weil es einen gibt.
  await expect(page.locator(".capture-content")).toContainText("Bisher: 2025-01-01");
});

test("a camera input photo with an old EXIF date requires confirmation", async ({ page }) => {
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#camera-input").setInputFiles("tests/fixtures/photo-old-date.jpg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await expect(page.getByRole("heading", { name: "Wann hast du den AED gesehen?" })).toBeVisible();
  await expect(page.locator("#photo-observed-on")).toHaveValue("2024-10-20");
  expect(searchRequests).toBe(0);
  await page.locator("#photo-observed-on").fill(await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }));
  await page.locator('[data-action="confirm-photo-date"]').click();
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  expect(searchRequests).toBe(0);
});

test("a fresh camera photo without EXIF date skips the observation-date question", async ({ page }) => {
  await page.goto("/");
  // Eine im Browser erzeugte Datei trägt die aktuelle Zeit als Dateizeit – wie ein Foto,
  // das die Kamera gerade eben aufgenommen hat. Sie enthält keine EXIF-Daten.
  await page.evaluate(() => {
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#176b4b"/></svg>'], "kamera.svg", { type: "image/svg+xml" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>("#camera-input")!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  // Keine Datumsabfrage: Es geht direkt mit der Standortwahl weiter.
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wann hast du den AED gesehen?" })).toHaveCount(0);
});

test("a fresh file chosen from the gallery without EXIF date still asks for the observation date", async ({ page }) => {
  await page.goto("/");
  // Bei „Foto auswählen“ sagt die Dateizeit nichts über die Aufnahme aus (z. B. ein gerade erst
  // gespeichertes altes Bild). Die 5-Minuten-Regel darf hier ohne EXIF-Zeit nicht greifen.
  await page.evaluate(() => {
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#176b4b"/></svg>'], "galerie.svg", { type: "image/svg+xml" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>("#file-input")!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await expect(page.getByRole("heading", { name: "Wann hast du den AED gesehen?" })).toBeVisible();
});

test("an older camera input photo without EXIF date requires explicit observation-date confirmation", async ({ page }) => {
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [] } });
  });
  // Die Testdatei kann (z. B. in der CI direkt nach dem Auschecken) erst wenige Minuten alt sein.
  // Die Browser-Uhr läuft deshalb 10 Minuten vor, damit die Datei sicher älter als 5 Minuten wirkt.
  await page.clock.install({ time: Date.now() + 10 * 60_000 });
  await page.goto("/");
  await page.locator("#camera-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await expect(page.getByRole("heading", { name: "Wann hast du den AED gesehen?" })).toBeVisible();
  await expect(page.locator("#photo-observed-on")).toHaveValue(await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }));
  expect(searchRequests).toBe(0);
  await page.locator('[data-action="confirm-photo-date"]').click();
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  expect(searchRequests).toBe(0);
});

test.describe("local photo dates near UTC midnight", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("an undated photo uses the local calendar date, not the UTC date", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-11-09T00:30:00.000Z") });
    await page.goto("/");
    await page.locator("#camera-input").setInputFiles("tests/fixtures/aed-test-image.svg");
    await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();

    await expect(page.getByRole("heading", { name: "Wann hast du den AED gesehen?" })).toBeVisible();
    await expect(page.locator("#photo-observed-on")).toHaveValue("2026-11-08");
    await expect(page.locator("#photo-observed-on")).toHaveAttribute("max", "2026-11-08");
    await page.locator('[data-action="confirm-photo-date"]').click();
    await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  });
});

test("the local demo photo flow stays on-device", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false } }));
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#scenario").selectOption("existing");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");

  await expect(page.locator(".capture-content")).toContainText("Das Foto bleibt auf deinem Gerät");
  await expect(page.locator(".capture-content")).toContainText("wertet dein Foto nicht aus");
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();
  await expect(page.getByRole("heading", { name: "AED gefunden" })).toBeVisible();
});

test("diagnostic consent applies to one run and requires a fresh opt-in next time", async ({ page }) => {
  const diagnosticEvents: Array<{ event: string; flowId: string }> = [];
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/diagnostics", async (route) => {
    diagnosticEvents.push(route.request().postDataJSON() as { event: string; flowId: string });
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#diagnostics-enabled").check();
  await expect.poll(() => diagnosticEvents.filter(({ event }) => event === "test_run_started").length).toBe(1);
  const firstFlowId = diagnosticEvents.find(({ event }) => event === "test_run_started")!.flowId;

  await page.locator("#scenario").selectOption("existing");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();
  await page.getByRole("button", { name: "Noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Vorschau abgeschlossen" })).toBeVisible();
  await expect.poll(() => diagnosticEvents.some(({ event }) => event === "demo_confirmed")).toBe(true);

  await page.getByRole("button", { name: "Nächsten AED fotografieren" }).click();
  await expect(page.locator("#diagnostics-enabled")).not.toBeChecked();
  const eventCountAfterOptedInRun = diagnosticEvents.length;
  // A new demo run requires reopening the explicit preview before selecting its photo.
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();
  await page.getByRole("button", { name: "Noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Vorschau abgeschlossen" })).toBeVisible();
  expect(diagnosticEvents).toHaveLength(eventCountAfterOptedInRun);

  await page.getByRole("button", { name: "Nächsten AED fotografieren" }).click();
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#diagnostics-enabled").check();
  await expect.poll(() => diagnosticEvents.filter(({ event }) => event === "test_run_started").length).toBe(2);
  const flowIds = diagnosticEvents.filter(({ event }) => event === "test_run_started").map(({ flowId }) => flowId);
  expect(flowIds[1]).not.toBe(firstFlowId);

  await page.locator("#scenario").selectOption("existing");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await expect.poll(() => diagnosticEvents.some(({ event, flowId }) => event === "photo_selected" && flowId === flowIds[1])).toBe(true);
  await page.getByRole("button", { name: "Anderes Foto" }).click();
  await expect(page.locator("#diagnostics-enabled")).not.toBeChecked();
  await expect.poll(() => diagnosticEvents.some(({ event, flowId }) => event === "test_run_abandoned" && flowId === flowIds[1])).toBe(true);
});

test("a user-confirmed location search shows nearby candidates without writing to OSM", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ latitude: 52.52, longitude: 13.405, accuracy_meters: 12 });
    await route.fulfill({ json: {
      status: "complete", coverage_radius_meters: 112,
      candidates: [{
        id: "node/123", osmType: "node", coordinateQuality: "exact",
        position: { latitude: 52.52001, longitude: 13.40501 },
        tags: { emergency: "defibrillator", name: "Rathaus <img src=x onerror=alert(2)>", check_date: "<img src=x onerror=alert(1)>" },
      }],
    } });
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
  await expect(page.locator("#candidate-overview-map .position-map-marker:not(.position-map-marker-origin)")).toHaveText(["1"]);
  // Der gesuchte Standort ist ein fest verankerter roter Marker. Beim Verschieben der Karte
  // muss er mitwandern – sonst würde er eine falsche Stelle als Standort anzeigen.
  const origin = page.locator("#candidate-overview-map .position-map-marker-origin");
  await expect(origin).toHaveCount(1);
  await expect(page.locator("#candidate-overview-map .position-map-crosshair")).toBeHidden();
  const originBefore = await origin.boundingBox();
  const candidateBefore = await page.locator("#candidate-overview-map .position-map-marker").last().boundingBox();
  await page.locator("#candidate-overview-map").focus();
  await page.keyboard.press("ArrowRight");
  const originAfter = await origin.boundingBox();
  const candidateAfter = await page.locator("#candidate-overview-map .position-map-marker").last().boundingBox();
  // Die Pfeiltaste verschiebt den Karteninhalt um 32 Pixel – der Standortmarker wandert mit.
  expect(originAfter!.x).toBeCloseTo(originBefore!.x + 32, 0);
  expect(candidateAfter!.x - originAfter!.x).toBeCloseTo(candidateBefore!.x - originBefore!.x, 0);
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
  await expect(page.locator(".capture-content")).toContainText(await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }));
  await expect(page.locator(".capture-content")).toContainText("Nur eine Vorschau. Nichts wurde gespeichert.");
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  // Ein einziger Treffer: „Zurück“ zu einer Auswahl hätte keine Bedeutung und entfällt.
  await expect(page.locator("[data-action='back-to-candidates']")).toHaveCount(0);
  expect(searchRequests).toBe(1);
});

test("a photo without GPS does not silently search the phone location", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await expect(page.getByText(/Das Foto hat keine GPS-Daten/u)).toBeVisible();
  await expect(page.locator("[data-action='use-phone-location']")).toBeVisible();
  expect(searchRequests).toBe(0);

  await page.locator("[data-action='use-phone-location']").click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  expect(searchRequests).toBe(1);
  await expect(page.locator(".capture-content")).toContainText("Handy-Standort verwendet");
});

test("retry keeps an explicitly chosen map location instead of silently switching to phone GPS", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  const requests: Array<{ latitude: number; longitude: number; accuracy_meters: number }> = [];
  await page.route("**/api/osm/candidates/search", async (route) => {
    requests.push(route.request().postDataJSON() as typeof requests[number]);
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
  expect(`${requests[0].latitude.toFixed(5)}, ${requests[0].longitude.toFixed(5)}`).toBe(selectedCoordinates.match(/-?\d+\.\d{5}, -?\d+\.\d{5}/u)?.[0]);
});

test("the development-session preview sends one explicitly confirmed, versioned check-date update", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    authenticated: true, loginAvailable: true, developmentLoginAvailable: true,
    developmentSession: true, developmentWriteAvailable: true,
  } }));
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ json: {
    status: "complete", coverage_radius_meters: 112,
    candidates: [{ id: "node/123", osmType: "node", version: 7, coordinateQuality: "exact", position: { latitude: 52.52001, longitude: 13.40501 }, tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2025-10-20" } }],
  } }));
  const writeRequests: Array<Record<string, unknown>> = [];
  await page.route("**/api/osm/development/check-date", async (route) => {
    expect(route.request().method()).toBe("POST");
    writeRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: { status: "complete", version: 8 } });
  });

  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.locator('[data-action="confirm-sighting"]').click();
  await beginNearbySearch(page);
  await page.getByRole("button", { name: "Als noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("button", { name: "Testserver: Prüfdatum speichern" })).toBeVisible();
  await page.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");
  expect(writeRequests).toHaveLength(1);
  expect(writeRequests[0]).toMatchObject({ confirmed: true, target: "node/123", expected_version: 7, expected_check_date: "2025-10-20" });
  expect(writeRequests[0].operation_id).toMatch(/^[0-9a-f-]{36}$/u);
});

test("an uncertain test-server response survives reload and retries with the same operation ID", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    authenticated: true, loginAvailable: true, developmentLoginAvailable: true,
    developmentSession: true, developmentWriteAvailable: true,
  } }));
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ json: {
    status: "complete", coverage_radius_meters: 112,
    candidates: [{ id: "node/123", osmType: "node", version: 7, coordinateQuality: "exact", position: { latitude: 52.52001, longitude: 13.40501 }, tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2025-10-20" } }],
  } }));
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

test("a new AED preview requires confirmed GPS position and a complete empty search", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"256\" height=\"256\"><rect width=\"256\" height=\"256\" fill=\"#e5ece3\"/></svg>" }));
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: true, developmentSession: true, developmentWriteAvailable: true } }));
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
  await expect(page.locator(".capture-content")).toContainText("Bestätige zuerst, dass der AED genau an diesem GPS-Punkt steht.");
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  await page.getByRole("button", { name: "Zurück", exact: true }).click();

  await page.locator("#new-aed-position-confirmed").check();
  await page.locator("#new-aed-position-map").evaluate((element) => {
    const map = element as HTMLDivElement;
    // Simulate the browser retaining a first touch while a second finger taps the map.
    map.setPointerCapture = () => {};
    map.hasPointerCapture = () => false;
    const dispatch = (type: string, pointerId: number, clientX: number, clientY: number) => {
      map.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId, pointerType: "touch",
        isPrimary: pointerId === 1, button: 0, clientX, clientY,
      }));
    };
    dispatch("pointerdown", 1, 120, 120);
    dispatch("pointermove", 1, 140, 120);
    dispatch("pointerdown", 2, 220, 120);
    dispatch("pointerup", 2, 220, 120);
    dispatch("pointerup", 1, 140, 120);
  });
  await expect(page.locator("#new-aed-position-confirmed")).not.toBeChecked();
  await expect(page.locator("#new-aed-position-coordinates")).not.toContainText("52.52000, 13.40500");
  await page.locator("#new-aed-position-confirmed").check();
  await page.getByRole("button", { name: "Neuen AED vorbereiten" }).click();
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
  const createResponseBody = await createResponse.then((response) => response.json() as Promise<Record<string, unknown>>);
  expect(createResponseBody).toEqual({ status: "complete", node_id: "456", version: 1 });
  await expect(page.getByRole("status")).toContainText("Neuer AED wurde eingetragen");
  expect(createRequest).toMatchObject({
    confirmed: true,
    latitude: 52.52,
    observed_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    location_description: null,
  });
  expect(createRequest?.longitude).toBeCloseTo(13.40495, 4);
  expect(createRequest?.operation_id).toMatch(/^[0-9a-f-]{36}$/iu);
});

test("a reviewed nearby AED can be rejected before preparing a separate new entry", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"256\" height=\"256\"><rect width=\"256\" height=\"256\" fill=\"#e5ece3\"/></svg>" }));
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: true, developmentSession: true, developmentWriteAvailable: true } }));
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ json: {
    status: "complete", coverage_radius_meters: 112,
    candidates: [{ id: "node/123", osmType: "node", version: 7, coordinateQuality: "exact", position: { latitude: 52.52001, longitude: 13.40501 }, tags: { emergency: "defibrillator", name: "Rathaus" } }],
  } }));
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
  await expect(page.getByRole("heading", { name: "Vorschau für neuen AED" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText("Die angezeigten nahen AED-Einträge wurden als andere Geräte bestätigt.");
  await expect(page.getByRole("button", { name: "Testserver: AED eintragen" })).toBeDisabled();
  await page.locator("#new-aed-absence-confirmed").check();
  await page.getByRole("button", { name: "Testserver: AED eintragen" }).click();
  await expect.poll(() => createRequest).toBeDefined();
  expect(createRequest).toMatchObject({ confirmed: true, confirmed_different_candidate_ids: ["node/123"] });
});

test("a partial nearby search never offers a new AED preview", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
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

test("the search result hides technical snapshot details and raw OSM identifiers", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ json: {
    status: "complete", coverage_radius_meters: 112,
    candidates: [{ id: "node/123", osmType: "node", coordinateQuality: "exact", position: { latitude: 52.52001, longitude: 13.40501 }, tags: { emergency: "defibrillator", name: "Rathaus" } }],
    snapshot_id: "aed-0123456789abcdef0123", data_until: "2026-11-08T12:00:00.000Z",
  } }));
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);
  // Technische Angaben (Datenstand, Snapshot-Kennung, OSM-Kennung) gehören nicht auf den Bildschirm.
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  await expect(page.locator(".capture-content")).not.toContainText("Datenstand");
  await expect(page.locator(".capture-content")).not.toContainText("aed-0123456789abcdef0123");
  await expect(page.locator(".capture-content")).not.toContainText("node/123");
  // Auch keine Verweise nach OpenStreetMap: Der Ablauf bleibt in der App.
  await expect(page.locator(".candidate-list a")).toHaveCount(0);
});

test("an unavailable regional snapshot cannot offer a new AED", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ status: 503, json: { error: "coverage_unavailable" } }));
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);
  await expect(page.locator(".capture-content")).toContainText("Die Umgebungssuche ist vorübergehend nicht erreichbar");
  await expect(page.getByRole("button", { name: "Neuen AED vorbereiten" })).toHaveCount(0);
});

test("denied location access does not send a nearby search request", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition(_success: PositionCallback, error: PositionErrorCallback) {
        error({ code: 1, PERMISSION_DENIED: 1, message: "Denied" } as GeolocationPositionError);
      },
    } });
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
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
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition(_success: PositionCallback, error: PositionErrorCallback) {
        (window as typeof window & { __locationRequests: number }).__locationRequests += 1;
        error({ code: 1, PERMISSION_DENIED: 1, message: "Denied" } as GeolocationPositionError);
      },
    } });
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  let searchLocation: { latitude: number; longitude: number; accuracy_meters: number } | undefined;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchLocation = route.request().postDataJSON() as typeof searchLocation;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 100, candidates: [] } });
  });
  await page.goto("/");
  const locationRequests = () => page.evaluate(() => (window as typeof window & { __locationRequests: number }).__locationRequests);
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

test("an expired OSM session does not offer a search retry that cannot work", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ status: 401, json: { error: "authentication_required" } }));
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);

  await expect(page.getByRole("heading", { name: "AEDjaeger braucht dein OpenStreetMap-Konto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toHaveCount(0);
  await expect(page.locator("#camera-input, #file-input")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("an incomplete search cannot suggest a new AED and offers a retry", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
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
    await route.fulfill(searchRequests === 1
      ? { status: 503, headers: { "Retry-After": "2" }, json: { error: "coverage_unavailable" } }
      : { json: { status: "complete", coverage_radius_meters: 112, candidates: [] } });
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
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
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

test("an expired server session is shown as signed out after a 401", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ status: 401, json: { error: "authentication_required" } }));
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);

  await expect(page.getByRole("heading", { name: "AEDjaeger braucht dein OpenStreetMap-Konto" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AEDjaeger braucht dein OpenStreetMap-Konto" })).toBeFocused();
  await expect(page.locator("#camera-input, #file-input")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("the OSM login link stays hidden when the Worker has no OAuth setup", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false } }));
  await page.goto("/");

  await expect(page.locator(".login-card")).toContainText("OpenStreetMap-Anmeldung ist noch nicht eingerichtet");
  await expect(page.getByRole("link", { name: "OpenStreetMap-Konto erstellen" })).toHaveAttribute("href", "https://www.openstreetmap.org/user/new");
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toHaveCount(0);
});

test("an authenticated user can end the OSM session without exposing profile data", async ({ page }) => {
  let authenticated = true;
  page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  page.route("**/api/auth/logout", async (route) => {
    expect(route.request().method()).toBe("POST");
    authenticated = false;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");

  // Angemeldet: kein Textblock auf dem Hauptbildschirm. Die Lampe unten zeigt „verbunden“, „Abmelden“ liegt im Info-Dialog.
  await expect(page.locator(".account-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Abmelden" })).toBeHidden();
  await page.locator("#open-info").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Mit OpenStreetMap verbunden");
  await expect(dialog).toContainText("Änderungen an OpenStreetMap sind noch deaktiviert");
  await dialog.getByRole("button", { name: "Abmelden" }).click();
  const signIn = page.getByRole("link", { name: "Mit OpenStreetMap anmelden" });
  await expect(signIn).toBeFocused();
});

test("a failed logout keeps a retry action until the OSM session has ended", async ({ page }) => {
  let authenticated = true;
  let logoutAttempts = 0;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/auth/logout", async (route) => {
    logoutAttempts += 1;
    if (logoutAttempts === 1) {
      await route.fulfill({ status: 503, json: { error: "temporarily_unavailable" } });
      return;
    }
    authenticated = false;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await page.locator("#open-info").click();
  await page.getByRole("dialog").getByRole("button", { name: "Abmelden" }).click();
  await expect(page.locator(".login-card")).toContainText("Abmeldung fehlgeschlagen. Bitte prüfe deine Verbindung.");
  const retryLogout = page.locator("#osm-sign-out");
  await expect(retryLogout).toBeVisible();
  await retryLogout.click();
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
  expect(logoutAttempts).toBe(2);
});

test("a failed OAuth return shows a localized retry message and removes the callback marker", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.goto("/?login=error");

  const errors = [
    "Die OpenStreetMap-Anmeldung ist fehlgeschlagen oder abgelaufen. Bitte versuche es erneut.",
    "OpenStreetMap sign-in failed or expired. Please try again.",
    "Logowanie OpenStreetMap nie powiodło się lub wygasło. Spróbuj ponownie.",
    "OpenStreetMapへのログインに失敗したか、期限切れです。もう一度お試しください。",
    "La connexion OpenStreetMap a échoué ou expiré. Veuillez réessayer.",
    "El acceso a OpenStreetMap falló o caducó. Inténtalo de nuevo.",
  ];

  for (const [index, language] of languageCodes.entries()) {
    await page.locator("#language").selectOption(language);
    await expect(page.locator(".login-card")).toContainText(errors[index]);
    await expect(page.getByRole("link", { name: ["Mit OpenStreetMap anmelden", "Sign in with OpenStreetMap", "Zaloguj się przez OpenStreetMap", "OpenStreetMapでログイン", "Se connecter avec OpenStreetMap", "Iniciar sesión con OpenStreetMap"][index] })).toHaveAttribute("href", "/api/auth/osm/start");
  }
  await expect(page).not.toHaveURL(/login=error/u);
});

test("signed-out visitors cannot start the photo demo or select a photo", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AEDjaeger braucht dein OpenStreetMap-Konto" })).toBeVisible();
  await expect(page.getByText("Vorschau testen", { exact: true })).toHaveCount(0);
  await expect(page.locator("#camera-input, #file-input, .demo-panel, [data-action]")).toHaveCount(0);
});

test("the OSM test server login is still offered only when its OAuth setup is available", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Mit OSM-Testserver anmelden" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("the app stays locked while the OSM session check is pending", async ({ page }) => {
  let releaseSessionCheck: (() => void) | undefined;
  await page.route("**/api/auth/session", (route) => new Promise<void>((resolve) => {
    releaseSessionCheck = () => { void route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }).then(resolve); };
  }));
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("OpenStreetMap-Anmeldung wird geprüft");
  await expect(page.locator("#camera-input, #file-input, .demo-panel")).toHaveCount(0);
  releaseSessionCheck?.();
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("a session status connection error can be retried while the app remains locked", async ({ page }) => {
  let checks = 0;
  await page.route("**/api/auth/session", (route) => {
    checks += 1;
    return checks === 1
      ? route.fulfill({ status: 503, json: { error: "session_unavailable" } })
      : route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } });
  });
  await page.goto("/");
  await expect(page.locator(".login-card")).toContainText("Anmeldung ist gerade nicht erreichbar");
  await expect(page.locator("#camera-input, #file-input, .demo-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "Erneut prüfen" }).click();

  await expect(page.getByRole("heading", { name: "AEDjaeger braucht dein OpenStreetMap-Konto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Erneut prüfen" })).toHaveCount(0);
  await expect(page.locator("#camera-input, #file-input")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("a repeated session status error focuses the retry action", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 503, json: { error: "session_unavailable" } }));
  await page.goto("/");
  const retry = page.getByRole("button", { name: "Erneut prüfen" });
  await retry.click();

  await expect(retry).toBeFocused();
});

test("keyboard focus indicators use a high-contrast color throughout the controls", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).focus();
  await page.getByText("Vorschau testen", { exact: true }).press("Enter");

  const controls = ["#language", "#open-info", "#scenario", ".brand"];
  for (const selector of controls) {
    const control = page.locator(selector);
    await control.focus();
    await expect.poll(() => control.evaluate((element) => getComputedStyle(element).outlineColor)).toBe("rgb(23, 107, 75)");
  }
});

test("a mobile photo can select a nearby AED and reach the preview confirmation", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#scenario").selectOption("multiple");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();

  await expect(page.getByRole("heading", { name: "Welcher AED ist es?" })).toBeVisible();
  await page.getByRole("button", { name: "Rathaus · Sporthalle" }).click();
  await expect(page.getByRole("heading", { name: "AED gefunden" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Noch vorhanden bestätigen" })).toBeFocused();
  await page.getByRole("button", { name: "Noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Vorschau abgeschlossen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nächsten AED fotografieren" })).toBeFocused();
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
});

test("an unclear save results the draft stays available for status recovery", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#scenario").selectOption("upload-unclear");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();
  await page.getByRole("button", { name: "Noch vorhanden bestätigen" }).click();

  await expect(page.getByRole("heading", { name: "Ergebnis noch unklar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ergebnis noch unklar" })).toBeFocused();
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
  await page.getByRole("button", { name: "Vorgangsstatus prüfen" }).click();
  await expect(page.getByRole("heading", { name: "Vorschau abgeschlossen" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
});

test("the brand link cannot discard a draft while save status is unclear", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#scenario").selectOption("upload-unclear");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();
  await page.getByRole("button", { name: "Noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Ergebnis noch unklar" })).toBeVisible();

  const currentUrl = page.url();
  const brand = page.locator(".brand");
  await expect(brand).toHaveAttribute("aria-disabled", "true");
  await brand.dispatchEvent("click");

  await expect(page).toHaveURL(currentUrl);
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vorgangsstatus prüfen" })).toBeFocused();
});

test("the brand link stays disabled while saving and checking the save status", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#scenario").selectOption("upload-unclear");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();
  await page.getByRole("button", { name: "Noch vorhanden bestätigen" }).click();

  const brand = page.locator(".brand");
  await expect(page.getByRole("status")).toContainText("Vorschau wird gespeichert");
  await expect(brand).toHaveAttribute("aria-disabled", "true");
  await brand.dispatchEvent("click");
  await expect(page.getByRole("status")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Ergebnis noch unklar" })).toBeVisible();
  await page.getByRole("button", { name: "Vorgangsstatus prüfen" }).click();
  await expect(page.getByRole("status")).toContainText("Gespeicherten Vorgang wird geprüft");
  await expect(brand).toHaveAttribute("aria-disabled", "true");
  await brand.dispatchEvent("click");
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
});

test("a damaged image is rejected before the AED flow can start", async ({ page }) => {
  await page.goto("/");
  const dialogPromise = page.waitForEvent("dialog");
  await page.locator("#file-input").setInputFiles("tests/fixtures/invalid-image.svg");
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain("Das Bild konnte nicht geöffnet werden");
  await dialog.accept();
  await expect(page.getByRole("button", { name: "Demoablauf simulieren" })).toHaveCount(0);
});

test("the installed app shell and hashed assets remain fetchable after going offline", async ({ page, context }) => {
  // Insert a conflicting home page before AEDjaeger's first install to catch accidental global cache lookups.
  await page.addInitScript(async () => {
    const cache = await caches.open("aaa-other-feature-cache");
    const home = new Request(new URL("/", location.origin));
    if (!(await cache.match(home))) {
      await cache.put(home, new Response("<!doctype html><title>Other feature cache</title><p>Other app</p>", {
        headers: { "Content-Type": "text/html" },
      }));
      await cache.put("/foreign-only.txt", new Response("foreign cache entry"));
    }
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const workerScript = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? "");
  expect(workerScript).toContain("revision=");

  const cachedAppAssets = await page.evaluate(async () => {
    const cacheName = (await caches.keys()).find((key) => key.startsWith("aedjaeger-shell-"));
    if (!cacheName) throw new Error("The versioned AEDjaeger shell cache was not created.");
    const cache = await caches.open(cacheName);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(cachedAppAssets.some((path) => path.endsWith(".js"))).toBe(true);
  expect(cachedAppAssets.some((path) => path.endsWith(".css"))).toBe(true);
  expect(cachedAppAssets).toContain("/");

  await context.setOffline(true);
  const offlineResponses = await page.evaluate(async (paths) => Promise.all(paths.map(async (path) => {
    const response = await fetch(path);
    return { path, ok: response.ok, size: (await response.text()).length };
  })), ["/", ...cachedAppAssets.filter((path) => path.endsWith(".js") || path.endsWith(".css"))]);
  expect(offlineResponses.every((response) => response.ok && response.size > 0)).toBe(true);

  const offlineNavigation = await page.reload();
  expect(await offlineNavigation?.text()).toContain('id="app"');
  expect(await offlineNavigation?.text()).not.toContain("Other app");
  const foreignOnlyResponse = await page.evaluate(async () => {
    try {
      const response = await fetch("/foreign-only.txt");
      return { status: response.status, text: await response.text() };
    } catch {
      return { status: 0, text: "" };
    }
  });
  expect(foreignOnlyResponse).toEqual({ status: 0, text: "" });
});

test("service worker activation removes obsolete AEDjaeger shell caches", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const oldCacheName = "aedjaeger-shell-obsolete-test";
  const otherFeatureCacheName = "other-feature-cache";
  await page.evaluate(async (name) => {
    await caches.open(name);
    await caches.open("other-feature-cache");
    const registration = await navigator.serviceWorker.getRegistration();
    const currentScript = registration?.active?.scriptURL;
    if (!registration || !currentScript) throw new Error("The current service worker is not active.");
    await registration.unregister();
    const nextScript = new URL(currentScript);
    nextScript.searchParams.set("revision", "test-upgrade");
    await navigator.serviceWorker.register(nextScript);
  }, oldCacheName);

  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active?.scriptURL.includes("test-upgrade"));
  });
  await expect.poll(() => page.evaluate((name) => caches.has(name), oldCacheName)).toBe(false);
  await expect.poll(() => page.evaluate((name) => caches.has(name), otherFeatureCacheName)).toBe(true);
});

test("the demo disclosure text keeps readable contrast", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).focus();
  await page.getByText("Vorschau testen", { exact: true }).press("Enter");

  const summary = page.locator(".demo-panel summary");
  await expect.poll(() => summary.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(98, 109, 102)");
  await expect.poll(() => page.locator(".demo-badge").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(98, 109, 102)");
});

test("the ready screen introduction keeps readable contrast", async ({ page }) => {
  await page.goto("/");

  const introduction = page.locator(".hero p");
  await expect.poll(() => introduction.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(98, 109, 102)");
});

// ---------------------------------------------------------------------------------------------
// Fotoprüfung per OpenAI (optional, nur wenn der Server sie für das Konto freigibt)
//
// Alle Tests ersetzen den Server-Endpunkt durch einen Mock. Es wird nie echtes OpenAI aufgerufen,
// kein Geld ausgegeben und nichts an OpenStreetMap gesendet.
// ---------------------------------------------------------------------------------------------

/** Eine gültige Beobachtung; einzelne Felder lassen sich pro Test überschreiben. */
function visionObservation(scene: string) {
  return { scene, device_count: scene === "device_visible" ? 1 : 0, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] };
}

/** Meldet in der Sitzung, dass die Fotoprüfung für dieses Konto aktiv ist. */
async function enablePhotoCheck(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false, photoCheckAvailable: true,
  } }));
}

test("a passed photo check continues like a confirmed sighting and uploads no metadata", async ({ page }) => {
  await enablePhotoCheck(page);
  const uploads: Record<string, unknown>[] = [];
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    uploads.push(body);
    await route.fulfill({ json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("device_visible") } });
  });
  const searchLocations: { latitude: number; longitude: number }[] = [];
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchLocations.push(route.request().postDataJSON());
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
  await page.goto("/");
  // Schon auf der Startseite darf die Zusage „bleibt auf dem Gerät“ nicht mehr stehen.
  await expect(page.locator(".capture-actions")).toContainText("OpenAI");
  await expect(page.locator(".capture-actions")).not.toContainText("nicht an einen Bilddienst gesendet");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");

  // Der Hinweis auf OpenAI steht VOR dem Tippen; die alte Zusage „bleibt auf dem Gerät“ ist weg.
  await expect(page.locator(".capture-content")).toContainText("Das Foto geht ohne Standort und Metadaten zur Prüfung an OpenAI.");
  await expect(page.locator(".capture-content")).not.toContainText("nicht an einen Bilddienst gesendet");
  expect(uploads).toHaveLength(0);

  await page.getByRole("button", { name: "AED gesehen – Foto prüfen" }).click();
  // Die Prüfung läuft asynchron: erst warten, bis die Ladeanzeige weg ist, dann erst eine
  // mögliche Datumsfrage beantworten (sonst würde der Test sie zu früh als „nicht da“ werten).
  await expect(page.locator(".loading-row")).toHaveCount(0);
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();

  // Genau ein Upload, nur drei Felder, JPEG ohne EXIF-Block (und damit ohne GPS).
  expect(uploads).toHaveLength(1);
  expect(Object.keys(uploads[0]).sort()).toEqual(["content_type", "image_base64", "request_id"]);
  expect(uploads[0].content_type).toBe("image/jpeg");
  // atob statt Buffer: Die Testdateien kennen keine Node-Typen.
  const decoded = atob(uploads[0].image_base64 as string);
  expect(decoded.includes("Exif")).toBe(false);
  // Der Standort für die Suche stammt weiterhin lokal aus dem Originalfoto.
  expect(searchLocations).toHaveLength(1);
  expect(searchLocations[0].latitude).toBeCloseTo(52.52, 5);
});

test("a photo without a recognizable AED is blocked and cannot start a search", async ({ page }) => {
  await enablePhotoCheck(page);
  let searches = 0;
  await page.route("**/api/osm/candidates/search", async (route) => { searches += 1; await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } }); });
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as { request_id: string };
    await route.fulfill({ json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("other_object") } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED gesehen – Foto prüfen" }).click();

  await expect(page.getByRole("heading", { name: "Kein AED erkennbar" })).toBeVisible();
  // Die einfache Selbstbestätigung ist weg, und es startet keine Suche. Die Ausnahme braucht zwei Bestätigungen.
  await expect(page.locator('[data-action="confirm-sighting"]')).toHaveCount(0);
  await expect(page.locator('[data-action="check-photo"]')).toHaveCount(0);
  expect(searches).toBe(0);

  await page.getByRole("button", { name: "Anderes Foto" }).click();
  await expect(page.locator("#camera-input")).toBeAttached();
});

test("a rejected photo can still continue after two explicit confirmations", async ({ page }) => {
  await enablePhotoCheck(page);
  const searches: unknown[] = [];
  await page.route("**/api/osm/candidates/search", async (route) => { searches.push(route.request().postDataJSON()); await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } }); });
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as { request_id: string };
    await route.fulfill({ json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("other_object") } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED gesehen – Foto prüfen" }).click();
  await expect(page.getByRole("heading", { name: "Kein AED erkennbar" })).toBeVisible();

  // Erste Bestätigung: öffnet nur die Rückfrage, es geht noch nichts weiter.
  await page.getByRole("button", { name: "Trotzdem: Hier ist ein AED" }).click();
  await expect(page.getByRole("heading", { name: "Wirklich ein AED?" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText("Die Prüfung hat keinen AED erkannt.");
  expect(searches).toHaveLength(0);
  await expect(page.locator('[data-action="confirm-sighting"]')).toHaveCount(0);

  // Zweite Bestätigung: Jetzt gilt der normale Ablauf (Datumsfrage, Standort aus dem Foto, Suche).
  await page.getByRole("button", { name: "Ja, AED oder Gehäuse ist zu sehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  expect(searches).toHaveLength(1);
});

test("the second confirmation can be abandoned, and the override is offered for unclear photos too", async ({ page }) => {
  await enablePhotoCheck(page);
  let searches = 0;
  await page.route("**/api/osm/candidates/search", async (route) => { searches += 1; await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } }); });
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as { request_id: string };
    await route.fulfill({ json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("unclear") } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED gesehen – Foto prüfen" }).click();
  await expect(page.getByRole("heading", { name: "Nicht eindeutig" })).toBeVisible();

  await page.getByRole("button", { name: "Trotzdem: Hier ist ein AED" }).click();
  await expect(page.getByRole("heading", { name: "Wirklich ein AED?" })).toBeVisible();
  // „Anderes Foto“ bricht ab, ohne dass etwas gesendet oder gesucht wurde.
  await page.getByRole("button", { name: "Anderes Foto" }).click();
  await expect(page.locator("#camera-input")).toBeAttached();
  expect(searches).toBe(0);
});

test("the override texts exist in all six languages", async ({ page }) => {
  await enablePhotoCheck(page);
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as { request_id: string };
    await route.fulfill({ json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("other_object") } });
  });
  await page.goto("/");
  const expected: Record<string, { action: string; confirm: string }> = {
    de: { action: "Trotzdem: Hier ist ein AED", confirm: "Ja, AED oder Gehäuse ist zu sehen – weiter" },
    en: { action: "Still: this is an AED", confirm: "Yes, an AED or cabinet is visible — continue" },
    pl: { action: "Mimo to: to jest AED", confirm: "Tak, widać AED lub obudowę — dalej" },
    ja: { action: "それでも確認: AEDです", confirm: "はい、AEDまたは収納ケースが見えます — 続行" },
    fr: { action: "Malgré tout : c’est un DAE", confirm: "Oui, un DAE ou son boîtier est visible — continuer" },
    es: { action: "Aun así: esto es un DEA", confirm: "Sí, se ve un DEA o su armario — continuar" },
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
    await page.locator('[data-action="check-photo"]').click();
    await page.getByRole("button", { name: expected[code].action }).click();
    await expect(page.getByRole("button", { name: expected[code].confirm })).toBeVisible();
    await page.locator('[data-action="retake"]').click();
  }
});

test("an unclear photo asks for a closer picture", async ({ page }) => {
  await enablePhotoCheck(page);
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as { request_id: string };
    await route.fulfill({ json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("unclear") } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED gesehen – Foto prüfen" }).click();
  await expect(page.getByRole("heading", { name: "Nicht eindeutig" })).toBeVisible();
  await expect(page.locator('[data-action="confirm-sighting"]')).toHaveCount(0);
});

for (const failure of [
  { name: "the daily budget is used up", status: 429, body: { error: "analysis_budget_exceeded" }, code: "analysis_budget_exceeded (HTTP 429)" },
  { name: "the provider is down", status: 502, body: { error: "analysis_failed", detail_status: 401, detail_code: "invalid_api_key" }, code: "analysis_failed (HTTP 502, OpenAI 401, invalid_api_key)" },
  { name: "the budget table is missing", status: 503, body: { error: "analysis_budget_unavailable", detail_code: "missing_table" }, code: "analysis_budget_unavailable (HTTP 503, missing_table)" },
  { name: "the response is malformed", status: 200, body: { unexpected: true }, code: "invalid_response (unexpected_shape)" },
]) {
  test(`when ${failure.name}, the person can still confirm the sighting themselves`, async ({ page }) => {
    await enablePhotoCheck(page);
    await page.route("**/api/vision/analyze", (route) => route.fulfill({ status: failure.status, json: failure.body }));
    await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } }));
    await page.goto("/");
    await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
    await page.getByRole("button", { name: "AED gesehen – Foto prüfen" }).click();

    // Rückfall: Hinweis und die bekannte Selbstbestätigung, kein erneuter Upload-Knopf.
    await expect(page.locator(".capture-content")).toContainText("Die Prüfung ist gerade nicht möglich.");
    await expect(page.locator('[data-action="check-photo"]')).toHaveCount(0);
    // Ein kurzer Fehlercode nennt die Ursache, damit sich ein Ausfall im Pilot eingrenzen lässt.
    await expect(page.locator(".photo-check-code")).toHaveText(`Fehlercode: ${failure.code}`);
    // Der Upload kann schon gelaufen sein: Die Zusage „bleibt auf dem Gerät“ darf nicht erscheinen.
    await expect(page.locator(".capture-content")).not.toContainText("nicht an einen Bilddienst gesendet");
    await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
    const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
    if (await dateConfirm.isVisible()) await dateConfirm.click();
    await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  });
}

test("without the server flag the photo never leaves the device", async ({ page }) => {
  let uploads = 0;
  await page.route("**/api/vision/analyze", async (route) => { uploads += 1; await route.fulfill({ status: 503, json: { error: "analysis_unavailable" } }); });
  await page.goto("/");
  // Ohne Freigabe bleibt auch die Startseite bei der Zusage „bleibt auf dem Gerät“.
  await expect(page.locator(".capture-actions")).toContainText("nicht an einen Bilddienst gesendet");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  // Bisheriger Ablauf: Selbstbestätigung und Zusage „bleibt auf dem Gerät“.
  await expect(page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText("nicht an einen Bilddienst gesendet");
  await expect(page.locator('[data-action="check-photo"]')).toHaveCount(0);
  expect(uploads).toBe(0);
});

test("the photo check texts exist in all six languages", async ({ page }) => {
  await enablePhotoCheck(page);
  const expectedActions: Record<string, string> = {
    de: "AED gesehen – Foto prüfen", en: "I see an AED — check photo", pl: "Widzę AED — sprawdź zdjęcie",
    ja: "AEDを確認 — 写真を確認する", fr: "Je vois un DAE — vérifier la photo", es: "Veo un DEA — comprobar la foto",
  };
  await page.goto("/");
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
    await expect(page.getByRole("button", { name: expectedActions[code] })).toBeVisible();
    await expect(page.locator(".capture-content")).toContainText("OpenAI");
    await page.locator('[data-action="retake"]').click();
  }
});

// Der Info-Dialog ist immer erreichbar. Er darf deshalb nie zusagen, dass Fotos immer lokal bleiben
// oder dass es keine automatische Prüfung gibt, weil das bei aktiver Fotoprüfung falsch wäre.
test("the info dialog tells the truth about the optional photo check in all six languages", async ({ page }) => {
  await enablePhotoCheck(page);
  await page.goto("/");
  // Aussagen, die mit aktiver Fotoprüfung falsch wären (je Sprache ein Auszug). Der Demo-Text
  // „Beispielszenarien laufen lokal …“ gehört nicht dazu: Er beschreibt nur die Demo, die nie hochlädt.
  const falseClaims = [
    "Das Foto bleibt lokal; OSM-Änderungen", "Photos stay local; OSM", "Zdjęcia pozostają lokalnie; zmiany",
    "写真は端末内に残り、OSMへの変更", "Les photos restent locales ; les modifications", "Las fotos permanecen locales; los cambios",
    "Automatische Erkennung ist nicht im Pilot", "Automatic recognition is not part of the pilot",
    "Automatyczne rozpoznawanie nie jest częścią pilotażu", "自動認識はパイロットに含まれません",
    "La reconnaissance automatique ne fait pas partie du pilote", "El reconocimiento automático no forma parte del piloto",
  ];
  for (const language of languageCodes) {
    await page.locator("#language").selectOption(language);
    await page.locator("#open-info").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Der optionale OpenAI-Weg wird in jeder Sprache genannt.
    await expect(dialog).toContainText("OpenAI");
    for (const claim of falseClaims) await expect(dialog).not.toContainText(claim);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

// ---------------------------------------------------------------------------------------------
// Update-Hinweis: Die App erkennt über /version.json, dass eine neuere Version veröffentlicht ist.
// Die Tests ersetzen nur diese Datei; es wird nichts deployt.
// ---------------------------------------------------------------------------------------------

/** Lässt die App glauben, es sei eine andere Version veröffentlicht als die, die gerade läuft. */
async function publishNewVersion(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/version.json", (route) => route.fulfill({ json: { revision: "zzzz9999" } }));
}

test("a newer published version shows a banner and never reloads by itself", async ({ page }) => {
  await publishNewVersion(page);
  await page.goto("/");
  // Markierung im Fenster: Sie überlebt kein Neuladen und beweist, dass die App nicht von selbst neu lädt.
  await page.evaluate(() => { (window as unknown as { __notReloaded: boolean }).__notReloaded = true; });

  const banner = page.locator("#update-banner");
  await expect(banner).toContainText("Neue Version verfügbar.");
  await expect(banner).toHaveAttribute("role", "status");
  // Ohne Foto geht nichts verloren: kein Warnhinweis.
  await expect(banner).not.toContainText("Foto geht dabei verloren");

  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await expect(banner).toContainText("Das aktuelle Foto geht dabei verloren.");
  expect(await page.evaluate(() => (window as unknown as { __notReloaded?: boolean }).__notReloaded)).toBe(true);

  // Erst der Tipp auf „Neu laden“ lädt neu, und das Foto ist danach weg.
  await Promise.all([page.waitForEvent("load"), banner.getByRole("button", { name: "Neu laden" }).click()]);
  expect(await page.evaluate(() => (window as unknown as { __notReloaded?: boolean }).__notReloaded)).toBeUndefined();
  await expect(page.locator("#camera-input")).toBeAttached();
});

test("no banner appears while the published version matches the running one", async ({ page }) => {
  // Die echte version.json aus dem Build: Sie nennt dieselbe Revision wie die laufende App.
  const versionResponse = page.waitForResponse("**/version.json");
  await page.goto("/");
  expect((await versionResponse).ok()).toBe(true);
  await expect(page.locator("#update-banner")).toHaveCount(0);
});

test("a failing version check never shows a banner", async ({ page }) => {
  await page.route("**/version.json", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  const versionResponse = page.waitForResponse("**/version.json");
  await page.goto("/");
  await versionResponse;
  await expect(page.locator("#update-banner")).toHaveCount(0);
});

test("the reload button stays blocked while a save result is unclear", async ({ page }) => {
  await publishNewVersion(page);
  await page.goto("/");
  await expect(page.locator("#update-banner")).toBeVisible();
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#scenario").selectOption("upload-unclear");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();
  await page.getByRole("button", { name: "Noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Ergebnis noch unklar" })).toBeVisible();

  // Ungeklärtes Speichern: Neuladen wäre gefährlich, der Knopf ist gesperrt und der Grund steht da.
  const banner = page.locator("#update-banner");
  await expect(banner.getByRole("button", { name: "Neu laden" })).toBeDisabled();
  await expect(banner).toContainText("Neu laden geht, sobald das Speichern abgeschlossen ist.");

  // Nach der Statusprüfung ist der Vorgang abgeschlossen und der Knopf wieder frei.
  await page.getByRole("button", { name: "Vorgangsstatus prüfen" }).click();
  await expect(page.getByRole("heading", { name: "Vorschau abgeschlossen" })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Neu laden" })).toBeEnabled();
});

test("the update banner exists in all six languages", async ({ page }) => {
  await publishNewVersion(page);
  await page.goto("/");
  const expected: Record<string, { text: string; button: string }> = {
    de: { text: "Neue Version verfügbar.", button: "Neu laden" },
    en: { text: "A new version is available.", button: "Reload" },
    pl: { text: "Dostępna jest nowa wersja.", button: "Odśwież" },
    ja: { text: "新しいバージョンがあります。", button: "再読み込み" },
    fr: { text: "Une nouvelle version est disponible.", button: "Recharger" },
    es: { text: "Hay una nueva versión disponible.", button: "Recargar" },
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await expect(page.locator("#update-banner")).toContainText(expected[code].text);
    await expect(page.locator("#update-banner").getByRole("button", { name: expected[code].button })).toBeVisible();
  }
});

test("the update banner fits a narrow phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await publishNewVersion(page);
  await page.goto("/");
  await page.locator("#language").selectOption("fr");
  await expect(page.locator("#update-banner")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("a crashed worker shows the HTTP status instead of a bare failure", async ({ page }) => {
  await enablePhotoCheck(page);
  // Cloudflare liefert bei einem abgestürzten Worker eine HTML-Fehlerseite statt JSON.
  await page.route("**/api/vision/analyze", (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<html>Error 1102</html>" }));
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED gesehen – Foto prüfen" }).click();
  await expect(page.locator(".photo-check-code")).toHaveText("Fehlercode: invalid_response (HTTP 500)");
});

test("a lost connection during the check shows a client-side code", async ({ page }) => {
  await enablePhotoCheck(page);
  await page.route("**/api/vision/analyze", (route) => route.abort("connectionreset"));
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED gesehen – Foto prüfen" }).click();
  await expect(page.locator(".photo-check-code")).toHaveText("Fehlercode: analysis_failed (client_network)");
});

test("the error code is translated and hidden when the check works", async ({ page }) => {
  await enablePhotoCheck(page);
  await page.route("**/api/vision/analyze", (route) => route.fulfill({ status: 502, json: { error: "analysis_failed", detail_code: "timeout" } }));
  await page.goto("/");
  const labels: Record<string, string> = { de: "Fehlercode:", en: "Error code:", pl: "Kod błędu:", ja: "エラーコード:", fr: "Code d’erreur :", es: "Código de error:" };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
    await page.locator('[data-action="check-photo"]').click();
    await expect(page.locator(".photo-check-code")).toContainText(`${labels[code]} analysis_failed (HTTP 502, timeout)`);
    await page.locator('[data-action="retake"]').click();
  }
});

// ---------------------------------------------------------------------------------------------
// Aufgeräumte Oberfläche: Verbindungslampe statt Textblock, keine Verweise nach außen, kürzere Vorschau
// ---------------------------------------------------------------------------------------------

test("a green lamp shows the connection, and it is red when signed out", async ({ page }) => {
  await page.goto("/");
  const lamp = page.locator(".footer-lamp");
  await expect(lamp).toHaveClass(/footer-lamp-on/);
  // Farbe allein genügt nicht: Die Lampe trägt den Status auch als Text für Screenreader.
  await expect(lamp).toHaveAttribute("aria-label", "Mit OpenStreetMap verbunden");
  expect(await lamp.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(31, 157, 85)");
  // Kein Textblock „Mit OSM-Testserver verbunden“ mehr auf dem Hauptbildschirm.
  await expect(page.locator("main")).not.toContainText("verbunden");

  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.reload();
  await expect(page.locator(".footer-lamp")).toHaveClass(/footer-lamp-off/);
  await expect(page.locator(".footer-lamp")).toHaveAttribute("aria-label", "Nicht verbunden");
  expect(await page.locator(".footer-lamp").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(214, 69, 69)");
});

test("the lamp label and the logout section exist in all six languages", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: true, developmentSession: true } }));
  await page.goto("/");
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    const label = await page.locator(".footer-lamp").getAttribute("aria-label");
    expect(label, `Lampe in ${code}`).toBeTruthy();
    await page.locator("#open-info").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#osm-sign-out")).toBeVisible();
    // Lampe und Abschnitt im Info-Dialog nennen denselben Status in derselben Sprache.
    expect(label).toBe((await dialog.locator(".account-section h3").innerText()).trim());
    await page.keyboard.press("Escape");
  }
});

test("the confirmation page shows only the essentials and offers no way out of the app", async ({ page }) => {
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [
    { id: "node/123", osmType: "node", version: 7, coordinateQuality: "exact", position: { latitude: 52.52001, longitude: 13.40501 }, tags: { emergency: "defibrillator", "defibrillator:location": "Links neben dem Garagentor" } },
  ] } }));
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
  for (const removed of ["In OpenStreetMap", "Ausgewählter AED", "Einzige vorgeschlagene", "Bisher", "nicht gesetzt", "Testserver"]) {
    await expect(content).not.toContainText(removed);
  }
  // Ein einziger Treffer: „Zurück zu den Treffern“ hätte keine Bedeutung und entfällt.
  await expect(page.locator("[data-action='back-to-candidates']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Foto verwerfen" })).toBeVisible();
});

test("with several matches the confirmation page can go back to choose another one", async ({ page }) => {
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [
    { id: "node/123", osmType: "node", version: 7, coordinateQuality: "exact", position: { latitude: 52.52001, longitude: 13.40501 }, tags: { emergency: "defibrillator", name: "Rathaus" } },
    { id: "node/124", osmType: "node", version: 3, coordinateQuality: "exact", position: { latitude: 52.52002, longitude: 13.40502 }, tags: { emergency: "defibrillator", name: "Bahnhof" } },
  ] } }));
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

test("the confirmation page shows the earlier check date only when there is one", async ({ page }) => {
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [
    { id: "node/123", osmType: "node", version: 7, coordinateQuality: "exact", position: { latitude: 52.52001, longitude: 13.40501 }, tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2025-01-01" } },
  ] } }));
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await page.locator('[data-action="preview-candidate"]').click();
  await expect(page.locator(".capture-content")).toContainText("Bisher: 2025-01-01");
});

// ---------------------------------------------------------------------------------------------
// Handy-Standort statt fehlendem Foto-GPS: einmal beim Start fragen, danach ohne Zwischenfrage,
// aber nur für ein frisch mit der Kamera der App aufgenommenes Foto.
// ---------------------------------------------------------------------------------------------

/** Legt eine frische Datei ohne GPS in die Kamera-Eingabe, so wie ein gerade aufgenommenes iPhone-Foto im Browser. */
async function takeFreshCameraPhotoWithoutGps(page: import("@playwright/test").Page, ageMs = 0): Promise<void> {
  await page.evaluate((age) => {
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#176b4b"/></svg>'], "kamera.svg", { type: "image/svg+xml", lastModified: Date.now() - age });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>("#camera-input")!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, ageMs);
}

test("a fresh camera photo without GPS uses the allowed phone location without asking again", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  const searches: { latitude: number; longitude: number }[] = [];
  await page.route("**/api/osm/candidates/search", async (route) => { searches.push(route.request().postDataJSON()); await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } }); });
  await page.goto("/");
  await takeFreshCameraPhotoWithoutGps(page);
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();

  // Keine Standort-Zwischenfrage: Die Suche läuft direkt mit dem Handy-Standort.
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toHaveCount(0);
  expect(searches).toHaveLength(1);
  expect(searches[0].latitude).toBeCloseTo(52.52, 4);
  await expect(page.locator(".capture-content")).toContainText("Handy-Standort verwendet");
});

test("the phone location is not used for a gallery photo, even when it was allowed", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  let searches = 0;
  await page.route("**/api/osm/candidates/search", async (route) => { searches += 1; await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } }); });
  await page.goto("/");
  // Ein Foto aus der Galerie kann alt sein: Das Handy ist vielleicht längst woanders.
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  expect(searches).toBe(0);
});

test("an older camera photo without GPS still asks where the AED is", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  let searches = 0;
  await page.route("**/api/osm/candidates/search", async (route) => { searches += 1; await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } }); });
  await page.goto("/");
  // Eine Stunde alt: Die Person ist inzwischen vielleicht weitergegangen.
  await takeFreshCameraPhotoWithoutGps(page, 60 * 60 * 1_000);
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  expect(searches).toBe(0);
});

test("without the location permission a fresh camera photo still shows the explicit choice", async ({ page }) => {
  let searches = 0;
  await page.route("**/api/osm/candidates/search", async (route) => { searches += 1; await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } }); });
  await page.goto("/");
  await takeFreshCameraPhotoWithoutGps(page);
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  expect(searches).toBe(0);
});

test("the GPS of the photo wins over the phone location", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 48.137, longitude: 11.575, accuracy: 10 });
  const searches: { latitude: number }[] = [];
  await page.route("**/api/osm/candidates/search", async (route) => { searches.push(route.request().postDataJSON()); await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } }); });
  await page.goto("/");
  await page.locator("#camera-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirm = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirm.isVisible()) await dateConfirm.click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  // Foto-GPS (Berlin), nicht der Handy-Standort (München).
  expect(searches[0].latitude).toBeCloseTo(52.52, 3);
  await expect(page.locator(".capture-content")).toContainText("Standort aus dem Foto verwendet");
});

test.describe("the one-time location request", () => {
  /** Zählt die Standortabfragen der Seite über Neuladen hinweg (localStorage überlebt das Neuladen). */
  const countGeolocationCalls = async (page: import("@playwright/test").Page) =>
    Number(await page.evaluate(() => window.localStorage.getItem("test-geolocation-calls") ?? "0"));

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (...args: Parameters<Geolocation["getCurrentPosition"]>) => {
        window.localStorage.setItem("test-geolocation-calls", String(Number(window.localStorage.getItem("test-geolocation-calls") ?? "0") + 1));
        return original(...args);
      };
    });
  });

  test("asks exactly once after sign-in and never again after a restart", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".footer-lamp-on")).toBeVisible();
    await expect.poll(() => countGeolocationCalls(page)).toBe(1);
    await page.reload();
    await expect(page.locator(".footer-lamp-on")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await countGeolocationCalls(page)).toBe(1);
  });

  test("does not ask while signed out", async ({ page }) => {
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
    await page.goto("/");
    await expect(page.locator(".footer-lamp-off")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await countGeolocationCalls(page)).toBe(0);
  });

  test("does not ask when the location was already allowed", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await page.goto("/");
    await expect(page.locator(".footer-lamp-on")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await countGeolocationCalls(page)).toBe(0);
  });
});
