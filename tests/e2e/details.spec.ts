import { expect, test } from "@playwright/test";
import {
  languageCodes,
  beginNearbySearch,
  openNewAedDetailForm,
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

test("the search result hides technical snapshot details and raw OSM identifiers", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 52.52, longitude: 13.405, accuracy: 12 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { authenticated: true, loginAvailable: true, developmentLoginAvailable: false, developmentSession: false },
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
            coordinateQuality: "exact",
            position: { latitude: 52.52001, longitude: 13.40501 },
            tags: { emergency: "defibrillator", name: "Rathaus" },
          },
        ],
        snapshot_id: "aed-0123456789abcdef0123",
        data_until: "2026-11-08T12:00:00.000Z",
      },
    }),
  );
  await page.goto("/");
  await page.locator("#file-input").setInputFiles("tests/fixtures/aed-test-image.svg");
  await page.getByRole("button", { name: "AED oder Gehäuse gesehen – weiter" }).click();
  await beginNearbySearch(page);
  // Technische Angaben (Datenstand, Snapshot-Kennung, OSM-Kennung) gehören nicht auf den Bildschirm.
  await expect(page.getByRole("heading", { name: "AED-Suche in der Umgebung" })).toBeVisible();
  await expect(page.locator(".capture-content")).not.toContainText("Datenstand");
  await expect(page.locator(".capture-content")).not.toContainText("aed-0123456789abcdef0123");
  await expect(page.locator(".capture-content")).not.toContainText("node/123");
  // Auch keine Verweise nach OpenStreetMap: Der Ablauf bleibt in der App.
  await expect(page.locator(".candidate-list a")).toHaveCount(0);
});

test("the detail form turns a few taps into OSM tags and keeps its entries when going back", async ({
  page,
  context,
}) => {
  await openNewAedDetailForm(page, context);
  let createRequest: Record<string, unknown> | undefined;
  await page.route("**/api/osm/development/create-node", async (route) => {
    createRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { status: "complete", node_id: "456", version: 1 } });
  });
  const continueButton = page.locator("#detail-continue");

  // Ohne Eingabe: Der Weg geht trotzdem weiter, der Knopf nennt es ehrlich.
  await expect(continueButton).toHaveText("Weiter ohne Angaben");
  // „Weiß ich nicht“ ist überall vorausgewählt und schreibt kein Tag.
  await expect(page.locator("#detail-access-unknown")).toBeChecked();
  await expect(page.locator("#detail-hoursMode-unknown")).toBeChecked();
  await expect(page.locator("#detail-indoor-unknown")).toBeChecked();
  // Das Zeiten-Feld und die Ebene erscheinen erst, wenn sie gebraucht werden.
  await expect(page.locator("#detail-hours-text")).toHaveCount(0);
  await expect(page.locator("#detail-level-value")).toHaveCount(0);

  // Standort: Tippen darf den Fokus nicht verlieren (die Seite wird dabei nicht neu gezeichnet).
  await page.locator("#detail-location").click();
  await page.keyboard.type("Foyer");
  await expect(page.locator("#detail-location")).toBeFocused();
  await expect(page.locator("#detail-location")).toHaveValue("Foyer");
  await page.getByRole("button", { name: "Empfang", exact: true }).click();
  await expect(page.locator("#detail-location")).toHaveValue("Foyer, Empfang");

  await page.getByText("Nur Kunden", { exact: true }).click();
  await page.getByText("Zu bestimmten Zeiten", { exact: true }).click();
  await page.locator("#detail-hours-text").fill("Mo-Fr 08:00-18:00");
  await page.getByText("Drinnen", { exact: true }).click();
  // Der erste Tipp auf + setzt 0 (Erdgeschoss), der zweite 1.
  await page.getByRole("button", { name: "Eine Ebene höher" }).click();
  await expect(page.locator("#detail-level-value")).toHaveText("0");
  await page.getByRole("button", { name: "Eine Ebene höher" }).click();
  await expect(page.locator("#detail-level-value")).toHaveText("1");
  await expect(continueButton).toHaveText("Weiter · 5 Angaben");

  // „Mehr Angaben“: eine ungültige Telefonnummer sperrt den Knopf und meldet es am Feld, die korrigierte gibt ihn frei.
  await page.getByText("Mehr Angaben", { exact: true }).click();
  await page.locator("#detail-phone").fill("anrufen!");
  await expect(continueButton).toBeDisabled();
  await expect(page.locator('[data-detail-error="more"]')).toBeVisible();
  await page.locator("#detail-phone").fill("+49 911 123456");
  await expect(continueButton).toBeEnabled();
  await expect(page.locator('[data-detail-error="more"]')).toBeHidden();
  await expect(continueButton).toHaveText("Weiter · 6 Angaben");

  await continueButton.click();
  await expect(page.getByRole("heading", { name: "Vorschau für neuen AED" })).toBeVisible();
  const preview = page.locator(".capture-content");
  for (const tag of [
    "emergency=defibrillator",
    "defibrillator:location=Foyer, Empfang",
    "access=customers",
    "opening_hours=Mo-Fr 08:00-18:00",
    "indoor=yes",
    "level=1",
    "phone=+49 911 123456",
  ]) {
    await expect(preview).toContainText(tag);
  }

  // Zurück zu den Angaben: Nichts ist verloren, „Mehr Angaben“ bleibt offen.
  await page.getByRole("button", { name: "Zurück zu den Angaben" }).click();
  await expect(page.locator("#detail-location")).toHaveValue("Foyer, Empfang");
  await expect(page.locator("#detail-access-customers")).toBeChecked();
  await expect(page.locator("#detail-hours-text")).toHaveValue("Mo-Fr 08:00-18:00");
  await expect(page.locator("#detail-level-value")).toHaveText("1");
  await expect(page.locator("#detail-phone")).toHaveValue("+49 911 123456");
  await expect(continueButton).toHaveText("Weiter · 6 Angaben");

  // Zweite Bestätigung und Speichern: Der Server bekommt genau diese Detailtags, nichts sonst.
  await continueButton.click();
  await page.locator("#new-aed-absence-confirmed").check();
  await page.getByRole("button", { name: "Testserver: AED eintragen" }).click();
  await expect.poll(() => createRequest).toBeDefined();
  expect(createRequest?.details).toEqual({
    "defibrillator:location": "Foyer, Empfang",
    access: "customers",
    opening_hours: "Mo-Fr 08:00-18:00",
    indoor: "yes",
    level: "1",
    phone: "+49 911 123456",
  });
  expect(createRequest).not.toHaveProperty("location_description");
});

test("the detail form radio groups work with the keyboard and keep the focus", async ({ page, context }) => {
  await openNewAedDetailForm(page, context);
  await page.locator("#detail-access-unknown").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#detail-access-private")).toBeChecked();
  await expect(page.locator("#detail-access-private")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#detail-access-customers")).toBeChecked();
  await expect(page.locator("#detail-access-customers")).toBeFocused();
  // Jede Gruppe hat einen sichtbaren Namen für Screenreader.
  await expect(page.getByRole("group", { name: "Wer kommt ran?" })).toBeVisible();
});

test("the detail form fits a 320 px phone in all six languages with the main button always reachable", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openNewAedDetailForm(page, context);
  // Alle Folgefelder einblenden, damit das Formular so lang wie möglich ist.
  await page.getByText("Zu bestimmten Zeiten", { exact: true }).click();
  await page.getByText("Drinnen", { exact: true }).click();
  await page.getByText("Mehr Angaben", { exact: true }).click();

  for (const language of languageCodes) {
    await page.locator("#language").selectOption(language);
    await expect(page.locator("#detail-form")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `horizontal page overflow in ${language}`,
    ).toBeLessThanOrEqual(320);
    // Kein Bedienelement ragt rechts über den Bildschirm hinaus.
    const overflowing = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "#detail-form .chip, #detail-form .field, #detail-form .step-button, #detail-form summary, .detail-footer .button",
        ),
      ]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5)
        .map((element) => element.className),
    );
    expect(overflowing, `controls beyond the screen in ${language}`).toEqual([]);
    // Alle Tippflächen sind mindestens 44 px hoch.
    const tooSmall = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "#detail-form .chip, #detail-form .step-button, #detail-form summary, #detail-form .field, .detail-footer .button",
        ),
      ]
        .filter((element) => element.getBoundingClientRect().height < 44)
        .map((element) => element.textContent?.trim() ?? element.className),
    );
    expect(tooSmall, `touch targets below 44 px in ${language}`).toEqual([]);
    // Die feste Fußleiste: Der Hauptknopf liegt ohne Scrollen im sichtbaren Bereich, auch bei langem Formular.
    await page.evaluate(() => window.scrollTo(0, 0));
    const footerBox = await page.locator("#detail-continue").boundingBox();
    expect(footerBox, `main button visible in ${language}`).not.toBeNull();
    const buttonBox = requireValue(footerBox, `Der Hauptknopf in ${language}`);
    expect(buttonBox.y + buttonBox.height, `main button inside the viewport in ${language}`).toBeLessThanOrEqual(640);
  }
});

test("adding details to an existing AED locks what is already entered and sends only the additions", async ({
  page,
  context,
}) => {
  const { nodeRequests, writes } = await openExistingAedPreview(page, context, {
    nodes: [
      freshNode({
        access: "yes",
        indoor: "yes",
        "defibrillator:location": "Links neben dem Garagentor",
        check_date: "2025-10-20",
      }),
    ],
  });
  // Ohne Tipp auf „Ergänzen“ wird nichts gelesen.
  expect(nodeRequests).toEqual([]);
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await expect(page.getByRole("heading", { name: "Angaben ergänzen" })).toBeVisible();
  expect(nodeRequests).toHaveLength(1);
  expect(nodeRequests[0]).toContain("id=node%2F123");

  // Was schon in OSM steht, ist nur Text und lässt sich nicht ändern.
  await expect(page.locator("#detail-group-location")).toContainText("Schon eingetragen: Links neben dem Garagentor");
  await expect(page.locator("#detail-group-access")).toContainText("Schon eingetragen: Jeder");
  await expect(page.locator("#detail-group-indoor")).toContainText("Schon eingetragen: Drinnen");
  await expect(page.locator("#detail-location")).toHaveCount(0);
  await expect(page.locator("#detail-access-yes")).toHaveCount(0);
  await expect(page.locator("#detail-indoor-yes")).toHaveCount(0);
  // Fehlendes lässt sich ausfüllen: Zeiten, und die Ebene, weil „drinnen“ schon in OSM steht.
  await expect(page.locator("#detail-hoursMode-always")).toBeAttached();
  await expect(page.locator("#detail-level-value")).toHaveText("–");
  await expect(page.locator("#detail-continue")).toHaveText("Weiter ohne Angaben");

  await page.getByText("Rund um die Uhr", { exact: true }).click();
  await page.getByRole("button", { name: "Eine Ebene höher" }).click();
  await expect(page.locator("#detail-continue")).toHaveText("Weiter · 2 Angaben");
  await page.locator("#detail-continue").click();

  // Vorschau: nur die neuen Tags, und der Knopf sagt, dass Angaben gespeichert werden.
  await expect(page.getByRole("heading", { name: "Änderungsvorschau" })).toBeVisible();
  const preview = page.locator(".capture-content");
  await expect(preview).toContainText("Neu eingetragen werden:");
  await expect(preview).toContainText("opening_hours=24/7");
  await expect(preview).toContainText("level=0");
  await expect(preview).not.toContainText("access=");
  await expect(preview).not.toContainText("indoor=");
  await expect(page.getByRole("button", { name: "Fehlende Angaben ergänzen" })).toHaveCount(0);
  await page.getByRole("button", { name: "Testserver: Angaben speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Prüfdatum und neue Angaben gespeichert");
  expect(writes).toHaveLength(1);
  // Die Version und das Prüfdatum kommen aus dem frisch gelesenen Stand, nicht aus dem alten Treffer.
  expect(writes[0]).toMatchObject({
    confirmed: true,
    target: "node/123",
    expected_version: 9,
    expected_check_date: "2025-10-20",
    details: { opening_hours: "24/7", level: "0" },
  });
});

test("the quick confirmation stays a single tap without reading the object or sending details", async ({
  page,
  context,
}) => {
  const { nodeRequests, writes } = await openExistingAedPreview(page, context, { nodes: [freshNode({})] });
  await page.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");
  expect(nodeRequests).toEqual([]);
  expect(writes).toHaveLength(1);
  expect(writes[0]).not.toHaveProperty("details");
});

test("a server conflict while saving added details asks for a new check", async ({ page, context }) => {
  await openExistingAedPreview(page, context, {
    nodes: [freshNode({ check_date: "2025-10-20" })],
    writeStatus: 409,
    writeBody: { error: "version_conflict" },
  });
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await page.getByText("Nur Kunden", { exact: true }).click();
  await page.locator("#detail-continue").click();
  await page.getByRole("button", { name: "Testserver: Angaben speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Nichts wurde geändert");
});

test("the add-details form fits a 320 px phone in all six languages", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openExistingAedPreview(page, context, {
    nodes: [freshNode({ access: "yes", indoor: "yes", check_date: "2025-10-20" })],
  });
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await expect(page.locator("#detail-form")).toBeVisible();
  await page.getByText("Mehr Angaben", { exact: true }).click();
  for (const language of languageCodes) {
    await page.locator("#language").selectOption(language);
    await expect(page.locator("#detail-form")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `horizontal page overflow in ${language}`,
    ).toBeLessThanOrEqual(320);
    const overflowing = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "#detail-form .chip, #detail-form .field, #detail-form .detail-locked, #detail-form summary, .detail-footer .button",
        ),
      ]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5)
        .map((element) => element.className),
    );
    expect(overflowing, `controls beyond the screen in ${language}`).toEqual([]);
    // Die gesperrten Zeilen nennen den bestehenden Wert in der gewählten Sprache.
    await expect(page.locator("#detail-group-access .detail-locked")).not.toBeEmpty();
  }
});

test("with corrections allowed the form is prefilled, shows the old value of every change and needs a second confirmation", async ({
  page,
  context,
}) => {
  const { writes } = await openExistingAedPreview(page, context, { nodes: [freshNode(knownNode)], corrections: true });
  await correctButton(page).click();
  await expect(page.getByRole("heading", { name: "Angaben ergänzen oder korrigieren" })).toBeVisible();
  // Vorbelegt mit dem, was in OSM steht. „Weiß ich nicht“ gibt es bei vorhandenen Werten nicht.
  await expect(page.locator("#detail-access-private")).toBeChecked();
  await expect(page.locator("#detail-access-unknown")).toHaveCount(0);
  await expect(page.locator("#detail-hoursMode-always")).toBeChecked();
  await expect(page.locator("#detail-indoor-yes")).toBeChecked();
  await expect(page.locator("#detail-level-value")).toHaveText("1");
  await page.getByText("Mehr Angaben", { exact: true }).click();
  await expect(page.locator("#detail-operator")).toHaveValue("Stadtwerke");
  // Ohne Änderung gibt es nichts zu senden.
  await expect(page.locator("#detail-continue")).toHaveText("Weiter ohne Angaben");

  await page.getByText("Jeder", { exact: true }).click();
  await expect(page.locator("#detail-group-access")).toContainText("Vorher: Nicht öffentlich");
  await expect(page.locator("#detail-group-access")).toHaveClass(/is-changed/u);
  await page.getByRole("button", { name: "Eine Ebene höher" }).click();
  await expect(page.locator("#detail-group-indoor")).toContainText("Vorher: 1");
  await page.locator("#detail-ref").fill("7");
  await expect(page.locator("#detail-continue")).toHaveText("Weiter · 3 Angaben");
  await page.locator("#detail-continue").click();

  // Vorschau: Korrekturen als alt → neu, Ergänzungen getrennt, Speichern erst nach dem zweiten Haken.
  const preview = page.locator(".capture-content");
  await expect(preview).toContainText("Wird geändert:");
  await expect(preview).toContainText("access=private → yes");
  await expect(preview).toContainText("level=1 → 2");
  await expect(preview).toContainText("Neu eingetragen werden:");
  await expect(preview).toContainText("ref=7");
  await expect(preview).not.toContainText("operator=");
  const save = page.getByRole("button", { name: "Testserver: Änderungen speichern" });
  await expect(save).toBeDisabled();
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-action="save-development-check"]');
    if (!button) throw new Error("The save action should be rendered.");
    button.disabled = false;
    button.click();
  });
  expect(writes).toEqual([]);
  await page.locator("#correction-confirmed").check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("status")).toContainText("Prüfdatum und Änderungen gespeichert");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    confirmed: true,
    target: "node/123",
    expected_version: 9,
    expected_check_date: "2025-10-20",
    details: { access: "yes", level: "2", ref: "7" },
    expected_before: { access: "private", level: "1" },
    confirmed_corrections: true,
  });
});

test("changing indoor to outdoor says openly that the old level stays in OSM", async ({ page, context }) => {
  const { writes } = await openExistingAedPreview(page, context, { nodes: [freshNode(knownNode)], corrections: true });
  await correctButton(page).click();
  // Vorher kein Hinweis: Der AED bleibt drinnen.
  await expect(page.locator("#detail-group-indoor")).not.toContainText("bleibt in OSM stehen");
  await page.getByText("Draußen", { exact: true }).click();
  // Im Formular: Die Ebene verschwindet aus der Eingabe, der Hinweis steht bei der Gruppe.
  await expect(page.locator("#detail-group-indoor")).toContainText("Die Ebene „1“ bleibt in OSM stehen");
  await expect(page.locator("#detail-group-indoor")).toContainText("löscht nichts");
  await page.locator("#detail-continue").click();
  // In der Vorschau steht derselbe Hinweis, und geschrieben wird nur indoor, nie ein Löschen.
  const preview = page.locator(".capture-content");
  await expect(preview).toContainText("indoor=yes → no");
  await expect(preview).toContainText("Die Ebene „1“ bleibt in OSM stehen");
  await page.locator("#correction-confirmed").check();
  await page.getByRole("button", { name: "Testserver: Änderungen speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Prüfdatum und Änderungen gespeichert");
  expect(writes[0]).toMatchObject({ details: { indoor: "no" }, expected_before: { indoor: "yes" } });
  expect((writes[0] as { details: Record<string, string> }).details).not.toHaveProperty("level");
});

test("an untouched prefilled form changes nothing and sends no details", async ({ page, context }) => {
  const { writes } = await openExistingAedPreview(page, context, { nodes: [freshNode(knownNode)], corrections: true });
  await correctButton(page).click();
  await page.locator("#detail-continue").click();
  await expect(page.locator(".capture-content")).not.toContainText("Wird geändert:");
  await expect(page.locator(".capture-content")).not.toContainText("Neu eingetragen werden:");
  await page.getByRole("button", { name: "Testserver: Prüfdatum speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Vor-Ort-Prüfung gespeichert");
  expect(writes[0]).not.toHaveProperty("details");
  expect(writes[0]).not.toHaveProperty("expected_before");
  expect(writes[0]).not.toHaveProperty("confirmed_corrections");
});

test("a value the form cannot show stays locked and unchanged, and does not block other details", async ({
  page,
  context,
}) => {
  const { writes } = await openExistingAedPreview(page, context, {
    nodes: [
      freshNode({
        // Ein Zeilenumbruch mitten im Text und eine Nummer mit Wörtern lassen sich im Formular nicht darstellen.
        access: "permissive",
        phone: "bitte anrufen",
        description: "Zeile1\nZeile2",
        check_date: "2025-10-20",
      }),
    ],
    corrections: true,
  });
  await correctButton(page).click();
  await expect(page.locator("#detail-group-access")).toContainText("Schon eingetragen: permissive");
  await expect(page.locator("#detail-group-access")).toContainText("lässt sich hier nicht ändern");
  await expect(page.locator("#detail-access-yes")).toHaveCount(0);
  await page.getByText("Mehr Angaben", { exact: true }).click();
  await expect(page.locator("#detail-phone")).toHaveCount(0);
  await expect(page.locator("#detail-description")).toHaveCount(0);
  await page.locator("#detail-ref").fill("9");
  await expect(page.locator("#detail-continue")).toHaveText("Weiter · 1 Angabe");
  await page.locator("#detail-continue").click();
  await page.getByRole("button", { name: "Testserver: Angaben speichern" }).click();
  await expect(page.getByRole("status")).toContainText("neue Angaben gespeichert");
  expect(writes[0]).toMatchObject({ details: { ref: "9" } });
  expect(writes[0]).not.toHaveProperty("expected_before");
});

test("a server conflict on a correction asks for a new check", async ({ page, context }) => {
  await openExistingAedPreview(page, context, {
    nodes: [freshNode(knownNode)],
    corrections: true,
    writeStatus: 409,
    writeBody: { error: "version_conflict" },
  });
  await correctButton(page).click();
  await page.getByText("Jeder", { exact: true }).click();
  await page.locator("#detail-continue").click();
  await page.locator("#correction-confirmed").check();
  await page.getByRole("button", { name: "Testserver: Änderungen speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Nichts wurde geändert");
});

test("without the operator switch there is no correction mode: existing values stay locked", async ({
  page,
  context,
}) => {
  await openExistingAedPreview(page, context, { nodes: [freshNode(knownNode)] });
  await expect(correctButton(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await expect(page.locator("#detail-group-access")).toContainText("Schon eingetragen: Nicht öffentlich");
  await expect(page.locator("#detail-access-yes")).toHaveCount(0);
  await expect(page.locator("#detail-group-access")).not.toContainText("lässt sich hier nicht ändern");
});

test("the correction form fits a 320 px phone in all six languages", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openExistingAedPreview(page, context, { nodes: [freshNode(knownNode)], corrections: true });
  await correctButton(page).click();
  await page.getByText("Jeder", { exact: true }).click();
  await page.getByRole("button", { name: "Eine Ebene höher" }).click();
  await page.getByText("Mehr Angaben", { exact: true }).click();
  for (const language of languageCodes) {
    await page.locator("#language").selectOption(language);
    await expect(page.locator("#detail-form")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `horizontal page overflow in ${language}`,
    ).toBeLessThanOrEqual(320);
    const overflowing = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "#detail-form .chip, #detail-form .field, #detail-form .detail-was, #detail-form summary, .detail-footer .button",
        ),
      ]
        .filter((element) => !element.hidden && element.getBoundingClientRect().right > window.innerWidth + 0.5)
        .map((element) => element.className),
    );
    expect(overflowing, `controls beyond the screen in ${language}`).toEqual([]);
    // Die „Vorher“-Zeile steht sichtbar und nennt den alten Wert in der gewählten Sprache.
    await expect(page.locator('[data-detail-was="access"]')).toBeVisible();
    await expect(page.locator('[data-detail-was="access"]')).not.toBeEmpty();
  }
});

test("the list offers the change wording only when corrections are allowed", async ({ page, context }) => {
  await openExistingAedPreview(page, context, {
    atList: true,
    nodes: [freshNode({ access: "private", check_date: "2025-10-20" })],
    corrections: true,
  });
  await expect(page.getByRole("button", { name: "Angaben ansehen und ändern" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Angaben ansehen und ergänzen" })).toHaveCount(0);
  await page.getByRole("button", { name: "Angaben ansehen und ändern" }).click();
  // Mit Korrekturen ist das Formular vorbelegt und änderbar.
  await expect(page.locator("#detail-access-private")).toBeChecked();
});

test("an AED from the real-OSM archive or a session without test-server writing gets no tag button", async ({
  page,
  context,
}) => {
  await openExistingAedPreview(page, context, { atList: true, candidateSource: "archive", nodes: [freshNode({})] });
  await expect(detailsFromList(page)).toHaveCount(0);
});

test("without test-server writing the list has no tag button", async ({ page, context }) => {
  await openExistingAedPreview(page, context, { atList: true, writeAvailable: false, nodes: [freshNode({})] });
  await expect(detailsFromList(page)).toHaveCount(0);
});

test("the tag button in the list fits a 320 px phone in all six languages", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openExistingAedPreview(page, context, { atList: true, nodes: [freshNode({})] });
  for (const language of languageCodes) {
    await page.locator("#language").selectOption(language);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `horizontal page overflow in ${language}`,
    ).toBeLessThanOrEqual(320);
    const buttons = page.locator('.candidate-item [data-action="open-candidate-details"]');
    await expect(buttons).toHaveCount(1);
    const box = await buttons.boundingBox();
    const buttonBox = requireValue(box, `The candidate-details button in ${language}`);
    expect(buttonBox.x + buttonBox.width, `button beyond the screen in ${language}`).toBeLessThanOrEqual(320);
    expect(buttonBox.height, `touch target in ${language}`).toBeGreaterThanOrEqual(44);
  }
});

test("choosing drinnen and then draußen drops the level, and 24/7 only follows an explicit choice", async ({
  page,
  context,
}) => {
  await openNewAedDetailForm(page, context);
  await page.getByText("Drinnen", { exact: true }).click();
  await page.getByRole("button", { name: "Eine Ebene tiefer" }).click();
  await page.getByRole("button", { name: "Eine Ebene tiefer" }).click();
  await expect(page.locator("#detail-level-value")).toHaveText("-1");
  await page.getByText("Draußen", { exact: true }).click();
  await expect(page.locator("#detail-level-value")).toHaveCount(0);
  await expect(page.locator("#detail-continue")).toHaveText("Weiter · 1 Angabe");
  await page.locator("#detail-continue").click();
  await expect(page.locator(".capture-content")).toContainText("indoor=no");
  await expect(page.locator(".capture-content")).not.toContainText("level=");
  await expect(page.locator(".capture-content")).not.toContainText("opening_hours=");
  await page.getByRole("button", { name: "Zurück zu den Angaben" }).click();
  await page.getByText("Rund um die Uhr", { exact: true }).click();
  await page.locator("#detail-continue").click();
  await expect(page.locator(".capture-content")).toContainText("opening_hours=24/7");
});

test("going back from the preview keeps the entries, going back from the form resets them", async ({
  page,
  context,
}) => {
  await openExistingAedPreview(page, context, { nodes: [freshNode({ check_date: "2025-10-20" })] });
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await page.getByText("Jeder", { exact: true }).click();
  await page.locator("#detail-continue").click();
  await expect(page.locator(".capture-content")).toContainText("access=yes");
  await page.getByRole("button", { name: "Zurück zu den Angaben" }).click();
  await expect(page.locator("#detail-access-yes")).toBeChecked();
  // Zurück zur einfachen Bestätigung: Die Eingaben sind weg, die Vorschau zeigt nur noch das Datum.
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(page.getByRole("button", { name: "Testserver: Prüfdatum speichern" })).toBeVisible();
  await page.getByRole("button", { name: "Fehlende Angaben ergänzen" }).click();
  await expect(page.locator("#detail-access-yes")).not.toBeChecked();
  await expect(page.locator("#detail-continue")).toHaveText("Weiter ohne Angaben");
});
