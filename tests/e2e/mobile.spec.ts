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
