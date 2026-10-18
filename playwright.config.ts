import { defineConfig, devices } from "@playwright/test";

// Local developers can point Playwright at their installed Chrome; CI uses Playwright's browser build.
const executablePath = process.env.AEDJAEGER_CHROME_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://127.0.0.1:4173",
    locale: "de-DE",
    serviceWorkers: "allow",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
