import { defineConfig, devices } from "@playwright/test";

// Local developers can point Playwright at their installed Chrome; CI uses Playwright's browser build.
const executablePath = process.env.AEDJAEGER_CHROME_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: "list",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Pixel 7"],
        baseURL: "http://127.0.0.1:4173",
        locale: "de-DE",
        serviceWorkers: "allow",
        launchOptions: executablePath ? { executablePath } : undefined,
      },
    },
    // WebKit blocks service workers in E2E so route mocks reliably cover every API response.
    // The service-worker lifecycle has dedicated Chromium tests below.
    {
      name: "webkit",
      use: {
        ...devices["iPhone 14"],
        baseURL: "http://127.0.0.1:4173",
        locale: "de-DE",
        serviceWorkers: "block",
      },
    },
  ],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
