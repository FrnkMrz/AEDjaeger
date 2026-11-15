import { expect, test } from "@playwright/test";
import { languageCodes, beginNearbySearch, requireValue } from "./support";

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

test("the OSM account gate is shown before app features and is localized in all six languages", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
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
    const createAccount = page.getByRole("link", {
      name: [
        "OpenStreetMap-Konto erstellen",
        "Create an OpenStreetMap account",
        "Utwórz konto OpenStreetMap",
        "OpenStreetMapアカウントを作成",
        "Créer un compte OpenStreetMap",
        "Crear una cuenta de OpenStreetMap",
      ][index],
    });
    await expect(createAccount).toHaveAttribute("href", "https://www.openstreetmap.org/user/new");
    await expect(page.locator("#camera-input, #file-input")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      language === "de" ? "OpenStreetMap-Konto" : "OpenStreetMap",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `horizontal page overflow in ${language}`,
    ).toBeLessThanOrEqual(320);
  }
});

test("an expired OSM session does not offer a search retry that cannot work", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({ status: 401, json: { error: "authentication_required" } }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);

  await expect(page.getByRole("heading", { name: "AEDjaeger braucht dein OpenStreetMap-Konto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Standort und AEDs erneut suchen" })).toHaveCount(0);
  await expect(page.locator("#camera-input, #file-input")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("an expired server session is shown as signed out after a 401", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  await page.route("**/api/osm/candidates/search", (route) =>
    route.fulfill({ status: 401, json: { error: "authentication_required" } }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);

  await expect(page.getByRole("heading", { name: "AEDjaeger braucht dein OpenStreetMap-Konto" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AEDjaeger braucht dein OpenStreetMap-Konto" })).toBeFocused();
  await expect(page.locator("#camera-input, #file-input")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("the OSM login link stays hidden when the Worker has no OAuth setup", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: false,
        loginAvailable: false,
        developmentLoginAvailable: false,
        developmentSession: false,
      },
    }),
  );
  await page.goto("/");

  await expect(page.locator(".login-card")).toContainText("OpenStreetMap-Anmeldung ist noch nicht eingerichtet");
  await expect(page.getByRole("link", { name: "OpenStreetMap-Konto erstellen" })).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/user/new",
  );
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toHaveCount(0);
});

test("an authenticated user can end the OSM session without exposing profile data", async ({ page }) => {
  let authenticated = true;
  page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  page.route("**/api/auth/logout", async (route) => {
    expect(route.request().method()).toBe("POST");
    authenticated = false;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");

  // Angemeldet: kein Textblock auf dem Hauptbildschirm. Die Lampe unten zeigt „verbunden“, „Abmelden“ liegt im Info-Dialog.
  await expect(page.locator(".account-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Abmelden" })).toBeHidden();
  await page.locator("#open-info").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Mit OpenStreetMap verbunden");
  await expect(dialog).toContainText("Änderungen am echten OpenStreetMap sind nicht freigegeben");
  await dialog.getByRole("button", { name: "Abmelden" }).click();
  const signIn = page.getByRole("link", { name: "Mit OpenStreetMap anmelden" });
  await expect(signIn).toBeFocused();
});

test("a failed logout keeps a retry action until the OSM session has ended", async ({ page }) => {
  let authenticated = true;
  let logoutAttempts = 0;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  await page.route("**/api/auth/logout", async (route) => {
    logoutAttempts += 1;
    if (logoutAttempts === 1) {
      await route.fulfill({ status: 503, json: { error: "temporarily_unavailable" } });
      return;
    }
    authenticated = false;
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await page.locator("#open-info").click();
  await page.getByRole("dialog").getByRole("button", { name: "Abmelden" }).click();
  await expect(page.locator(".login-card")).toContainText("Abmeldung fehlgeschlagen. Bitte prüfe deine Verbindung.");
  const retryLogout = page.locator("#osm-sign-out");
  await expect(retryLogout).toBeVisible();
  await retryLogout.click();
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
  expect(logoutAttempts).toBe(2);
});

test("a failed OAuth return shows a localized retry message and removes the callback marker", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
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
    await expect(page.locator(".login-card")).toContainText(errors[index]);
    await expect(
      page.getByRole("link", {
        name: [
          "Mit OpenStreetMap anmelden",
          "Sign in with OpenStreetMap",
          "Zaloguj się przez OpenStreetMap",
          "OpenStreetMapでログイン",
          "Se connecter avec OpenStreetMap",
          "Iniciar sesión con OpenStreetMap",
        ][index],
      }),
    ).toHaveAttribute("href", "/api/auth/osm/start");
  }
  await expect(page).not.toHaveURL(/login=error/u);
});

test("the OSM test server login is still offered only when its OAuth setup is available", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Mit OSM-Testserver anmelden" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("the app stays locked while the OSM session check is pending", async ({ page }) => {
  let releaseSessionCheck: (() => void) | undefined;
  await page.route(
    "**/api/auth/session",
    (route) =>
      new Promise<void>((resolve) => {
        releaseSessionCheck = () => {
          void route
            .fulfill({
              json: {
                authenticated: false,
                loginAvailable: true,
                developmentLoginAvailable: false,
                developmentSession: false,
              },
            })
            .then(resolve);
        };
      }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("OpenStreetMap-Anmeldung wird geprüft");
  await expect(page.locator("#camera-input, #file-input")).toHaveCount(0);
  releaseSessionCheck?.();
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("a session status connection error can be retried while the app remains locked", async ({ page }) => {
  let checks = 0;
  await page.route("**/api/auth/session", (route) => {
    checks += 1;
    return checks === 1
      ? route.fulfill({ status: 503, json: { error: "session_unavailable" } })
      : route.fulfill({
          json: {
            authenticated: false,
            loginAvailable: true,
            developmentLoginAvailable: false,
            developmentSession: false,
          },
        });
  });
  await page.goto("/");
  await expect(page.locator(".login-card")).toContainText("Anmeldung ist gerade nicht erreichbar");
  await expect(page.locator("#camera-input, #file-input")).toHaveCount(0);

  await page.getByRole("button", { name: "Erneut prüfen" }).click();

  await expect(page.getByRole("heading", { name: "AEDjaeger braucht dein OpenStreetMap-Konto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Erneut prüfen" })).toHaveCount(0);
  await expect(page.locator("#camera-input, #file-input")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Mit OpenStreetMap anmelden" })).toBeVisible();
});

test("a repeated session status error focuses the retry action", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 503, json: { error: "session_unavailable" } }),
  );
  await page.goto("/");
  const retry = page.getByRole("button", { name: "Erneut prüfen" });
  await retry.click();

  await expect(retry).toBeFocused();
});

test("a green lamp shows the connection, and it is red when signed out", async ({ page }) => {
  await page.goto("/");
  const lamp = page.locator(".connection-lamp");
  await expect(lamp).toHaveClass(/connection-lamp-on/);
  await expect(lamp).toHaveText("✓");
  // Farbe allein genügt nicht: Die Lampe trägt den Status auch als Text für Screenreader.
  await expect(page.locator("#connection-lamp")).toHaveAttribute("aria-label", "Mit OpenStreetMap verbunden");
  expect(await lamp.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(31, 157, 85)");
  // Kein Textblock „Mit OSM-Testserver verbunden“ mehr auf dem Hauptbildschirm.
  await expect(page.locator("main")).not.toContainText("verbunden");

  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  await page.reload();
  await expect(page.locator(".connection-lamp")).toHaveClass(/connection-lamp-off/);
  await expect(page.locator(".connection-lamp")).toHaveText("−");
  await expect(page.locator("#connection-lamp")).toHaveAttribute("aria-label", "Nicht verbunden");
  expect(await page.locator(".connection-lamp").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    "rgb(214, 69, 69)",
  );
});

test("the lamp label and the logout section exist in all six languages", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: true, developmentSession: true },
    }),
  );
  await page.goto("/");
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    const label = await page.locator("#connection-lamp").getAttribute("aria-label");
    expect(label, `Lampe in ${code}`).toBeTruthy();
    await page.locator("#open-info").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#osm-sign-out")).toBeVisible();
    // Lampe und Abschnitt im Info-Dialog nennen denselben Status in derselben Sprache.
    expect(label).toBe(
      requireValue(await dialog.locator(".account-section h3").textContent(), "The account status heading").trim(),
    );
    await page.keyboard.press("Escape");
  }
});

test("the connection lamp sits in the header next to the name, on every screen", async ({ page }) => {
  await page.goto("/");
  const lamp = page.locator("header .connection-lamp");
  await expect(lamp).toBeVisible();
  // Ganz oben und neben dem Namen, nicht in der Fußzeile.
  const box = await lamp.boundingBox();
  expect(requireValue(box, "The header status lamp bounding box").y).toBeLessThan(80);
  await expect(page.locator("footer .connection-lamp")).toHaveCount(0);
  const brandBox = await page.locator(".brand").boundingBox();
  const headerBox = requireValue(box, "The header status lamp bounding box");
  const brandBoundingBox = requireValue(brandBox, "The brand bounding box");
  expect(headerBox.x).toBeGreaterThan(brandBoundingBox.x + brandBoundingBox.width - 1);

  // Auch auf einer längeren Seite bleibt sie an derselben Stelle der Kopfzeile.
  await page.locator("#file-input").setInputFiles("tests/fixtures/photo-with-gps.jpg");
  await expect(page.locator('[data-action="confirm-sighting"]')).toBeVisible();
  await expect(lamp).toBeVisible();
  expect(requireValue(await lamp.boundingBox(), "The header status lamp bounding box").y).toBeLessThan(80);
});

test("the header with the lamp fits a narrow phone screen in all six languages", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  for (const code of languageCodes) {
    await page.locator("#language").selectOption(code);
    const box = await page.locator("header .connection-lamp").boundingBox();
    const lampBox = requireValue(box, `Die Lampe in ${code}`);
    expect(lampBox.x + lampBox.width, `Lampe in ${code} im Bild`).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `Überlauf in ${code}`).toBeLessThanOrEqual(
      320,
    );
    // Die Lampe überlappt weder den Namen noch die Info-Schaltfläche.
    const infoBox = await page.locator("#open-info").boundingBox();
    // Mindestens 12 px Luft: Die Schrift eines echten Geräts kann breiter sein als die der Testumgebung.
    const infoBoundingBox = requireValue(infoBox, `Die Info-Schaltfläche in ${code}`);
    expect(lampBox.x + lampBox.width + 12, `Abstand Lampe zu Info in ${code}`).toBeLessThanOrEqual(infoBoundingBox.x);
  }
});

test("the header has no check mark in front of the name, only the lamp shows the status", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header .brand-mark")).toHaveCount(0);
  await expect(page.locator("header .brand svg")).toHaveCount(0);
  await expect(page.locator("header .connection-lamp")).toBeVisible();
});

test("tapping the green lamp opens the sign-out section, and signing out only happens on the sign-out button", async ({
  page,
}) => {
  let signOutRequests = 0;
  await page.route("**/api/auth/logout", (route) => {
    signOutRequests += 1;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(page.locator(".connection-lamp-on")).toBeVisible();
  await page.locator("#connection-lamp").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#osm-sign-out")).toBeVisible();
  await expect(dialog.locator("#osm-sign-out")).toBeFocused();
  // Das Tippen auf die Lampe meldet noch nicht ab.
  expect(signOutRequests).toBe(0);
  await expect(page.locator(".connection-lamp-on")).toBeVisible();
});

test("tapping the red lamp never signs in by itself, only the sign-in button does", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: true, developmentSession: false },
    }),
  );
  // Jede Anmeldeanfrage wird gezählt und mit einer Dummy-Seite beantwortet; nichts geht zu OpenStreetMap.
  const signInRequests: string[] = [];
  const countSignIn = (route: import("@playwright/test").Route) => {
    signInRequests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: "text/html", body: "<p>OSM</p>" });
  };
  await page.route("**/api/auth/osm/start", countSignIn);
  await page.route("**/api/auth/osm/development/start", countSignIn);
  await page.goto("/");
  await expect(page.locator(".connection-lamp-off")).toBeVisible();
  await page.locator("#connection-lamp").click();
  // Die Lampe zeigt die Anmeldeseite: Der Anmelde-Knopf hat den Fokus, es gibt keine Anmeldeanfrage, die Seite bleibt.
  await expect(page.locator("#osm-sign-in")).toBeFocused();
  await page.waitForTimeout(300);
  expect(signInRequests).toEqual([]);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.locator(".connection-lamp-off")).toBeVisible();
  // Erst das ausdrückliche Tippen auf den Knopf startet die Anmeldung.
  await page.locator("#osm-sign-in").click();
  await expect.poll(() => signInRequests).toEqual(["/api/auth/osm/start"]);
});

test("tapping the red lamp with only the test-server login focuses that button and does not sign in", async ({
  page,
}) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: false, loginAvailable: false, developmentLoginAvailable: true, developmentSession: false },
    }),
  );
  let signInStarted = false;
  await page.route("**/api/auth/osm/development/start", (route) => {
    signInStarted = true;
    return route.fulfill({ status: 200, contentType: "text/html", body: "<p>OSM</p>" });
  });
  await page.goto("/");
  await page.locator("#connection-lamp").click();
  await expect(page.locator("#osm-dev-sign-in")).toBeFocused();
  await page.waitForTimeout(300);
  expect(signInStarted).toBe(false);
});

test("tapping the red lamp without a sign-in button keeps the person on the login page", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 500, json: {} }));
  await page.goto("/");
  await expect(page.locator(".connection-lamp-off")).toBeVisible();
  await page.locator("#connection-lamp").click();
  // Der Fokus liegt auf der Anmeldeseite (Überschrift oder Wiederholen-Knopf).
  await expect(page.locator("#login-title:focus, #osm-session-retry:focus")).toHaveCount(1);
  expect(new URL(page.url()).pathname).toBe("/");
});

test("the lamp tap area is large enough for a finger but does not push the header apart", async ({ page }) => {
  await page.goto("/");
  const button = await page.locator("#connection-lamp").boundingBox();
  const dot = await page.locator("header .connection-lamp").boundingBox();
  const buttonBox = requireValue(button, "The connection lamp button");
  const dotBox = requireValue(dot, "The visible connection lamp");
  expect(buttonBox.width).toBeGreaterThanOrEqual(44);
  expect(buttonBox.height).toBeGreaterThanOrEqual(44);
  // Die Tippfläche liegt mittig um den sichtbaren Punkt.
  expect(Math.abs(buttonBox.x + buttonBox.width / 2 - (dotBox.x + dotBox.width / 2))).toBeLessThan(1);
});

test("signing out really signs out: if the server still reports a session, the app shows an error instead of staying signed in", async ({
  page,
}) => {
  // Der Server antwortet auf „Abmelden“ mit 204, meldet aber weiter „angemeldet“ (zum Beispiel ein Cookie, das nicht gelöscht wurde).
  let logoutRequests = 0;
  await page.route("**/api/auth/logout", (route) => {
    logoutRequests += 1;
    return route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await expect(page.locator(".connection-lamp-on")).toBeVisible();
  await page.locator("#connection-lamp").click();
  await page.getByRole("dialog").locator("#osm-sign-out").click();
  // Die Abmelde-Anfrage kommt asynchron an; darauf warten statt sofort zu zählen.
  await expect.poll(() => logoutRequests).toBe(1);
  // Keine stille Rückkehr in den angemeldeten Zustand: Fehlermeldung, rote Lampe, Wiederholen möglich.
  await expect(page.locator(".connection-lamp-off")).toBeVisible();
  await expect(page.locator(".login-status")).toContainText("Abmeldung fehlgeschlagen");
  await expect(page.locator("#osm-sign-out")).toBeVisible();
  await expect(page.locator("#camera-input")).toHaveCount(0);
});

test("signing out ends the session: after the logout request the app shows the login page and never signs in by itself", async ({
  page,
}) => {
  let signedIn = true;
  let signInRequests = 0;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        authenticated: signedIn,
        loginAvailable: true,
        developmentLoginAvailable: false,
        developmentSession: false,
      },
    }),
  );
  await page.route("**/api/auth/logout", (route) => {
    signedIn = false;
    return route.fulfill({ status: 204 });
  });
  await page.route("**/api/auth/osm/start", (route) => {
    signInRequests += 1;
    return route.fulfill({ status: 200, contentType: "text/html", body: "<p>OSM</p>" });
  });
  await page.goto("/");
  await expect(page.locator(".connection-lamp-on")).toBeVisible();
  await page.locator("#connection-lamp").click();
  await page.getByRole("dialog").locator("#osm-sign-out").click();
  await expect(page.locator(".connection-lamp-off")).toBeVisible();
  await expect(page.locator("#osm-sign-in")).toBeVisible();
  await expect(page.locator("#camera-input")).toHaveCount(0);
  // Auch nach einem Neuladen und nach dem Tippen auf die rote Lampe bleibt es abgemeldet, ohne Anmeldeanfrage.
  await page.reload();
  await page.locator("#connection-lamp").click();
  await page.waitForTimeout(300);
  await expect(page.locator(".connection-lamp-off")).toBeVisible();
  expect(signInRequests).toBe(0);
});

test("the build version is also visible in the info dialog when signed out", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: false, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
    }),
  );
  await page.goto("/");
  await page.locator("#open-info").click();
  await expect(page.locator("#build-version")).toContainText("Version ");
});
