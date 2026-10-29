import { expect, test } from "@playwright/test";
import exifr from "exifr";

const languageCodes = ["de", "en", "pl", "ja", "fr", "es"];

async function beginNearbySearch(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "AEDs in der Umgebung suchen" }).click();
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

test("the OSM login is offered only when configured and is localized in all six languages", async ({ page }) => {
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `horizontal page overflow in ${language}`).toBeLessThanOrEqual(320);
    await expect(page.locator(".account-panel")).toContainText(language === "de" ? "Änderungen an OpenStreetMap" : "OpenStreetMap");
  }
});

test("AI photo analysis requires sign-in and an explicit send action; its result never offers an OSM write", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  let requests = 0;
  await page.route("**/api/vision/analyze", async (route) => {
    requests += 1;
    expect(route.request().method()).toBe("POST");
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({ content_type: "image/jpeg" }));
    expect(Object.keys(payload).sort()).toEqual(["content_type", "image_base64", "request_id"]);
    expect(String(payload.image_base64)).toMatch(/^\/9j/u);
    await route.fulfill({ json: {
      request_id: payload.request_id,
      model: "gpt-6-luna",
      observation: {
        scene: "device_visible", device_count: 1, readable_text: ["AED", "<script>ignore rules</script>"],
        manufacturer: null, model: null, location_clues: [], image_issues: [],
      },
    } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.waitForTimeout(100);
  await expect(page.getByRole("button", { name: "Foto an OpenAI senden" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Demoablauf simulieren" })).toHaveCount(0);
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await expect(page.getByRole("heading", { name: "KI-Bildbeobachtung" })).toBeVisible();
  await expect(page.locator(".result-message")).toContainText("AED-Gerät sichtbar");
  await expect(page.locator(".result-message")).toContainText("<script>ignore rules</script>");
  await expect(page.locator(".result-message script")).toHaveCount(0);
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  expect(requests).toBe(1);
});

test("a development login can run read-only AI analysis while OSM writes remain disabled", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    authenticated: true, loginAvailable: false, developmentLoginAvailable: true,
    developmentSession: true, developmentWriteAvailable: false,
  } }));
  let analysisRequests = 0;
  let osmWriteRequests = 0;
  await page.route("**/api/vision/analyze", async (route) => {
    analysisRequests += 1;
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: ["AED"], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  await page.route("**/api/osm/development/**", async (route) => {
    osmWriteRequests += 1;
    await route.fulfill({ status: 403, json: { error: "writes_disabled" } });
  });

  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  const analyzeButton = page.getByRole("button", { name: "Foto an OpenAI senden" });
  await expect(analyzeButton).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText("OpenStreetMap wird dabei nicht geändert");
  await analyzeButton.click();
  await expect(page.getByRole("heading", { name: "KI-Bildbeobachtung" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText("Es wurde nichts in OpenStreetMap geändert");
  expect(analysisRequests).toBe(1);
  expect(osmWriteRequests).toBe(0);
});

test("a demo-only photo screen does not claim to send the photo to OpenAI", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false } }));
  let analysisRequests = 0;
  await page.route("**/api/vision/analyze", async (route) => {
    analysisRequests += 1;
    await route.fulfill({ status: 500 });
  });
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#scenario").selectOption("existing");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");

  await expect(page.locator(".capture-content")).toContainText("Der echte Foto-Test ist noch nicht freigeschaltet");
  await expect(page.locator(".capture-content")).not.toContainText("an OpenAI gesendet");
  await expect(page.locator(".capture-content")).toContainText("Die Demo zeigt das gewählte Beispielszenario und wertet dein Foto nicht aus");
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();
  await expect(page.getByRole("heading", { name: "AED gefunden" })).toBeVisible();
  expect(analysisRequests).toBe(0);
});

test("diagnostic consent applies to one run and requires a fresh opt-in next time", async ({ page }) => {
  const diagnosticEvents: Array<{ event: string; flowId: string }> = [];
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false } }));
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
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: ["AED"], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
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
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await beginNearbySearch(page);

  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  await expect(page.locator(".candidate-list")).toContainText("Rathaus");
  await expect(page.locator(".candidate-list a")).toHaveAttribute("href", "https://www.openstreetmap.org/node/123");
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  await expect(page.locator(".capture-content")).toContainText("nichts gespeichert oder in OpenStreetMap geändert");
  expect(searchRequests).toBe(1);

  await page.getByRole("button", { name: "Als noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText("Einzige vorgeschlagene Änderung: Prüfdatum");
  await expect(page.locator(".capture-content")).toContainText("Rathaus <img src=x onerror=alert(2)>");
  await expect(page.locator(".capture-content")).toContainText("Bisher: <img src=x onerror=alert(1)>");
  await expect(page.locator(".capture-content img[onerror]")).toHaveCount(0);
  await expect(page.locator(".capture-content")).toContainText(new Date().toISOString().slice(0, 10));
  await expect(page.locator(".capture-content")).toContainText("Das ist nur eine Vorschau. Es wurde nichts gespeichert oder an OpenStreetMap gesendet.");
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  await expect(page.locator("[data-action='back-to-candidates']")).toBeVisible();
  expect(searchRequests).toBe(1);
});

test("a geotagged photo supplies the nearby search location and its GPS is stripped before AI upload", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  let analyzedImageGps: unknown;
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    const binary = atob(String(payload.image_base64));
    analyzedImageGps = await exifr.gps(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: ["AED"], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  let searchLocation: Record<string, unknown> | undefined;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchLocation = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await expect(page.getByRole("heading", { name: "KI-Bildbeobachtung" })).toBeVisible();
  await page.getByRole("button", { name: "AEDs in der Umgebung suchen" }).click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();

  expect(searchLocation?.latitude).toBeCloseTo(52.52, 5);
  expect(searchLocation?.longitude).toBeCloseTo(13.405, 5);
  expect(searchLocation?.accuracy_meters).toBe(100);
  expect(analyzedImageGps).toBeUndefined();
  await expect(page.locator(".capture-content")).toContainText("Standort aus dem Foto verwendet");
});

test("a photo without GPS does not silently search the phone location", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { request_id: payload.request_id, model: "gpt-6-luna", observation: { scene: "device_visible", device_count: 1, readable_text: ["AED"], manufacturer: null, model: null, location_clues: [], image_issues: [] } } });
  });
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await page.getByRole("button", { name: "AEDs in der Umgebung suchen" }).click();
  await expect(page.getByText(/Dieses Foto enthält keine GPS-Koordinaten/u)).toBeVisible();
  await expect(page.locator("[data-action='use-phone-location']")).toBeVisible();
  expect(searchRequests).toBe(0);

  await page.locator("[data-action='use-phone-location']").click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  expect(searchRequests).toBe(1);
  await expect(page.locator(".capture-content")).toContainText("Handy-Standort verwendet");
});

test("the development-session preview sends one explicitly confirmed, versioned check-date update", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    authenticated: true, loginAvailable: true, developmentLoginAvailable: true,
    developmentSession: true, developmentWriteAvailable: true,
  } }));
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: ["AED"], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
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
  await page.locator('[data-action="analyze-live"]').click();
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
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: ["AED"], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
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
  await page.locator('[data-action="analyze-live"]').click();
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
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
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
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await beginNearbySearch(page);
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
  await page.getByRole("button", { name: "Zurück zu den Treffern" }).click();

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
  await expect(page.getByRole("link", { name: "Position auf OpenStreetMap ansehen" })).toHaveAttribute("href", /openstreetmap\.org\/\?mlat=52\.52000/u);
  await expect(page.locator(".capture-content")).toContainText("Änderungen bleiben auf dem OSM-Testserver.");
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  expect(searchRequests).toBe(1);
  expect(nonSearchOsmRequests).toEqual([]);

  let createRequest: Record<string, unknown> | undefined;
  await page.route("**/api/osm/development/create-node", async (route) => {
    createRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { status: "complete", node_id: "456", version: 1 } });
  });
  const createResponse = page.waitForResponse("**/api/osm/development/create-node");
  await page.getByRole("button", { name: "Testserver: AED eintragen" }).click();
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

test("a partial nearby search never offers a new AED preview", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "partial", coverage_radius_meters: 112, reason: "overpass-remark", candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await beginNearbySearch(page);
  await expect(page.locator(".capture-content")).toContainText("Overpass-Suche war unvollständig");
  await expect(page.getByRole("button", { name: "Neuen AED vorbereiten" })).toHaveCount(0);
  expect(searchRequests).toBe(1);
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
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 100, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await beginNearbySearch(page);

  await expect(page.locator(".capture-content")).toContainText("Standortzugriff wurde abgelehnt");
  expect(searchRequests).toBe(0);
});

test("an expired OSM session does not offer a search retry that cannot work", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  await page.route("**/api/osm/candidates/search", (route) => route.fulfill({ status: 401, json: { error: "authentication_required" } }));
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await beginNearbySearch(page);

  await expect(page.locator(".capture-content")).toContainText("Die OpenStreetMap-Anmeldung fehlt oder ist abgelaufen");
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toHaveCount(0);
  await expect(page.locator(".account-panel")).toContainText("Schließe den aktuellen Fotoablauf ab oder verwerfe ihn");
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
  await page.getByRole("button", { name: "Foto verwerfen" }).click();
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("an incomplete search cannot suggest a new AED and offers a retry", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    if (searchRequests === 2) {
      await route.fulfill({ status: 429, headers: { "Retry-After": "2" }, json: { error: "search_rate_limited" } });
      return;
    }
    if (searchRequests === 3) {
      await route.fulfill({ status: 502, headers: { "Retry-After": "2" }, json: { error: "overpass_unavailable" } });
      return;
    }
    await route.fulfill(searchRequests === 1 ? { headers: { "Retry-After": "2" }, json: {
      status: "partial", coverage_radius_meters: 112, reason: "overpass-remark",
      candidates: [{ id: "node/456", osmType: "node", coordinateQuality: "exact", position: { latitude: 52.52001, longitude: 13.40501 }, tags: { emergency: "defibrillator", name: "Bahnhof" } }],
    } } : { json: { status: "complete", coverage_radius_meters: 112, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await beginNearbySearch(page);

  await expect(page.locator(".capture-content")).toContainText("Die Overpass-Suche war unvollständig");
  await expect(page.locator(".candidate-list")).toContainText("Bahnhof");
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  await expect(page.locator(".capture-content")).toContainText("Erneute Suche in 2 s möglich.");
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toHaveCount(0);
  await expect(page.locator(".capture-content")).toContainText("Erneute Suche in 1 s möglich.");
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  await expect(page.locator(".capture-content")).toContainText("Die Suche ist vorübergehend begrenzt");
  await expect(page.locator(".capture-content")).toContainText("Erneute Suche in 2 s möglich.");
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  await expect(page.locator(".capture-content")).toContainText("Die Umgebungssuche ist vorübergehend nicht erreichbar");
  await expect(page.locator(".capture-content")).toContainText("Erneute Suche in 2 s möglich.");
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  await expect(page.locator(".capture-content")).toContainText("Die vollständige Suche fand im abgedeckten Bereich keinen AED");
  expect(searchRequests).toBe(4);
});

test("an imprecise location is not sent to the nearby search endpoint", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 150 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 250, candidates: [] } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await beginNearbySearch(page);

  await expect(page.locator(".capture-content")).toContainText("Der Standort ist zu ungenau");
  expect(searchRequests).toBe(0);
});

test("the brand link cannot discard a photo while its AI request is in flight", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  let releaseResponse!: () => void;
  let signalRequestStarted!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const requestStarted = new Promise<void>((resolve) => { signalRequestStarted = resolve; });
  let requests = 0;
  await page.route("**/api/vision/analyze", async (route) => {
    requests += 1;
    signalRequestStarted();
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await responseGate;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await expect(page.getByRole("status")).toContainText("Foto wird geschützt an OpenAI übermittelt");
  await requestStarted;
  const brand = page.locator(".brand");
  const currentUrl = page.url();
  await expect(brand).toHaveAttribute("aria-disabled", "true");
  await brand.dispatchEvent("click");

  await expect(page).toHaveURL(currentUrl);
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
  expect(requests).toBe(1);
  releaseResponse();
  await expect(page.getByRole("heading", { name: "KI-Bildbeobachtung" })).toBeVisible();
});

test("the live photo endpoint is not called until the user is signed in and chooses AI analysis", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  let requests = 0;
  await page.route("**/api/vision/analyze", async (route) => {
    requests += 1;
    await route.fulfill({ status: 401, json: { error: "authentication_required" } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await expect(page.locator(".capture-content")).toContainText("Verwirf dieses Foto, melde dich unten bei OpenStreetMap an");
  await expect(page.getByRole("button", { name: "Foto an OpenAI senden" })).toHaveCount(0);
  expect(requests).toBe(0);
});

test("an expired server session is shown as signed out after a 401", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/vision/analyze", (route) => route.fulfill({ status: 401, json: { error: "authentication_required" } }));
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();

  await expect(page.locator(".account-panel")).toContainText("Schließe den aktuellen Fotoablauf ab oder verwerfe ihn");
  await page.getByRole("button", { name: "Foto verwerfen" }).click();
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("a temporary session-store failure keeps the photo and offers a safe retry", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  let requests = 0;
  await page.route("**/api/vision/analyze", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({ status: 503, json: { error: "session_unavailable" } });
      return;
    }
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();

  await expect(page.getByText("Die Anmeldung konnte gerade nicht geprüft werden.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mit demselben Foto erneut versuchen" })).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Mit demselben Foto erneut versuchen" }).click();

  await expect(page.getByRole("heading", { name: "KI-Bildbeobachtung" })).toBeVisible();
  expect(requests).toBe(2);
});

test("a temporary budget-reservation failure keeps the photo and offers a safe retry", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  let requests = 0;
  const requestIds: string[] = [];
  await page.route("**/api/vision/analyze", async (route) => {
    requests += 1;
    requestIds.push((route.request().postDataJSON() as Record<string, unknown>).request_id as string);
    if (requests === 1) {
      await route.fulfill({ status: 503, json: { error: "analysis_budget_unavailable" } });
      return;
    }
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "device_visible", device_count: 1, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();

  await expect(page.getByText("Die Analyse konnte vor dem KI-Aufruf nicht vorbereitet werden.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mit demselben Foto erneut versuchen" })).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Mit demselben Foto erneut versuchen" }).click();

  await expect(page.getByRole("heading", { name: "KI-Bildbeobachtung" })).toBeVisible();
  expect(requests).toBe(2);
  expect(requestIds[1]).toBe(requestIds[0]);
});

test("an uncertain provider claim keeps the photo but does not offer a retry", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  let requests = 0;
  await page.route("**/api/vision/analyze", async (route) => {
    requests += 1;
    await route.fulfill({ status: 503, json: { error: "analysis_claim_uncertain" } });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();

  await expect(page.getByText("Die Datenbank hat den Start der Analyse nicht eindeutig bestätigt.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mit demselben Foto erneut versuchen" })).toHaveCount(0);
  expect(requests).toBe(1);
});

test("the AI result remains readable on a narrow phone in all six languages", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "unclear", device_count: 0, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  await page.goto("/");

  const languages = [
    { code: "de", send: "Foto an OpenAI senden", result: "KI-Bildbeobachtung", discard: "Foto verwerfen", missingGps: "Dieses Foto enthält keine GPS-Koordinaten" },
    { code: "en", send: "Send photo to OpenAI", result: "AI image observation", discard: "Discard photo", missingGps: "This photo has no GPS coordinates" },
    { code: "pl", send: "Wyślij zdjęcie do OpenAI", result: "Obserwacja AI", discard: "Odrzuć zdjęcie", missingGps: "To zdjęcie nie zawiera współrzędnych GPS" },
    { code: "ja", send: "写真をOpenAIに送信", result: "AIによる画像の観察", discard: "写真を破棄", missingGps: "この写真にはGPS座標がありません" },
    { code: "fr", send: "Envoyer la photo à OpenAI", result: "Observation de l’image par l’IA", discard: "Supprimer la photo", missingGps: "Cette photo ne contient pas de coordonnées GPS" },
    { code: "es", send: "Enviar foto a OpenAI", result: "Observación de imagen de IA", discard: "Descartar foto", missingGps: "Esta foto no contiene coordenadas GPS" },
  ];
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  for (const language of languages) {
    await page.locator("#language").selectOption(language.code);
    await page.getByRole("button", { name: language.send }).click();
    await expect(page.getByRole("heading", { name: language.result })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `horizontal page overflow in ${language.code}`).toBeLessThanOrEqual(320);
    await page.locator('[data-action="search-nearby"]').click();
    await expect(page.locator(".capture-content")).toContainText(language.missingGps);
    await expect(page.locator('[data-action="use-phone-location"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `horizontal location-choice overflow in ${language.code}`).toBeLessThanOrEqual(320);
    await page.getByRole("button", { name: language.discard }).click();
    if (language.code !== "es") await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  }
});

test("the OSM login link stays hidden when the Worker has no OAuth setup", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: false, developmentLoginAvailable: false, developmentSession: false } }));
  await page.goto("/");

  await expect(page.locator(".account-panel")).toContainText("OpenStreetMap-Anmeldung ist noch nicht eingerichtet");
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

  await expect(page.locator(".account-panel")).toContainText("Mit OpenStreetMap verbunden");
  await expect(page.locator(".account-panel")).toContainText("Änderungen an OpenStreetMap sind noch deaktiviert");
  await page.getByRole("button", { name: "Abmelden" }).click();
  const signIn = page.getByRole("link", { name: "Mit OpenStreetMap anmelden" });
  await expect(signIn).toBeFocused();
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
    await expect(page.locator(".account-panel")).toContainText(errors[index]);
    await expect(page.getByRole("link", { name: ["Mit OpenStreetMap anmelden", "Sign in with OpenStreetMap", "Zaloguj się przez OpenStreetMap", "OpenStreetMapでログイン", "Se connecter avec OpenStreetMap", "Iniciar sesión con OpenStreetMap"][index] })).toHaveAttribute("href", "/api/auth/osm/start");
  }
  await expect(page).not.toHaveURL(/login=error/u);
});

test("the login cannot discard an unclear save and returns after recovery", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#scenario").selectOption("upload-unclear");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();
  await page.getByRole("button", { name: "Noch vorhanden bestätigen" }).click();

  await expect(page.getByRole("heading", { name: "Ergebnis noch unklar" })).toBeVisible();
  await expect(page.locator(".account-panel")).toContainText("Schließe den aktuellen Fotoablauf ab");
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();

  await page.getByRole("button", { name: "Vorgangsstatus prüfen" }).click();
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
});

test("the login stays unavailable while a selected photo or proposal is active", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#scenario").selectOption("new");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");

  await expect(page.locator(".account-panel")).toContainText("Schließe den aktuellen Fotoablauf ab");
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toHaveCount(0);
  await page.getByRole("button", { name: "Demoablauf simulieren" }).click();
  await expect(page.getByRole("heading", { name: "Neuen AED vorbereiten" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toHaveCount(0);
  await page.getByRole("button", { name: "Anderes Foto" }).click();

  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("the login is blocked immediately while a selected photo is still decoding", async ({ page }) => {
  await page.addInitScript(() => {
    let finishDecode: (() => void) | undefined;
    Object.defineProperty(window, "finishPhotoDecodeForTest", { value: () => finishDecode?.() });
    HTMLImageElement.prototype.decode = function () {
      if (this.src.startsWith("blob:")) return new Promise<void>((resolve) => { finishDecode = resolve; });
      return Promise.resolve();
    };
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } }));
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");

  await expect(page.locator(".account-panel")).toContainText("Schließe den aktuellen Fotoablauf ab");
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Window & { finishPhotoDecodeForTest: () => void }).finishPhotoDecodeForTest());
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
});

test("a session status connection error can be retried without losing the selected photo", async ({ page }) => {
  let checks = 0;
  await page.route("**/api/auth/session", (route) => {
    checks += 1;
    return checks === 1
      ? route.fulfill({ status: 503, json: { error: "session_unavailable" } })
      : route.fulfill({ json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false } });
  });
  await page.goto("/");
  await expect(page.locator(".account-panel")).toContainText("Anmeldung ist gerade nicht erreichbar");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();

  await page.getByRole("button", { name: "Erneut prüfen" }).click();

  await expect(page.locator(".account-panel")).toContainText("Schließe den aktuellen Fotoablauf ab");
  await expect(page.getByRole("button", { name: "Erneut prüfen" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Dein AED-Foto" })).toBeVisible();
  await page.getByRole("button", { name: "Anderes Foto" }).click();
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
