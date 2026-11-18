import { expect } from "@playwright/test";

// Shared helpers used by the topic-based Playwright suites.
export const languageCodes = ["de", "en", "pl", "ja", "fr", "es"];

export const testDevelopmentOwnerHash = "a".repeat(64);

export function requireValue<T>(value: T | null | undefined, description: string): T {
  if (value === null || value === undefined) throw new Error(`${description} was not available`);
  return value;
}

export async function beginNearbySearch(page: import("@playwright/test").Page): Promise<void> {
  const sighting = page.locator('[data-action="confirm-sighting"]');
  if (await sighting.isVisible()) await sighting.click();
  const dateConfirmation = page.locator('[data-action="confirm-photo-date"]');
  if (await dateConfirmation.isVisible()) await dateConfirmation.click();
  // Photos without EXIF GPS require a separate, explicit choice before reading phone location.
  const usePhoneLocation = page.locator('[data-action="use-phone-location"]');
  if (await usePhoneLocation.isVisible()) await usePhoneLocation.click();
}

export function visionObservation(scene: string) {
  return {
    scene,
    device_count: scene === "device_visible" ? 1 : 0,
    readable_text: [],
    manufacturer: null,
    model: null,
    location_clues: [],
    image_issues: [],
  };
}

export async function enablePhotoCheck(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: false,
        developmentSession: false,
        photoCheckAvailable: true,
      },
    }),
  );
}

export async function publishNewVersion(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/version.json", (route) => route.fulfill({ json: { revision: "zzzz9999" } }));
}

export async function takeFreshCameraPhotoWithoutGps(page: import("@playwright/test").Page, ageMs = 0): Promise<void> {
  // Erst warten, bis die App den Aufnahmeknopf gezeichnet hat; sonst gibt es unter Last noch kein Eingabefeld.
  await page.locator("#camera-input").waitFor({ state: "attached" });
  await page.evaluate((age) => {
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#176b4b"/></svg>',
      ],
      "kamera.svg",
      { type: "image/svg+xml", lastModified: Date.now() - age },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>("#camera-input");
    if (!input) throw new Error("The camera input should be rendered.");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, ageMs);
}

export async function setUpFailingFirstSearch(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  const requests = { count: 0 };
  await page.route("**/api/osm/candidates/search", async (route) => {
    requests.count += 1;
    if (requests.count === 1) {
      await route.fulfill({ status: 503, headers: { "Retry-After": "2" }, json: { error: "coverage_unavailable" } });
      return;
    }
    await route.fulfill({ json: { status: "complete", coverage_radius_meters: 200, candidates: [] } });
  });
  await page.clock.install({ time: new Date("2026-11-11T07:00:00Z") });
  return requests;
}

export type SoundCounters = { contexts: number; resumes: number; oscillators: number };

export async function installFakeAudio(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    const counters = { contexts: 0, resumes: 0, oscillators: 0 };
    (window as unknown as { __sound: SoundCounters }).__sound = counters;
    class FakeAudioContext {
      state = "running";
      currentTime = 0;
      destination = {};
      constructor() {
        counters.contexts += 1;
      }
      resume() {
        counters.resumes += 1;
        return Promise.resolve();
      }
      createOscillator() {
        counters.oscillators += 1;
        return {
          type: "sine",
          frequency: { value: 0 },
          connect() {
            /* nichts */
          },
          start() {
            /* nichts */
          },
          stop() {
            /* nichts */
          },
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime() {
              /* nichts */
            },
            exponentialRampToValueAtTime() {
              /* nichts */
            },
          },
          connect() {
            /* nichts */
          },
        };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  });
}

export async function readSound(page: import("@playwright/test").Page): Promise<SoundCounters> {
  return page.evaluate(() => (window as unknown as { __sound: SoundCounters }).__sound);
}

export async function openCheckDateSaveButton(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  onWrite: (route: import("@playwright/test").Route) => Promise<void>,
  tags: Record<string, string> = { emergency: "defibrillator", name: "Rathaus", check_date: "2025-10-20" },
  source?: "archive" | "development",
) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: true,
        developmentWriteAvailable: true,
        developmentWriteOwnerHash: testDevelopmentOwnerHash,
      },
    }),
  );
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({
      json: {
        status: "complete",
        coverage_radius_meters: 112,
        candidates: [
          {
            id: "node/123",
            osmType: "node",
            version: 7,
            coordinateQuality: "exact",
            ...(source ? { source } : {}),
            position: { latitude: 52.52001, longitude: 13.40501 },
            tags,
          },
        ],
      },
    }),
  );
  await page.route("**/api/osm/development/check-date", onWrite);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.locator('[data-action="confirm-sighting"]').click();
  await beginNearbySearch(page);
  await page.getByRole("button", { name: "Als noch vorhanden bestätigen" }).click();
  return page.getByRole("button", { name: "Testserver: Prüfdatum speichern" });
}

export type TestCandidate = { id: string; name: string; latitudeOffsetMeters: number; tags?: Record<string, string> };

export async function openCandidateList(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  candidates: TestCandidate[],
  options: { accuracy?: number; development?: boolean } = {},
): Promise<{ searchRequests: () => number }> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: options.accuracy ?? 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: options.development ?? false,
        developmentWriteAvailable: options.development ?? false,
        ...(options.development ? { developmentWriteOwnerHash: testDevelopmentOwnerHash } : {}),
      },
    }),
  );
  let searches = 0;
  await page.route("**/api/osm/candidates/search", (route) => {
    searches += 1;
    return route.fulfill({
      json: {
        status: "complete",
        coverage_radius_meters: 200,
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          osmType: "node",
          version: 3,
          coordinateQuality: "exact",
          position: { latitude: 52.52 + candidate.latitudeOffsetMeters * 0.000009, longitude: 13.405 },
          tags: candidate.tags ?? { emergency: "defibrillator", name: candidate.name, check_date: "2025-10-20" },
        })),
      },
    });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.locator('[data-action="confirm-sighting"]').click();
  await beginNearbySearch(page);
  return { searchRequests: () => searches };
}

export async function openNewAedDetailForm(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5ece3"/></svg>',
    }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: true,
        developmentWriteAvailable: true,
        developmentWriteOwnerHash: testDevelopmentOwnerHash,
      },
    }),
  );
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({ json: { status: "complete", coverage_radius_meters: 112, candidates: [] } }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);
  await page.getByRole("button", { name: "Hier fehlt ein AED – neu eintragen" }).click();
  await page.locator("#new-aed-position-confirmed").check();
  await page.getByRole("button", { name: "Neuen AED vorbereiten" }).click();
  await expect(page.getByRole("heading", { name: "Angaben zum AED" })).toBeVisible();
}

export type NodeAnswer = { status: number; body?: unknown };

export async function openExistingAedPreview(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  options: {
    nodes: NodeAnswer[];
    writeStatus?: number;
    writeBody?: unknown;
    corrections?: boolean;
    atList?: boolean;
    candidateSource?: "archive" | "development";
    writeAvailable?: boolean;
  },
) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  // Mit `corrections` meldet der Server-Ersatz zusätzlich, dass der Betreiber Korrekturen freigegeben hat.
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        loginAvailable: true,
        developmentLoginAvailable: true,
        developmentSession: true,
        developmentWriteAvailable: options.writeAvailable ?? true,
        developmentWriteOwnerHash: testDevelopmentOwnerHash,
        ...(options.corrections ? { developmentCorrectionsAvailable: true } : {}),
      },
    }),
  );
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({
      json: {
        status: "complete",
        coverage_radius_meters: 112,
        // Das Archiv kennt nur ältere, unvollständige Tags; der frische Stand kommt über die eigene Leseroute.
        candidates: [
          {
            id: "node/123",
            osmType: "node",
            coordinateQuality: "exact",
            position: { latitude: 52.52001, longitude: 13.40501 },
            tags: { emergency: "defibrillator", name: "Rathaus" },
            ...(options.candidateSource ? { source: options.candidateSource } : {}),
          },
        ],
      },
    }),
  );
  const nodeRequests: string[] = [];
  let answerIndex = 0;
  await page.route("**/api/osm/development/node**", async (route) => {
    nodeRequests.push(route.request().url());
    const answer = options.nodes[Math.min(answerIndex, options.nodes.length - 1)];
    answerIndex += 1;
    await route.fulfill({ status: answer.status, json: answer.body ?? {} });
  });
  const writes: Array<Record<string, unknown>> = [];
  await page.route("**/api/osm/development/check-date", async (route) => {
    writes.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: options.writeStatus ?? 200,
      json: options.writeBody ?? { status: "complete", version: 10 },
    });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.locator('[data-action="confirm-sighting"]').click();
  await beginNearbySearch(page);
  // Mit atList bleibt der Test in der Trefferliste (vor der Datumsseite).
  if (options.atList) {
    await expect(page.getByRole("button", { name: "Als noch vorhanden bestätigen" })).toBeVisible();
    return { nodeRequests, writes };
  }
  await page.getByRole("button", { name: "Als noch vorhanden bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toBeVisible();
  return { nodeRequests, writes };
}

export const freshNode = (tags: Record<string, string>, version = 9): NodeAnswer => ({
  status: 200,
  body: { status: "ok", id: "node/123", version, tags },
});

export const knownNode = {
  access: "private",
  opening_hours: "24/7",
  indoor: "yes",
  level: "1",
  operator: "Stadtwerke",
  check_date: "2025-10-20",
};

export const correctButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Angaben ergänzen oder korrigieren", exact: true });

export const detailsFromList = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^Angaben ansehen und (ergänzen|ändern)$/u });

/**
 * Schließt das Speicher-Fenster (src/ui/saveDialog.ts) mit „Fertig“ oder „Schließen“.
 * Das Fenster sperrt die Seite dahinter, bis die Person es schließt. Tests, die danach weiterklicken, rufen das auf.
 */
export async function closeSaveDialog(page: import("@playwright/test").Page): Promise<void> {
  const dialog = page.locator("#save-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^(Fertig|Schließen)$/u }).click();
  await expect(dialog).toHaveCount(0);
}
