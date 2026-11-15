import { expect, test } from "@playwright/test";
import {
  languageCodes,
  visionObservation,
  enablePhotoCheck,
  publishNewVersion,
  openCandidateList,
  openExistingAedPreview,
  freshNode,
  knownNode,
  correctButton,
  detailsFromList,
  requireValue,
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

test("the information roadmap fits a narrow phone screen in all six languages", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");

  for (const language of languageCodes) {
    await page.locator("#language").selectOption(language);
    await page.locator("#open-info").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toContainText("AEDjaeger");
    const iconCredits = dialog.locator(".icon-credits");
    await expect(iconCredits).toBeVisible();
    await expect(iconCredits).toContainText("CC0");
    await expect(iconCredits.locator("a").nth(0)).toHaveAttribute(
      "href",
      "https://github.com/mapbox/maki/blob/main/icons/defibrillator.svg",
    );
    await expect(iconCredits.locator("a").nth(1)).toHaveAttribute(
      "href",
      "https://creativecommons.org/publicdomain/zero/1.0/",
    );
    await expect(dialog.getByRole("heading", { level: 3 }).last()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `horizontal page overflow in ${language}`,
    ).toBeLessThanOrEqual(320);
    expect(
      await dialog.locator(".info-dialog-content").evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

test("uses the Maki defibrillator glyph in the welcome illustration", async ({ page }) => {
  await page.goto("/");
  const symbol = page.locator(".empty-illustration .device-mark path").first();
  await expect(symbol).toBeVisible();
  await expect(symbol).toHaveAttribute("d", /^m1\.54995 7\.33811c-/);
});

test("changing the UI language keeps keyboard focus on the language selector", async ({ page }) => {
  await page.goto("/");
  await page.locator("#language").focus();
  await page.locator("#language").selectOption("fr");

  await expect(page.locator("#language")).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("keyboard focus indicators use a high-contrast color throughout the controls", async ({ page }) => {
  await page.goto("/");

  const controls = ["#language", "#open-info", ".brand"];
  for (const selector of controls) {
    const control = page.locator(selector);
    await control.focus();
    await expect
      .poll(() => control.evaluate((element) => getComputedStyle(element).outlineColor))
      .toBe("rgb(23, 107, 75)");
  }
});

test("the installed app shell and hashed assets remain fetchable after going offline", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Service-worker offline behavior has dedicated Chromium coverage.");
  // Insert a conflicting home page before AEDjaeger's first install to catch accidental global cache lookups.
  await page.addInitScript(async () => {
    const cache = await caches.open("aaa-other-feature-cache");
    const home = new Request(new URL("/", location.origin));
    if (!(await cache.match(home))) {
      await cache.put(
        home,
        new Response("<!doctype html><title>Other feature cache</title><p>Other app</p>", {
          headers: { "Content-Type": "text/html" },
        }),
      );
      await cache.put("/foreign-only.txt", new Response("foreign cache entry"));
    }
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const workerScript = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? "",
  );
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
  const offlineResponses = await page.evaluate(
    async (paths) =>
      Promise.all(
        paths.map(async (path) => {
          const response = await fetch(path);
          return { path, ok: response.ok, size: (await response.text()).length };
        }),
      ),
    ["/", ...cachedAppAssets.filter((path) => path.endsWith(".js") || path.endsWith(".css"))],
  );
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

test("service worker activation removes obsolete AEDjaeger shell caches", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Service-worker lifecycle is covered in Chromium.");
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

test("the muted text and version footer use the accessible contrast colors", async ({ page }) => {
  await page.goto("/");
  const styles = await page.evaluate(() => {
    const version = document.querySelector(".build-mark");
    if (!version) throw new Error("The build version label should be rendered.");
    return {
      muted: getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(),
      versionColor: getComputedStyle(version).color,
      versionSize: getComputedStyle(version).fontSize,
    };
  });
  expect(styles.muted).toBe("#5c6861");
  expect(styles.versionColor).toBe("rgb(98, 109, 102)");
  expect(styles.versionSize).toBe("12px");
});

test("the ready screen introduction keeps readable contrast", async ({ page }) => {
  await page.goto("/");

  const introduction = page.locator(".hero p");
  await expect
    .poll(() => introduction.evaluate((element) => getComputedStyle(element).color))
    .toBe("rgb(98, 109, 102)");
});

test("the override texts exist in all six languages", async ({ page }) => {
  await enablePhotoCheck(page);
  await page.route("**/api/vision/analyze", async (route) => {
    const requestId = route.request().headers()["x-request-id"];
    if (!requestId) throw new Error("The photo check request is missing its request ID header.");
    await route.fulfill({
      json: { request_id: requestId, model: "gpt-6-luna", observation: visionObservation("other_object") },
    });
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

test("a newer published version shows a banner and never reloads by itself", async ({ page }) => {
  await publishNewVersion(page);
  await page.goto("/");
  // Markierung im Fenster: Sie überlebt kein Neuladen und beweist, dass die App nicht von selbst neu lädt.
  await page.evaluate(() => {
    (window as unknown as { __notReloaded: boolean }).__notReloaded = true;
  });

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
  await page.route("**/api/vision/analyze", (route) =>
    route.fulfill({ status: 500, contentType: "text/html", body: "<html>Error 1102</html>" }),
  );
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
  await page.route("**/api/vision/analyze", (route) =>
    route.fulfill({ status: 502, json: { error: "analysis_failed", detail_code: "timeout" } }),
  );
  await page.goto("/");
  const labels: Record<string, string> = {
    de: "Fehlercode:",
    en: "Error code:",
    pl: "Kod błędu:",
    ja: "エラーコード:",
    fr: "Code d’erreur :",
    es: "Código de error:",
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
    await page.locator('[data-action="check-photo"]').click();
    await expect(page.locator(".photo-check-code")).toContainText(
      `${labels[code]} analysis_failed (HTTP 502, timeout)`,
    );
    await page.locator('[data-action="retake"]').click();
  }
});

test("the header keeps clear of the iPhone status bar and Dynamic Island", async ({ page }) => {
  await page.goto("/");
  // Chromium kennt keine echte Notch. Die Seite liest den Abstand aus --safe-top (im Betrieb env(safe-area-inset-top)).
  // Der Test setzt dort die Höhe von Uhr und Dynamic Island und prüft, dass die Kopfzeile darunter beginnt.
  await page.evaluate(() => document.documentElement.style.setProperty("--safe-top", "59px"));
  for (const selector of [".brand", "header .connection-lamp", "#open-info"]) {
    const box = await page.locator(selector).boundingBox();
    expect(requireValue(box, `Das Element ${selector}`).y, `${selector} unter der Statusleiste`).toBeGreaterThanOrEqual(
      59,
    );
  }
});

test("the info dialog shows the build version, the same one the server publishes, in all six languages", async ({
  page,
}) => {
  await page.goto("/");
  const published = (await (await page.request.get("/version.json")).json()) as { revision: string };
  expect(published.revision).toMatch(/^[a-z0-9]{4,32}$/);
  const expectedWord: Record<string, string> = {
    de: "Version",
    en: "Version",
    pl: "Wersja",
    ja: "バージョン",
    fr: "Version",
    es: "Versión",
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await page.locator("#open-info").click();
    const line = page.locator("#build-version");
    await expect(line, `Versionszeile in ${code}`).toContainText(`${expectedWord[code]} ${published.revision}`);
    // Zusätzlich steht die Build-Zeit dabei, zurückgerechnet aus der Revision (hier das aktuelle Jahr des Builds).
    await expect(line, `Build-Zeit in ${code}`).toContainText(String(new Date().getFullYear()));
    await page.keyboard.press("Escape");
  }
});

test("the build number sits small in the footer of every screen and matches the published one", async ({ page }) => {
  await page.goto("/");
  const published = (await (await page.request.get("/version.json")).json()) as { revision: string };
  const mark = page.locator("footer #build-mark");
  await expect(mark).toContainText(`Version ${published.revision}`);
  // Mit Datum und Uhrzeit des Builds, damit die Nummer nicht kryptisch bleibt.
  await expect(mark).toContainText(String(new Date().getFullYear()));
  // Auch die Versionszeile bleibt bei der Mindestgröße von 12 px lesbar.
  expect(await mark.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);

  // Auch nach der Fotoauswahl und auf der Anmeldeseite.
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await expect(page.locator('[data-action="confirm-sighting"]')).toBeVisible();
  await expect(mark).toContainText(published.revision);
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  await page.reload();
  await expect(page.locator("footer #build-mark")).toContainText(published.revision);
});

test("the footer with the build number fits a narrow phone screen in all six languages", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    const mark = await page.locator("footer #build-mark").boundingBox();
    const markBox = requireValue(mark, `Die Versionsnummer in ${code}`);
    expect(markBox.x, `Nummer links im Bild (${code})`).toBeGreaterThanOrEqual(0);
    expect(markBox.x + markBox.width, `Nummer rechts im Bild (${code})`).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `Überlauf in ${code}`).toBeLessThanOrEqual(
      320,
    );
  }
});

test("the app starts and works when the browser storage cannot even be accessed", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Wie bei „alle Cookies blockieren“: Schon der Zugriff auf localStorage und sessionStorage wirft einen Fehler.
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException("denied", "SecurityError");
    };
    Object.defineProperty(window, "localStorage", { get: blocked, configurable: true });
    Object.defineProperty(window, "sessionStorage", { get: blocked, configurable: true });
  });
  await page.goto("/");
  // Start mit der Gerätesprache (Deutsch im Test), Lampe und Aufnahme sind da.
  await expect(page.locator("header .connection-lamp-on")).toBeVisible();
  await expect(page.locator("#file-input")).toBeAttached();
  // Der Sprachwechsel greift für die offene Seite, obwohl sich nichts merken lässt.
  await page.locator("#language").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#build-version")).toContainText("Version");
  await page.locator("#language").selectOption("pl");
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  expect(pageErrors).toEqual([]);
});

test("switching the language still works when only writing to the browser storage fails", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "aedjaeger-language") throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/");
  await page.locator("#language").selectOption("fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  expect(pageErrors).toEqual([]);
});

test("only an AED within 10 m can be confirmed, one within 50 m is a hint, and one farther away is not shown", async ({
  page,
  context,
}) => {
  await openCandidateList(page, context, [
    { id: "node/101", name: "Nah", latitudeOffsetMeters: 3 },
    { id: "node/102", name: "Mittel", latitudeOffsetMeters: 35 },
    { id: "node/103", name: "Weit", latitudeOffsetMeters: 120 },
  ]);
  const items = page.locator(".candidate-item");
  await expect(items).toHaveCount(2); // Der AED in 120 m erscheint nicht.
  await expect(page.locator(".capture-content")).not.toContainText("Weit");
  // Nur der AED in 3 m bietet „Als noch vorhanden bestätigen“ an.
  await expect(page.locator('[data-action="preview-candidate"]')).toHaveCount(1);
  await expect(page.locator('[data-action="preview-candidate"]')).toHaveAttribute("data-candidate-id", "node/101");
  await expect(items.nth(0)).toContainText("Nah");
  await expect(items.nth(1)).toContainText("Mittel");
  await expect(items.nth(1)).toContainText("35 m");
  await expect(items.nth(1)).toContainText("Zu weit weg zum Bestätigen (über 10 m)");
  await expect(items.nth(0)).not.toContainText("Zu weit weg");
  // Eine Neuanlage bleibt möglich, nachdem die Treffer geprüft wurden.
  await expect(page.getByRole("button", { name: "Keiner davon – neuen AED eintragen" })).toBeVisible();
});

test("an AED between 10 m and 50 m can only be noted, never confirmed, in all six languages", async ({
  page,
  context,
}) => {
  await openCandidateList(page, context, [{ id: "node/102", name: "Mittel", latitudeOffsetMeters: 35 }]);
  await expect(page.locator('[data-action="preview-candidate"]')).toHaveCount(0);
  const expected: Record<string, string> = {
    de: "Zu weit weg zum Bestätigen",
    en: "Too far away to confirm",
    pl: "Za daleko, by potwierdzić",
    ja: "確認するには遠すぎます",
    fr: "Trop loin pour confirmer",
    es: "Demasiado lejos para confirmar",
  };
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    await expect(page.locator(".candidate-item"), `Hinweis in ${code}`).toContainText(expected[code]);
    await expect(page.locator(".candidate-item")).toContainText("10 m");
  }
});

test("a failed read offers a retry, and the retry shows the form", async ({ page, context }) => {
  const { nodeRequests } = await openExistingAedPreview(page, context, {
    nodes: [{ status: 502, body: { error: "development_api_unavailable" } }, freshNode({ check_date: "2025-10-20" })],
  });
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await expect(page.getByRole("alert")).toContainText("Die aktuellen Daten ließen sich nicht laden");
  await expect(page.locator("#detail-form")).toHaveCount(0);
  await page.getByRole("button", { name: "Erneut laden" }).click();
  await expect(page.locator("#detail-form")).toBeVisible();
  expect(nodeRequests).toHaveLength(2);
});

test("a deleted object says so and offers no useless retry", async ({ page, context }) => {
  await openExistingAedPreview(page, context, { nodes: [{ status: 404, body: { error: "node_unavailable" } }] });
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await expect(page.getByRole("alert")).toContainText("nicht mehr verfügbar");
  await expect(page.getByRole("button", { name: "Erneut laden" })).toHaveCount(0);
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(page.getByRole("button", { name: "Testserver: Prüfdatum speichern" })).toBeVisible();
});

test("an AED with everything already entered says so and offers nothing to fill in", async ({ page, context }) => {
  await openExistingAedPreview(page, context, {
    nodes: [
      freshNode({
        "defibrillator:location": "Foyer",
        access: "customers",
        opening_hours: "Mo-Fr 08:00-18:00",
        indoor: "no",
        operator: "Stadtwerke",
        phone: "112",
        description: "Notiz",
        ref: "7",
        check_date: "2025-10-20",
      }),
    ],
  });
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await expect(page.locator(".capture-content")).toContainText("schon alles eingetragen");
  await expect(page.locator("#detail-form input[type='text'], #detail-form input[type='radio']")).toHaveCount(0);
  // Der Weg bleibt offen: ohne Angaben geht es zur einfachen Bestätigung des Prüfdatums.
  await expect(page.locator("#detail-continue")).toHaveText("Weiter ohne Angaben");
});

test("an existing value from OSM is shown as plain text and never as markup", async ({ page, context }) => {
  await openExistingAedPreview(page, context, {
    nodes: [freshNode({ "defibrillator:location": "<img src=x onerror=window.__pwned=1>", check_date: "2025-10-20" })],
  });
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await expect(page.locator("#detail-group-location")).toContainText("<img src=x onerror=window.__pwned=1>");
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(page.locator("#detail-group-location img")).toHaveCount(0);
});

test("clearing a field never deletes the value in OSM", async ({ page, context }) => {
  await openExistingAedPreview(page, context, { nodes: [freshNode(knownNode)], corrections: true });
  await correctButton(page).click();
  await page.getByText("Mehr Angaben", { exact: true }).click();
  await page.locator("#detail-operator").fill("");
  await expect(page.locator("#detail-continue")).toHaveText("Weiter ohne Angaben");
  await page.locator("#detail-continue").click();
  await expect(page.locator(".capture-content")).not.toContainText("operator");
});

test("the hit list offers the tags before the date: view, add, and confirm the date once at the end", async ({
  page,
  context,
}) => {
  const { nodeRequests, writes } = await openExistingAedPreview(page, context, {
    atList: true,
    nodes: [
      freshNode({ access: "yes", "defibrillator:location": "Links neben dem Garagentor", check_date: "2025-10-20" }),
    ],
  });
  // Neben „Als noch vorhanden bestätigen“ steht der Weg zu den Tags. Es wurde noch nichts gelesen oder gesendet.
  await expect(detailsFromList(page)).toBeVisible();
  expect(nodeRequests).toEqual([]);
  await detailsFromList(page).click();
  // Das Formular zeigt, was schon in OSM steht, und das bisherige Prüfdatum. Die Datumsseite war nicht dran.
  await expect(page.getByRole("heading", { name: "Angaben ergänzen" })).toBeVisible();
  await expect(page.locator("#detail-group-access")).toContainText("Schon eingetragen: Jeder");
  await expect(page.locator("#detail-group-location")).toContainText("Links neben dem Garagentor");
  await expect(page.locator(".capture-content")).toContainText("Bisher: 20. Oktober 2025");
  expect(nodeRequests).toHaveLength(1);
  expect(writes).toEqual([]);
  await page.getByText("Rund um die Uhr", { exact: true }).click();
  await page.locator("#detail-continue").click();
  // Erst jetzt kommt die Änderungsvorschau mit Datum UND Tags. Ein Speichern für alles.
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toBeVisible();
  await expect(page.locator(".capture-content")).toContainText("Prüfdatum:");
  await expect(page.locator(".capture-content")).toContainText("opening_hours=24/7");
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Testserver: Angaben speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Prüfdatum und neue Angaben gespeichert");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ target: "node/123", expected_version: 9, details: { opening_hours: "24/7" } });
});

test("going back from the form that was opened in the list returns to the list, and the preview returns to the form", async ({
  page,
  context,
}) => {
  await openExistingAedPreview(page, context, { atList: true, nodes: [freshNode({ check_date: "2025-10-20" })] });
  await detailsFromList(page).click();
  await page.getByText("Jeder", { exact: true }).click();
  await page.locator("#detail-continue").click();
  await expect(page.locator(".capture-content")).toContainText("access=yes");
  // Aus der Vorschau zurück zu den Angaben: Die Eingaben sind noch da.
  await page.getByRole("button", { name: "Zurück zu den Angaben" }).click();
  await expect(page.locator("#detail-access-yes")).toBeChecked();
  // Aus dem Formular zurück: zur Trefferliste, nicht auf die Datumsseite.
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(page.getByRole("button", { name: "Als noch vorhanden bestätigen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toHaveCount(0);
  // Ein zweites Öffnen startet frisch: nichts von den alten Eingaben.
  await detailsFromList(page).click();
  await expect(page.locator("#detail-access-yes")).not.toBeChecked();
});

test("the quick confirmation in the list still leads to the date page in one tap", async ({ page, context }) => {
  await openExistingAedPreview(page, context, { atList: true, nodes: [freshNode({})] });
  await page.getByRole("button", { name: "Als noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Testserver: Prüfdatum speichern" })).toBeVisible();
});
