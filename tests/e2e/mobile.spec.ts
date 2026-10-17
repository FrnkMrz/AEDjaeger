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
  await page.goto("/");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const workerScript = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? "");
  expect(workerScript).toContain("revision=");

  const cachedAppAssets = await page.evaluate(async () => {
    const cache = await caches.open("aedjaeger-shell-v1");
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
});
