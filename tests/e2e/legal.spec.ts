import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Impressum und Datenschutzerklärung (28.11.2026): erreichbar aus dem Info-Dialog, statisch, ohne fremde Server.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
});

test("the info dialog links to the legal notice and the privacy policy, in German and for other languages in English", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#open-info").click();
  const dialog = page.locator("#info-dialog");
  await expect(dialog.getByRole("link", { name: "Impressum" })).toHaveAttribute("href", "/impressum");
  await expect(dialog.getByRole("link", { name: "Datenschutz" })).toHaveAttribute("href", "/datenschutz");
  await page.keyboard.press("Escape");

  // In jeder anderen Sprache führen die Links direkt zur englischen Fassung.
  await page.locator("#language").selectOption("pl");
  await page.locator("#open-info").click();
  await expect(dialog.getByRole("link", { name: "Nota prawna" })).toHaveAttribute("href", "/impressum#en");
  await expect(dialog.getByRole("link", { name: "Prywatność" })).toHaveAttribute("href", "/datenschutz#en");
});

for (const path of ["/impressum", "/datenschutz"]) {
  test(`${path} loads without scripts or foreign hosts, keeps the security policy and is accessible`, async ({
    page,
  }) => {
    const foreignRequests: string[] = [];
    const policyViolations: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== new URL(page.url() === "about:blank" ? request.url() : page.url()).origin) {
        foreignRequests.push(url.origin);
      }
    });
    page.on("console", (message) => {
      if (message.text().includes("Content Security Policy")) policyViolations.push(message.text());
    });

    await page.setViewportSize({ width: 320, height: 720 });
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator("#en h1")).toBeVisible();
    await expect(page.getByText("info@openfiremap.org").first()).toBeVisible();
    // Keine waagerechte Scrollleiste auf schmalen Handys.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    expect(foreignRequests).toEqual([]);
    expect(policyViolations).toEqual([]);
  });
}
