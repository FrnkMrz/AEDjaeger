import { expect, test } from "@playwright/test";

const languageCodes = ["de", "en", "pl", "ja", "fr", "es"];

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
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true } }));
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
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true } }));
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
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Foto an OpenAI senden" }).click();
  await expect(page.getByRole("heading", { name: "KI-Bildbeobachtung" })).toBeVisible();
  await expect(page.locator(".result-message")).toContainText("AED-Gerät sichtbar");
  await expect(page.locator(".result-message")).toContainText("<script>ignore rules</script>");
  await expect(page.locator(".result-message script")).toHaveCount(0);
  await expect(page.locator("[data-action='confirm']")).toHaveCount(0);
  expect(requests).toBe(1);
});

test("the live photo endpoint is not called until the user is signed in and chooses AI analysis", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true } }));
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

test("the AI result remains readable on a narrow phone in all six languages", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: true, loginAvailable: true } }));
  await page.route("**/api/vision/analyze", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: {
      request_id: payload.request_id, model: "gpt-6-luna",
      observation: { scene: "unclear", device_count: 0, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [] },
    } });
  });
  await page.goto("/");

  const languages = [
    { code: "de", send: "Foto an OpenAI senden", result: "KI-Bildbeobachtung", discard: "Foto verwerfen" },
    { code: "en", send: "Send photo to OpenAI", result: "AI image observation", discard: "Discard photo" },
    { code: "pl", send: "Wyślij zdjęcie do OpenAI", result: "Obserwacja AI", discard: "Odrzuć zdjęcie" },
    { code: "ja", send: "写真をOpenAIに送信", result: "AIによる画像の観察", discard: "写真を破棄" },
    { code: "fr", send: "Envoyer la photo à OpenAI", result: "Observation de l’image par l’IA", discard: "Supprimer la photo" },
    { code: "es", send: "Enviar foto a OpenAI", result: "Observación de imagen de IA", discard: "Descartar foto" },
  ];
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  for (const language of languages) {
    await page.locator("#language").selectOption(language.code);
    await page.getByRole("button", { name: language.send }).click();
    await expect(page.getByRole("heading", { name: language.result })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `horizontal page overflow in ${language.code}`).toBeLessThanOrEqual(320);
    await page.getByRole("button", { name: language.discard }).click();
    if (language.code !== "es") await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  }
});

test("the OSM login link stays hidden when the Worker has no OAuth setup", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: false } }));
  await page.goto("/");

  await expect(page.locator(".account-panel")).toContainText("OpenStreetMap-Anmeldung ist noch nicht eingerichtet");
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toHaveCount(0);
});

test("an authenticated user can end the OSM session without exposing profile data", async ({ page }) => {
  let authenticated = true;
  page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated, loginAvailable: true } }));
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
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true } }));
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
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true } }));
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#scenario").selectOption("upload-unclear");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "Foto und Umgebung prüfen" }).click();
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
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true } }));
  await page.goto("/");
  await page.getByText("Vorschau testen", { exact: true }).click();
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");

  await expect(page.locator(".account-panel")).toContainText("Schließe den aktuellen Fotoablauf ab");
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toHaveCount(0);
  await page.getByRole("button", { name: "Foto und Umgebung prüfen" }).click();
  await expect(page.getByRole("heading", { name: "AED gefunden" })).toBeVisible();
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
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { authenticated: false, loginAvailable: true } }));
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
      : route.fulfill({ json: { authenticated: false, loginAvailable: true } });
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
  await page.getByRole("button", { name: "Foto und Umgebung prüfen" }).click();

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
  await page.getByRole("button", { name: "Foto und Umgebung prüfen" }).click();
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
  await page.getByRole("button", { name: "Foto und Umgebung prüfen" }).click();
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
  await page.getByRole("button", { name: "Foto und Umgebung prüfen" }).click();
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
  await expect(page.getByRole("button", { name: "Foto und Umgebung prüfen" })).toHaveCount(0);
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
