import { expect, test } from "@playwright/test";
import {
  languageCodes,
  visionObservation,
  enablePhotoCheck,
  takeFreshCameraPhotoWithoutGps,
  setUpFailingFirstSearch,
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

test("serves the app with security headers while photo preview and service worker work", async ({
  page,
  browserName,
}) => {
  const response = await page.goto("/");
  expect(response).not.toBeNull();
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["permissions-policy"]).toContain("camera=(self)");

  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await expect(page.locator("img.photo-preview")).toHaveAttribute("src", /^blob:/u);
  if (browserName === "chromium") {
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length))
      .toBeGreaterThan(0);
  }
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
  await page.locator("#photo-observed-on").fill(
    await page.evaluate(() => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }),
  );
  await page.locator('[data-action="confirm-photo-date"]').click();
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  expect(searchRequests).toBe(0);
});

test("a fresh camera photo without EXIF date skips the observation-date question", async ({ page }) => {
  await page.goto("/");
  // Erst warten, bis die App das Eingabefeld gezeichnet hat; sonst gibt es unter Last noch keins.
  await page.locator("#camera-input").waitFor({ state: "attached" });
  // Eine im Browser erzeugte Datei trägt die aktuelle Zeit als Dateizeit – wie ein Foto,
  // das die Kamera gerade eben aufgenommen hat. Sie enthält keine EXIF-Daten.
  await page.evaluate(() => {
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#176b4b"/></svg>',
      ],
      "kamera.svg",
      { type: "image/svg+xml" },
    );
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
  // Erst warten, bis die App das Eingabefeld gezeichnet hat; sonst gibt es unter Last noch keins.
  await page.locator("#file-input").waitFor({ state: "attached" });
  // Bei „Foto auswählen“ sagt die Dateizeit nichts über die Aufnahme aus (z. B. ein gerade erst
  // gespeichertes altes Bild). Die 5-Minuten-Regel darf hier ohne EXIF-Zeit nicht greifen.
  await page.evaluate(() => {
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#176b4b"/></svg>',
      ],
      "galerie.svg",
      { type: "image/svg+xml" },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>("#file-input")!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await expect(page.getByRole("heading", { name: "Wann hast du den AED gesehen?" })).toBeVisible();
});

test("an older camera input photo without EXIF date requires explicit observation-date confirmation", async ({
  page,
}) => {
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
  await expect(page.locator("#photo-observed-on")).toHaveValue(
    await page.evaluate(() => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }),
  );
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

test("signed-out visitors cannot select a photo", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AEDjaeger braucht dein OpenStreetMap-Konto" })).toBeVisible();
  await expect(page.locator("#camera-input, #file-input, [data-action]")).toHaveCount(0);
});

test("a damaged image is rejected before the AED flow can start", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/invalid-image.svg");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Das Bild konnte nicht geöffnet werden");
  await expect(alert).toBeFocused();
});

test("a passed photo check continues like a confirmed sighting and uploads no metadata", async ({ page }) => {
  await enablePhotoCheck(page);
  const uploads: Record<string, unknown>[] = [];
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    uploads.push(body);
    await route.fulfill({
      json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("device_visible") },
    });
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
  await expect(page.locator(".capture-content")).toContainText(
    "Das Foto geht ohne Standort und Metadaten zur Prüfung an OpenAI.",
  );
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

test("a rejected photo can still continue after two explicit confirmations", async ({ page }) => {
  await enablePhotoCheck(page);
  const searches: unknown[] = [];
  await page.route("**/api/osm/candidates/search", async (route) => {
    searches.push(route.request().postDataJSON());
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as { request_id: string };
    await route.fulfill({
      json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("other_object") },
    });
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

test("the second confirmation can be abandoned, and the override is offered for unclear photos too", async ({
  page,
}) => {
  await enablePhotoCheck(page);
  let searches = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searches += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as { request_id: string };
    await route.fulfill({
      json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("unclear") },
    });
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

test("an unclear photo asks for a closer picture", async ({ page }) => {
  await enablePhotoCheck(page);
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as { request_id: string };
    await route.fulfill({
      json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("unclear") },
    });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await page.getByRole("button", { name: "AED gesehen – Foto prüfen" }).click();
  await expect(page.getByRole("heading", { name: "Nicht eindeutig" })).toBeVisible();
  await expect(page.locator('[data-action="confirm-sighting"]')).toHaveCount(0);
});

for (const failure of [
  {
    name: "the daily budget is used up",
    status: 429,
    body: { error: "analysis_budget_exceeded" },
    code: "analysis_budget_exceeded (HTTP 429)",
  },
  {
    name: "the provider is down",
    status: 502,
    body: { error: "analysis_failed", detail_status: 401, detail_code: "invalid_api_key" },
    code: "analysis_failed (HTTP 502, OpenAI 401, invalid_api_key)",
  },
  {
    name: "the budget table is missing",
    status: 503,
    body: { error: "analysis_budget_unavailable", detail_code: "missing_table" },
    code: "analysis_budget_unavailable (HTTP 503, missing_table)",
  },
  {
    name: "the response is malformed",
    status: 200,
    body: { unexpected: true },
    code: "invalid_response (unexpected_shape)",
  },
]) {
  test(`when ${failure.name}, the person can still confirm the sighting themselves`, async ({ page }) => {
    await enablePhotoCheck(page);
    await page.route("**/api/vision/analyze", (route) => route.fulfill({ status: failure.status, json: failure.body }));
    await page.route("**/api/osm/candidates/search", (route) =>
      route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } }),
    );
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
  await page.route("**/api/vision/analyze", async (route) => {
    uploads += 1;
    await route.fulfill({ status: 503, json: { error: "analysis_unavailable" } });
  });
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
    de: "AED gesehen – Foto prüfen",
    en: "I see an AED — check photo",
    pl: "Widzę AED — sprawdź zdjęcie",
    ja: "AEDを確認 — 写真を確認する",
    fr: "Je vois un DAE — vérifier la photo",
    es: "Veo un DEA — comprobar la foto",
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

test("the info dialog tells the truth about the optional photo check in all six languages", async ({ page }) => {
  await enablePhotoCheck(page);
  await page.goto("/");
  // Aussagen, die mit aktiver Fotoprüfung falsch wären (je Sprache ein Auszug). Der Demo-Text
  // „Beispielszenarien laufen lokal …“ gehört nicht dazu: Er beschreibt nur die Demo, die nie hochlädt.
  const falseClaims = [
    "Das Foto bleibt lokal; OSM-Änderungen",
    "Photos stay local; OSM",
    "Zdjęcia pozostają lokalnie; zmiany",
    "写真は端末内に残り、OSMへの変更",
    "Les photos restent locales ; les modifications",
    "Las fotos permanecen locales; los cambios",
    "Automatische Erkennung ist nicht im Pilot",
    "Automatic recognition is not part of the pilot",
    "Automatyczne rozpoznawanie nie jest częścią pilotażu",
    "自動認識はパイロットに含まれません",
    "La reconnaissance automatique ne fait pas partie du pilote",
    "El reconocimiento automático no forma parte del piloto",
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
  // Foto-GPS enthält keine Genauigkeit: Es gilt der gemeinsame Annahmewert (src/domain/matchPolicy.ts).
  expect(usedPhotoLocation.accuracy_meters).toBe(25);
  await expect(page.locator(".capture-content")).toContainText("Standort aus dem Foto verwendet");
});

test("an older gallery photo requires an explicit observation date before searching", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  let searchRequests = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searchRequests += 1;
    await route.fulfill({
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
    });
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
  await expect(page.locator(".capture-content")).toContainText("Prüfdatum: 20. Oktober 2025");
  // Der bisherige Wert steht dabei, weil es einen gibt.
  await expect(page.locator(".capture-content")).toContainText("Bisher: 1. Januar 2025");
});

test("a photo without GPS does not silently search the phone location", async ({ page, context }) => {
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

test("a photo without a recognizable AED is blocked and cannot start a search", async ({ page }) => {
  await enablePhotoCheck(page);
  let searches = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searches += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
  await page.route("**/api/vision/analyze", async (route) => {
    const body = route.request().postDataJSON() as { request_id: string };
    await route.fulfill({
      json: { request_id: body.request_id, model: "gpt-6-luna", observation: visionObservation("other_object") },
    });
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

test("a fresh camera photo without GPS uses the allowed phone location without asking again", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  const searches: { latitude: number; longitude: number }[] = [];
  await page.route("**/api/osm/candidates/search", async (route) => {
    searches.push(route.request().postDataJSON());
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
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
  await page.route("**/api/osm/candidates/search", async (route) => {
    searches += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
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
  await page.route("**/api/osm/candidates/search", async (route) => {
    searches += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
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
  await page.route("**/api/osm/candidates/search", async (route) => {
    searches += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
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
  await page.route("**/api/osm/candidates/search", async (route) => {
    searches.push(route.request().postDataJSON());
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
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

test("a camera photo that became stale while waiting no longer uses the phone location", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  let searches = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searches += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
  // Eine kontrollierbare Uhr: So lässt sich „die App lag zehn Minuten im Hintergrund“ nachstellen.
  await page.clock.install({ time: new Date("2026-11-11T07:00:00Z") });
  await page.goto("/");
  await takeFreshCameraPhotoWithoutGps(page);
  await expect(page.locator('[data-action="confirm-sighting"]')).toBeVisible();

  // Die Person lässt die App nach der Aufnahme sechs Minuten liegen und bestätigt dann, vielleicht an einem anderen Ort.
  await page.clock.fastForward("06:00");
  await page.locator('[data-action="confirm-sighting"]').click();
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  expect(searches).toBe(0);
});

test("a camera photo that is still fresh at confirmation uses the phone location", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  let searches = 0;
  await page.route("**/api/osm/candidates/search", async (route) => {
    searches += 1;
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
  await page.clock.install({ time: new Date("2026-11-11T07:00:00Z") });
  await page.goto("/");
  await takeFreshCameraPhotoWithoutGps(page);
  await page.clock.fastForward("04:00");
  await page.locator('[data-action="confirm-sighting"]').click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  expect(searches).toBe(1);
});

test("retrying an automatic phone-location search after the photo went stale asks for the location again", async ({
  page,
  context,
}) => {
  const requests = await setUpFailingFirstSearch(page, context);
  await page.goto("/");
  await takeFreshCameraPhotoWithoutGps(page);
  await page.locator('[data-action="confirm-sighting"]').click();
  // Die automatische Suche mit dem Handy-Standort scheitert zunächst.
  await expect(page.locator(".capture-content")).toContainText("Die Umgebungssuche ist vorübergehend nicht erreichbar");
  expect(requests.count).toBe(1);

  // Die Person lässt die App sechs Minuten liegen, geht woanders hin und versucht es erneut.
  await page.clock.fastForward("06:00");
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  // Der selbst eingesetzte Standort gilt nicht mehr: ausdrückliche Wahl, und es geht keine Suche mit dem neuen Ort raus.
  await expect(page.getByRole("heading", { name: "Standort für die Suche wählen" })).toBeVisible();
  expect(requests.count).toBe(1);
});

test("retrying an automatic phone-location search while the photo is still fresh searches again", async ({
  page,
  context,
}) => {
  const requests = await setUpFailingFirstSearch(page, context);
  await page.goto("/");
  await takeFreshCameraPhotoWithoutGps(page);
  await page.locator('[data-action="confirm-sighting"]').click();
  await expect(page.locator(".capture-content")).toContainText("Die Umgebungssuche ist vorübergehend nicht erreichbar");

  await page.clock.fastForward("00:05");
  await page.getByRole("button", { name: "Standort und AEDs erneut suchen" }).click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  expect(requests.count).toBe(2);
});
