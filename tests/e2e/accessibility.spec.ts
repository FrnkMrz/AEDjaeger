import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

async function expectAccessible(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations,
    `${state}: ${results.violations.map((violation) => `${violation.id}: ${violation.help}`).join("; ")}`,
  ).toEqual([]);
}

test("axe finds no accessibility violations across the photo, map, candidate and preview states", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/osm/candidates/search", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
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
            tags: { emergency: "defibrillator", name: "Rathaus", check_date: "2025-01-01" },
          },
        ],
      },
    });
  });

  await page.goto("/");
  await expectAccessible(page, "Startbildschirm");
  await page.locator("#open-info").click();
  await expectAccessible(page, "Info-Dialog");
  await page.keyboard.press("Escape");

  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await expectAccessible(page, "Foto mit Sichtbestätigung");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirmation = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirmation.isVisible()) {
    await expectAccessible(page, "Prüfdatum bestätigen");
    await dateConfirmation.click();
  }
  const usePhoneLocation = page.locator('[data-action="use-phone-location"]');
  if (await usePhoneLocation.isVisible()) {
    await expectAccessible(page, "Standort auswählen");
    await usePhoneLocation.click();
  }

  await expect(page.locator(".loading-row")).toBeVisible();
  await expectAccessible(page, "Suche läuft");
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  await page.waitForTimeout(500);
  await expectAccessible(page, "Suchergebnis mit Karte");
  await page.getByRole("button", { name: "Als noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toBeVisible();
  await expectAccessible(page, "Änderungsvorschau");
});

test("axe finds no accessibility violations in a failed search state", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({ status: 503, json: { error: "search_unavailable" } }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirmation = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirmation.isVisible()) await dateConfirmation.click();
  const usePhoneLocation = page.locator('[data-action="use-phone-location"]');
  if (await usePhoneLocation.isVisible()) await usePhoneLocation.click();
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  await expectAccessible(page, "Fehler nach der Umgebungssuche");
});

test("axe finds no accessibility violations on the map-selection screen", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirmation = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirmation.isVisible()) await dateConfirmation.click();
  await page.getByRole("button", { name: "Standort auf Karte wählen" }).click();
  await expect(page.locator("#search-location-map")).toBeVisible();
  await expectAccessible(page, "Kartenstandort wählen");
});

test("text remains readable without horizontal overflow at 200 percent root text size on a 320 px screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page.locator("#open-info")).toBeVisible();
});

test("the account gate and key controls have accessible names and 44 px touch targets", async ({ page }) => {
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
  await expectAccessible(page, "OSM-Anmeldeseite");
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
  await page.reload();

  const infoSize = await page.locator("#open-info").evaluate((element) => element.getBoundingClientRect().height);
  expect(infoSize).toBeGreaterThanOrEqual(44);
  await page.locator("#open-info").click();
  const closeSize = await page.locator(".dialog-close").evaluate((element) => {
    const { width, height } = element.getBoundingClientRect();
    return { width, height };
  });
  expect(closeSize.width).toBeGreaterThanOrEqual(44);
  expect(closeSize.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  const dateConfirmation = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirmation.isVisible()) await dateConfirmation.click();
  await page.getByRole("button", { name: "Standort auf Karte wählen" }).click();
  const mapZoomSize = await page
    .locator(".position-map-controls button")
    .first()
    .evaluate((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    });
  expect(mapZoomSize.width).toBeGreaterThanOrEqual(44);
  expect(mapZoomSize.height).toBeGreaterThanOrEqual(44);
});
