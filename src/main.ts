import "./styles.css";
import { endOSMSession, loadOSMSession } from "./auth/osmSession";
import { analysisResult, chooseCandidate, confirmationResult, recoveryResult, type CandidateId, type DemoScenario, type DevelopmentWriteRequest, type FlowState } from "./domain/workflow";
import { translate, translations, type Language, type TranslationKey } from "./i18n/translations";
import { translateFlow, type FlowMessageKey } from "./i18n/flowTranslations";
import { readPhotoCapture, readPhotoLocation } from "./vision/photoLocation";
import { createVisionRequestId, preparePhotoForAnalysis, requestVisionObservation, VisionClientError } from "./vision/analyzePhoto";
import { isAedRecognized } from "./contracts/visionObservation";
import { formatBuildTime } from "./pwa/buildInfo";
import { successSound } from "./sound/successSound";
import { startUpdateWatcher } from "./pwa/updateCheck";
import { askForLocationOnce, phoneLocationFitsPhoto, readLocationPermission, watchLocationPermission, type LocationPermission } from "./location/phoneLocationPermission";
import { assessCandidateSearch } from "./domain/assessCandidateSearch";
import { createPositionPicker, zoomToFitMarkers, type Coordinate, type MapMarker } from "./map/positionPicker";
import { previewExistingAedCheck, previewNewAed } from "./domain/osmChangeProposal";
import { CandidateSearchError, requestNearbyCandidates, type SearchLocation } from "./osm/candidateSearch";
import { isCalendarDate, isFreshCapture, isValidObservedDate, localCalendarDate, photoDateNeedsConfirmation } from "./domain/localDate";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root element was not found.");

const languageNames: Record<Language, string> = { de: "Deutsch", en: "English", pl: "Polski", ja: "日本語", fr: "Français", es: "Español" };
const developmentWriteCopy: Record<Language, { action: string; createAction: string; retry: string; sending: string; complete: string; created: string; uncertain: string; conflict: string; failed: string; }> = {
  de: { action: "Testserver: Prüfdatum speichern", createAction: "Testserver: AED eintragen", retry: "Testserver: Status erneut prüfen", sending: "Testserver: Änderung wird gesendet…", complete: "Testserver: Vor-Ort-Prüfung gespeichert.", created: "Testserver: Neuer AED wurde eingetragen.", uncertain: "Testserver: Ergebnis unklar. Mit derselben Anfrage erneut prüfen; keine neue Änderung wird blind gesendet.", conflict: "Testserver: In der Nähe gibt es einen AED oder der OSM-Eintrag änderte sich. Suche bitte erneut.", failed: "Testserver: Änderung fehlgeschlagen. Bitte Eintrag erneut prüfen." },
  en: { action: "Test server: Save visit date", createAction: "Test server: Add AED", retry: "Test server: Check status again", sending: "Test server: Sending update…", complete: "Test server: Visit confirmation saved.", created: "Test server: New AED added.", uncertain: "Test server: Result is unclear. Check again using the same request; no new edit will be sent blindly.", conflict: "Test server: An AED is nearby or the OSM entry changed. Search again.", failed: "Test server: Update failed. Please check the entry again." },
  pl: { action: "Serwer testowy: zapisz datę kontroli", createAction: "Serwer testowy: dodaj AED", retry: "Serwer testowy: sprawdź ponownie stan", sending: "Serwer testowy: wysyłanie zmiany…", complete: "Serwer testowy: zapisano potwierdzenie kontroli.", created: "Serwer testowy: dodano nowy AED.", uncertain: "Serwer testowy: wynik jest niepewny. Sprawdź ponownie to samo żądanie; nie wyślemy w ciemno nowej zmiany.", conflict: "Serwer testowy: w pobliżu jest AED albo wpis OSM został zmieniony. Wyszukaj ponownie.", failed: "Serwer testowy: nie udało się zapisać zmiany. Sprawdź ponownie wpis." },
  ja: { action: "テストサーバー：確認日を保存", createAction: "テストサーバー：AEDを登録", retry: "テストサーバー：状態を再確認", sending: "テストサーバー：変更を送信中…", complete: "テストサーバー：現地確認を保存しました。", created: "テストサーバー：新しいAEDを登録しました。", uncertain: "テストサーバー：結果を確認できません。同じリクエストで再確認してください。新しい変更を無確認で送信しません。", conflict: "テストサーバー：近くにAEDがあるか、OSMの項目が変更されています。再検索してください。", failed: "テストサーバー：変更に失敗しました。項目を再確認してください。" },
  fr: { action: "Serveur de test : enregistrer la date", createAction: "Serveur de test : ajouter un DAE", retry: "Serveur de test : vérifier à nouveau", sending: "Serveur de test : envoi de la modification…", complete: "Serveur de test : visite confirmée.", created: "Serveur de test : nouveau DAE ajouté.", uncertain: "Serveur de test : résultat incertain. Vérifiez à nouveau avec la même requête ; aucune nouvelle modification ne sera envoyée à l’aveugle.", conflict: "Serveur de test : un DAE est proche ou la fiche OSM a changé. Relancez la recherche.", failed: "Serveur de test : échec de la modification. Vérifiez à nouveau la fiche." },
  es: { action: "Servidor de pruebas: guardar fecha", createAction: "Servidor de pruebas: añadir DEA", retry: "Servidor de pruebas: comprobar estado", sending: "Servidor de pruebas: enviando cambio…", complete: "Servidor de pruebas: visita confirmada.", created: "Servidor de pruebas: se añadió un DEA.", uncertain: "Servidor de pruebas: resultado incierto. Comprueba de nuevo con la misma solicitud; no enviaremos otro cambio a ciegas.", conflict: "Servidor de pruebas: hay un DEA cerca o la ficha OSM ha cambiado. Vuelve a buscar.", failed: "Servidor de pruebas: no se pudo guardar. Comprueba de nuevo la ficha." },
};
const scenarioKeys: Record<DemoScenario, TranslationKey> = {
  existing: "existingScenario", new: "newScenario", multiple: "multipleScenario", unclear: "unclearScenario", "search-error": "searchErrorScenario", "upload-unclear": "uploadErrorScenario",
};
const supportedLanguages = Object.keys(translations) as Language[];
const minimumMapSearchZoom = 15;
let language = readLanguage();
let scenario: DemoScenario = "existing";
// Local fixture workflows stay hidden until the user explicitly opens the preview panel.
let demoMode = false;
let diagnosticsEnabled = false;
let diagnosticFlowId: string | undefined;
const pendingDevelopmentWrite = readPendingDevelopmentWrite();
let state: FlowState = pendingDevelopmentWrite ? { kind: "development-write-recovery", request: pendingDevelopmentWrite, writeStatus: "uncertain" } : { kind: "ready" };
type AccountState = "checking" | "not-configured" | "connection-error" | "login-error" | "signed-out" | "signed-in" | "logout-error";
let accountState: AccountState = "checking";
let productionLoginAvailable = false;
let developmentLoginAvailable = false;
let developmentSession = false;
let developmentWriteAvailable = false;
// Fotoprüfung: Nur wenn der Server sie für dieses Konto freigibt, bietet die App den Foto-Upload an.
let photoCheckAvailable = false;
// Die gewählte Foto-Datei bleibt nur im Arbeitsspeicher, solange das Foto aktiv ist. Sie wird
// ausschließlich für die Fotoprüfung gebraucht und in releasePhoto() wieder verworfen.
let selectedPhotoFile: File | undefined;
// Eine Kennung pro Foto: Ein zweiter Tipp auf dieselbe Prüfung erzeugt so keine zweite Abrechnung.
let photoCheckRequestId: string | undefined;
// Update-Hinweis: wird true, sobald der Wächter eine neuere veröffentlichte Version erkennt.
let updateAvailable = false;
// Standort-Erlaubnis des Handys (nur lesen, nie anfragen). Nur bei „granted“ nutzt die App den Handy-Standort
// ohne Zwischenfrage, und das nur für ein frisch aufgenommenes Kamerafoto ohne Foto-GPS.
let phoneLocationPermission: LocationPermission = "unknown";
// Herkunft und Aufnahmezeit des aktuellen Fotos. Daraus entscheidet phoneLocationFitsPhoto bei jeder Fortsetzung
// neu, ob der Handy-Standort noch zum Foto passt: nur bei einem Kamerafoto, das höchstens fünf Minuten alt ist.
let selectedPhotoFromCamera = false;
let selectedPhotoCapturedAtMs: number | undefined;
// Die einmalige Standortanfrage wird pro Seitenaufruf höchstens einmal versucht (und pro Gerät nur einmal gestellt).
let locationAskAttempted = false;
let oauthReturnFailed = new URLSearchParams(window.location.search).get("login") === "error";
let analysisTimer: number | undefined;
let saveTimer: number | undefined;
let searchRetryTimer: number | undefined;
let selectedPhotoLocation: SearchLocation | undefined;
let observedOn = localCalendarDate();
let photoDateRequiresConfirmation = false;
let activeSearchLocation: SearchLocation | undefined;
// „phone“: Die Person hat den Handy-Standort ausdrücklich gewählt. „phone-auto“: Die App hat ihn bei einem frischen
// Kamerafoto ohne GPS selbst eingesetzt. Beide heißen in der Anzeige „Handy-Standort verwendet“. Der Unterschied zählt
// beim Wiederholen: Einen ausdrücklich gewählten Standort darf die App neu holen, einen selbst eingesetzten nur,
// solange das Foto noch frisch ist.
let activeSearchLocationSource: "photo" | "phone" | "phone-auto" | "map" | undefined;
// Keep a stable ID while this photo is active; the server uses it to avoid double reservations after retries.
let photoSelectionVersion = 0;
let photoSelectionPending = false;
let activePositionPicker: { destroy(): void } | undefined;
let newAedPositionOverride: Coordinate | undefined;
let mapLocationOverride: Coordinate | undefined;

function readLanguage(): Language {
  const saved = localStorage.getItem("aedjaeger-language");
  if (saved && supportedLanguages.includes(saved as Language)) return saved as Language;
  const deviceLanguage = navigator.language.slice(0, 2) as Language;
  return supportedLanguages.includes(deviceLanguage) ? deviceLanguage : "de";
}

function readPendingDevelopmentWrite(): DevelopmentWriteRequest | undefined {
  try {
    let raw = sessionStorage.getItem("aedjaeger-pending-osm-development-write");
    let legacyCheck = false;
    if (!raw) {
      raw = sessionStorage.getItem("aedjaeger-pending-osm-development-check");
      legacyCheck = raw !== null;
    }
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.operationId)
      || typeof value.candidateLabel !== "string" || value.candidateLabel.length > 255 || !isCalendarDate(value.observedOn)) return undefined;
    const kind = legacyCheck ? "check-date" : value.kind;
    if (kind === "check-date" && typeof value.target === "string" && /^node\/[1-9]\d{0,15}$/u.test(value.target)
      && (value.expectedVersion === undefined || Number.isSafeInteger(value.expectedVersion) && (value.expectedVersion as number) > 0)
      && (value.expectedCheckDate === null || isCalendarDate(value.expectedCheckDate))) {
      const request = { ...value, kind: "check-date" } as unknown as DevelopmentWriteRequest;
      if (legacyCheck) {
        sessionStorage.setItem("aedjaeger-pending-osm-development-write", JSON.stringify(request));
        sessionStorage.removeItem("aedjaeger-pending-osm-development-check");
      }
      return request;
    }
    if (kind === "create-node" && typeof value.latitude === "number" && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
      && typeof value.longitude === "number" && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
      && (value.locationDescription === null || typeof value.locationDescription === "string" && value.locationDescription.length <= 255)) {
      const confirmedIds = value.confirmedDifferentCandidateIds ?? [];
      if (!Array.isArray(confirmedIds) || confirmedIds.length > 100
        || confirmedIds.some((id) => typeof id !== "string" || !/^(node|way|relation)\/[1-9]\d{0,15}$/u.test(id))
        || new Set(confirmedIds).size !== confirmedIds.length) return undefined;
      return { ...value, confirmedDifferentCandidateIds: confirmedIds } as unknown as DevelopmentWriteRequest;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function persistPendingDevelopmentWrite(request: DevelopmentWriteRequest): void {
  sessionStorage.setItem("aedjaeger-pending-osm-development-write", JSON.stringify(request));
}

function clearPendingDevelopmentCheck(): void {
  try { sessionStorage.removeItem("aedjaeger-pending-osm-development-write"); } catch { /* The server operation remains idempotent even if browser storage is unavailable. */ }
}

function t(key: TranslationKey, values?: Record<string, number | string>): string {
  const translated = translate(language, key);
  return values ? translated.replace(/\{(\w+)\}/gu, (_, name: string) => String(values[name] ?? "")) : translated;
}
function tv(key: FlowMessageKey, values?: Record<string, number | string>): string { return translateFlow(language, key, values); }
type DiagnosticEvent =
  | "test_run_started" | "test_run_abandoned" | "photo_selected" | "demo_started" | "demo_result_shown" | "demo_confirmed"
  | "live_flow_blocked" | "sighting_confirmed"
  | "nearby_search_started" | "nearby_search_finished";

function recordDiagnostic(event: DiagnosticEvent): void {
  if (!diagnosticsEnabled || !diagnosticFlowId) return;
  void fetch("/api/diagnostics", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, flowId: diagnosticFlowId }),
  }).catch(() => {
    // Test guidance still works if diagnostics are unavailable.
  });
}

function clearDiagnosticConsent(): void {
  diagnosticsEnabled = false;
  diagnosticFlowId = undefined;
}

function demoNotice(): string {
  return demoMode ? `<p class="simulation-note" role="note">${t("testResultNotice")}</p>` : "";
}

function signInLinks(): string {
  const productionLink = productionLoginAvailable ? `<a class="button button-primary account-sign-in" id="osm-sign-in" href="/api/auth/osm/start">${t("accountSignIn")}</a>` : "";
  const developmentLink = developmentLoginAvailable ? `<a class="button button-secondary account-sign-in" id="osm-dev-sign-in" href="/api/auth/osm/development/start">${t("accountDevSignIn")}</a><p class="simulation-note">${t("accountDevNotice")}</p>` : "";
  return `${productionLink}${developmentLink}`;
}

/** Die OSM-Anmeldung ist Voraussetzung für alle Arbeitsfunktionen der App. */
function loginEntry(): string {
  const registerLink = `<a class="account-create-link" href="https://www.openstreetmap.org/user/new" target="_blank" rel="noopener noreferrer">${t("accountCreate")}</a>`;
  const createHelp = `<p class="account-create-help">${t("accountCreateHelp")}</p>`;
  let status = "";
  let actions = "";

  if (accountState === "checking") {
    status = `<p class="login-status" role="status" aria-live="polite">${t("accountChecking")}</p>`;
  } else if (accountState === "connection-error") {
    status = `<p class="login-status" role="alert">${t("accountConnectionError")}</p>`;
    actions = `<button class="button button-secondary account-sign-in" id="osm-session-retry" type="button">${t("accountRetry")}</button>`;
  } else if (accountState === "not-configured") {
    status = `<p class="login-status" role="status">${t("accountUnavailable")}</p>`;
  } else {
    if (accountState === "login-error") status = `<p class="login-status" role="alert">${t("accountLoginError")}</p>`;
    if (accountState === "logout-error") {
      status = `<p class="login-status" role="alert">${t("accountSignOutError")}</p>`;
      // Keep logout retryable if the server may still hold the user's session.
      actions = `<button class="button button-secondary account-sign-in" id="osm-sign-out" type="button">${t("accountSignOut")}</button>`;
    } else {
      actions = signInLinks();
    }
  }

  return `<section class="login-card" aria-labelledby="login-title">
    <div class="empty-illustration" aria-hidden="true"><span class="device-card"><span class="device-heart">♥</span><span class="device-zap">ϟ</span></span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>
    <p class="hero-kicker"><span></span>${t("eyebrow")}</p>
    <h1 id="login-title" tabindex="-1">${t("accountGateTitle")}</h1>
    <p class="login-intro">${t("accountGateIntro")}</p>
    <p class="login-requirement">${t("accountRequired")}</p>
    ${status ? `<div class="login-status-wrap">${status}</div>` : ""}
    ${actions ? `<div class="login-actions">${actions}</div>` : ""}
    <div class="account-create">${registerLink}${createHelp}</div>
    <p class="login-credentials-note">${t("accountCredentialsNote")}</p>
  </section>`;
}

function accountPanel(): string {
  if (accountState === "checking") return `<section class="account-panel" aria-live="polite" tabindex="-1">${t("accountChecking")}</section>`;
  if (accountState === "not-configured") return `<section class="account-panel" aria-live="polite" tabindex="-1">${t("accountUnavailable")}</section>`;
  if (accountState === "connection-error") return `<section class="account-panel" aria-live="polite" tabindex="-1"><span>${t("accountConnectionError")}</span><button class="account-button" id="osm-session-retry" type="button">${t("accountRetry")}</button></section>`;
  if ((photoSelectionPending || hasActivePhotoDraft(state)) && accountState !== "signed-in") return `<section class="account-panel" aria-live="polite" tabindex="-1">${t("accountLoginBlocked")}</section>`;
  if (accountState === "login-error") return `<section class="account-panel" aria-live="polite"><p role="alert">${t("accountLoginError")}</p>${signInLinks()}</section>`;
  // Angemeldet: Kein Block auf dem Hauptbildschirm. Der Status steht als Lampe in der Fußzeile, „Abmelden“ im Info-Dialog.
  if (accountState === "signed-in") return "";
  if (accountState === "logout-error") {
    return `<section class="account-panel" aria-live="polite"><span>${t("accountSignOutError")}</span><button class="account-button" id="osm-sign-out" type="button">${t("accountSignOut")}</button></section>`;
  }
  return `<section class="account-panel">${signInLinks()}<p>${t("accountIdentityOnly")}</p></section>`;
}
/**
 * Die Lampe neben dem Namen in der Kopfzeile zeigt, ob die App mit OpenStreetMap verbunden ist: grün = verbunden,
 * rot = nicht verbunden. Sie ersetzt den früheren Textblock „Mit OSM-Testserver verbunden“ und das Häkchen vor dem Namen.
 * Sie steht oben, weil dort jeder Bildschirm anfängt; in der Fußzeile lag sie bei längeren Seiten außerhalb des Bildschirms
 * und war zu klein, um aufzufallen.
 *
 * Sie ist zugleich eine Schaltfläche (siehe openAccountFromLamp): Grün führt zum Abmelden, Rot zur Anmeldeseite (angemeldet wird nur mit dem Anmelde-Knopf).
 * Der sichtbare Punkt ist klein; die Schaltfläche darum herum vergrößert nur die Tippfläche (siehe styles.css).
 * Für Screenreader trägt die Schaltfläche den Status als Text, denn Farbe allein reicht nicht.
 */
function connectionLamp(): string {
  const connected = accountState === "signed-in";
  const label = connected ? (developmentSession ? t("accountDevSignedIn") : t("accountSignedIn")) : tv("connectionOff");
  return `<button class="connection-lamp-button" id="connection-lamp" type="button" aria-label="${escapeHtml(label)}"><span class="connection-lamp ${connected ? "connection-lamp-on" : "connection-lamp-off"}" aria-hidden="true"></span></button>`;
}

/**
 * Tippen auf die Lampe.
 * - Verbunden (grün): öffnet den Info-Dialog an der Stelle mit „Abmelden“. Abgemeldet wird erst mit dem Tippen auf
 *   „Abmelden“, nicht schon durch die Lampe.
 * - Nicht verbunden (rot): zeigt die Anmeldeseite und setzt den Fokus auf den Anmelde-Knopf. Die Lampe meldet NIE von
 *   selbst an. Wer bei OpenStreetMap noch angemeldet ist, käme sonst ohne jede Eingabe zurück in die App; die Anmeldung
 *   braucht immer ein ausdrückliches Tippen auf den Knopf. Gibt es keinen Anmelde-Knopf (Prüfung läuft,
 *   Verbindungsfehler, nicht eingerichtet), bekommt der passende andere Knopf oder die Überschrift den Fokus.
 */
function openAccountFromLamp(): void {
  if (accountState === "signed-in") {
    const dialog = document.querySelector<HTMLDialogElement>("#info-dialog");
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const signOut = dialog.querySelector<HTMLButtonElement>("#osm-sign-out");
    signOut?.scrollIntoView({ block: "center" });
    signOut?.focus();
    return;
  }
  // Nur zeigen und fokussieren, nie klicken: Das Fokussieren eines Links löst keine Navigation aus.
  // Die Reihenfolge der Auswahl ist Absicht: Ein Selektor mit Komma würde das erste Element im Dokument nehmen, also die Überschrift.
  let target: HTMLElement | null = null;
  for (const selector of ["#osm-sign-in", "#osm-dev-sign-in", "#osm-session-retry", "#osm-sign-out", "#login-title"]) {
    target = app!.querySelector<HTMLElement>(selector);
    if (target) break;
  }
  target?.scrollIntoView({ block: "center" });
  target?.focus();
}

/**
 * Text für die Versionszeile im Info-Dialog: "Version <Revision> · <Build-Zeit>".
 * Die Revision kommt zur Build-Zeit in die App (siehe vite.config.ts); die Zeit wird aus ihr zurückgerechnet.
 * Lässt sich keine Zeit ableiten, steht nur die Revision da.
 */
function buildVersionText(): string {
  const text = tv("buildVersion", { revision: __AEDJAEGER_BUILD_REVISION__ });
  const time = formatBuildTime(__AEDJAEGER_BUILD_REVISION__, language);
  return time ? `${text} · ${time}` : text;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function getPhotoUrl(current: FlowState): string | undefined {
  return "photoUrl" in current ? current.photoUrl : undefined;
}

function hasUnresolvedSave(current: FlowState): boolean {
  return current.kind === "candidate-searching" || current.kind === "sending" || current.kind === "checking-status" || current.kind === "unclear-error"
    || (current.kind === "new-aed-preview" && (current.writeStatus === "sending" || current.writeStatus === "uncertain"))
    || (current.kind === "osm-preview" && (current.writeStatus === "sending" || current.writeStatus === "uncertain"));
}

function hasActivePhotoDraft(current: FlowState): boolean {
  return current.kind !== "ready" && current.kind !== "saved";
}

/**
 * Sagt, ob der Bereich „neuen AED eintragen“ (Karte + Positionsbestätigung) geöffnet ist.
 *
 * Sicherheitsregel: Eine Neuanlage braucht immer ZWEI getrennte, ausdrückliche Bestätigungen.
 * Diese Funktion prüft die ERSTE davon:
 *  - Suche ohne Treffer: Die Person hat „Hier fehlt ein AED – neu eintragen“ gedrückt.
 *  - Suche mit Treffern: Die Person hat „Keiner davon – neuen AED eintragen“ gedrückt.
 * Die ZWEITE Bestätigung folgt in der Vorschau direkt vor dem Speichern (Haken „vor Ort geprüft“).
 * Eine unvollständige oder fehlgeschlagene Suche öffnet den Bereich nie.
 */
function newEntryPanelOpen(current: FlowState): boolean {
  if (current.kind !== "candidate-result" || current.search.status !== "complete") return false;
  if (current.assessment.kind === "new-entry-eligible") return current.newEntryRequested === true;
  return current.assessment.kind === "candidate-review" && current.noneOfTheseConfirmed === true;
}

/**
 * Baut die nummerierten Kartenmarker für die angezeigten Suchtreffer.
 * Die Nummer (1, 2, 3 …) ist dieselbe wie in der Trefferliste, damit man Karte und Liste
 * leicht zuordnen kann. Es werden nur die tatsächlich angezeigten Treffer markiert.
 */
function reviewedCandidateMarkers(current: FlowState): MapMarker[] {
  if (current.kind !== "candidate-result" || current.assessment.kind !== "candidate-review") return [];
  const markers: MapMarker[] = [];
  current.assessment.candidates.forEach((ranked, index) => {
    const candidate = current.search.candidates.find((item) => item.id === ranked.id);
    if (candidate) markers.push({ position: candidate.position, label: String(index + 1) });
  });
  return markers;
}

function statusContent(): string {
  const photoUrl = getPhotoUrl(state);
  const photoMarkup = photoUrl ? `<img class="photo-preview" src="${escapeHtml(photoUrl)}" alt="${t("photoAlt")}" />` : "";
  switch (state.kind) {
    case "ready":
      return `<div class="empty-illustration" aria-hidden="true"><span class="device-card"><span class="device-heart">♥</span><span class="device-zap">ϟ</span></span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>`;
    case "photo": {
      // The first pilot deliberately relies on the person's on-site confirmation, not a model.
      // The image and its remaining metadata stay in this browser; only selected coordinates
      // leave it later when the person explicitly starts a location search.
      //
      // Neu: Gibt der Server die Fotoprüfung für dieses Konto frei, ersetzt „AED gesehen – Foto
      // prüfen“ die reine Selbstbestätigung. Dann ehrlich anzeigen, dass das Foto (ohne Standort und
      // Metadaten) das Gerät verlässt. Ist die Prüfung gescheitert (photoCheck „unavailable“),
      // gilt wieder die Selbstbestätigung samt Hinweis, damit die App nicht an OpenAI hängt.
      const useCheck = !demoMode && photoCheckAvailable && state.photoCheck !== "unavailable" && selectedPhotoFile !== undefined;
      const photoAction = demoMode
        ? `<button class="button button-primary" data-action="analyze">${t("demoAnalyze")}</button>`
        : useCheck
          ? `<button class="button button-primary" data-action="check-photo">${tv("photoCheckAction")}</button>`
          : `<button class="button button-primary" data-action="confirm-sighting">${tv("sightingConfirm")}</button>`;
      // Nach einem gescheiterten Prüfversuch darf NICHT stehen, das Foto bleibe auf dem Gerät: Bei
      // einer Zeitüberschreitung oder einer ungültigen Antwort kann der Upload bereits erfolgt sein.
      // Dann nur sagen, dass die Prüfung nicht möglich war. Die lokale Zusage gilt nur, wenn die
      // Prüfung gar nicht erst angeboten wurde.
      const photoNote = useCheck
        ? `<p class="supporting-copy">${tv("photoCheckNotice")}</p>`
        : state.photoCheck === "unavailable"
          // Der Fehlercode steht klein darunter, damit sich im Pilot eingrenzen lässt, warum die Prüfung scheiterte.
          ? `<p class="supporting-copy">${tv("photoCheckUnavailable")}</p>${state.photoCheckCode ? `<p class="supporting-copy photo-check-code">${escapeHtml(tv("photoCheckCode", { code: state.photoCheckCode }))}</p>` : ""}`
          : `<p class="supporting-copy">${tv("photoStaysLocal")}</p>`;
      return `${photoMarkup}${photoAction}${photoNote}${demoMode ? `<p class="simulation-note">${t("testPhotoNotice")}</p>` : ""}<button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
    }
    case "photo-checking":
      return `${photoMarkup}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${tv("photoChecking")}</span></div>`;
    case "photo-rejected":
      // Standardweg ist „Anderes Foto“: Ein Foto ohne erkennbaren AED soll nicht in die Suche laufen.
      // Weil die Prüfung auch irren kann (zum Beispiel bei einem echten, aber ungünstig fotografierten AED),
      // gibt es eine Ausnahme, die ZWEI ausdrückliche Bestätigungen verlangt: erst „Trotzdem: Hier ist ein AED“,
      // dann „Ja, AED oder Gehäuse ist zu sehen – weiter“. Danach gilt der normale Ablauf mit seinen eigenen
      // Bestätigungen (Datum, Standort, bei Neuanlagen wieder zwei).
      if (state.overrideStep === "confirm") {
        return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("photoOverrideTitle")}</h2><p>${tv("photoOverrideBody")}</p></div></div><button class="button button-primary" data-action="confirm-photo-override">${tv("photoOverrideConfirm")}</button><button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
      }
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv(state.reason === "unclear" ? "photoUnclearTitle" : "photoRejectedTitle")}</h2><p>${tv(state.reason === "unclear" ? "photoUnclearBody" : "photoRejectedBody")}</p></div></div><button class="button button-primary" data-action="retake">${t("retake")}</button><button class="button button-secondary" data-action="start-photo-override">${tv("photoOverrideAction")}</button>`;
    case "photo-date":
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("photoDateTitle")}</h2><p>${tv("photoDateHelp")}</p><label for="photo-observed-on">${tv("photoDateLabel")}</label><input id="photo-observed-on" type="date" value="${escapeHtml(state.suggestedDate)}" max="${localCalendarDate()}" /></div></div><button class="button button-primary" data-action="confirm-photo-date">${tv("photoDateConfirm")}</button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    case "analyzing":
      return `${photoMarkup}${demoNotice()}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${t("demoRunning")}</span></div>`;
    case "location-choice":
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("locationTitle")}</h2><p>${tv("photoLocationMissing")}</p></div></div><button class="button button-primary" data-action="use-phone-location">${tv("usePhoneLocation")}</button><button class="button button-secondary" data-action="choose-map-location">${tv("chooseMapLocation")}</button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    case "location-map": {
      const selectedPosition = mapLocationOverride ?? state.center;
      const mapHasSelection = mapLocationOverride !== undefined && (state.initialZoom ?? 19) >= minimumMapSearchZoom;
      const mapPositionLabel = mapHasSelection
        ? tv("mapLocationCoordinates", { latitude: selectedPosition.latitude.toFixed(5), longitude: selectedPosition.longitude.toFixed(5) })
        : tv("mapLocationInitial");
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">◎</span><div><h2>${tv("chooseMapLocation")}</h2><p>${tv("mapLocationHelp")}</p></div></div><div id="search-location-map" class="position-map" role="application" tabindex="0" aria-label="${tv("chooseMapLocation")}"></div><p class="position-map-coordinates" id="search-location-coordinates" aria-live="polite">${mapPositionLabel}</p><button class="button button-primary" data-action="confirm-map-location"${mapHasSelection ? "" : " disabled"}>${tv("searchAction")}</button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    }
    case "candidate-searching":
      return `${photoMarkup}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${tv("searchProgress")}</span></div>`;
    case "candidate-result": {
      const { assessment, search } = state;
      const candidatesToShow: Array<{ candidate: typeof search.candidates[number]; distanceMeters?: number }> = [];
      if (assessment.kind === "candidate-review") {
        for (const rankedCandidate of assessment.candidates) {
          const candidate = search.candidates.find((item) => item.id === rankedCandidate.id);
          if (candidate) candidatesToShow.push({ candidate, distanceMeters: rankedCandidate.distanceMeters });
        }
      } else if (assessment.kind === "search-incomplete") {
        for (const candidate of search.candidates) candidatesToShow.push({ candidate });
      }
      // Nur bei einer vollständigen Trefferprüfung gibt es Kartenmarker; dann bekommt jeder
      // Listeneintrag dieselbe Nummer wie sein Marker auf der Karte.
      const numbered = assessment.kind === "candidate-review";
      const candidates = candidatesToShow.map(({ candidate, distanceMeters }, index) => {
          const name = candidate.tags.name || candidate.tags["defibrillator:location"] || candidate.id;
          const label = numbered ? `${index + 1}. ${name}` : name;
          const distance = distanceMeters === undefined ? "" : `<span>${escapeHtml(tv("distance", { distance: Math.round(distanceMeters) }))}</span>`;
          const reviewAction = candidate.osmType === "node"
            ? `<button class="button button-secondary" data-action="preview-candidate" data-candidate-id="${escapeHtml(candidate.id)}">${tv("selectCandidate")}</button>`
            : `<span class="supporting-copy">${tv("previewUnsupportedShort")}</span>`;
          return `<li class="candidate-item"><strong>${escapeHtml(label)}</strong>${distance}${reviewAction}</li>`;
        }).join("");
      let outcome: string;
      if (search.status === "partial" || assessment.kind === "search-incomplete") outcome = tv("searchPartial");
      else if (assessment.kind === "candidate-review") outcome = tv("searchFound", { count: assessment.candidates.length });
      else if (assessment.kind === "new-entry-eligible") outcome = tv("searchNoMatch");
      else if (assessment.kind === "location-too-uncertain") outcome = tv("locationUncertain");
      else outcome = tv("searchFailedResult");
      const selectedPosition = newAedPositionOverride ?? state.location;
      const mayPrepareNewEntry = newEntryPanelOpen(state);
      const newEntryAction = mayPrepareNewEntry
        ? `<section class="position-picker-panel" aria-labelledby="new-aed-position-title"><h3 id="new-aed-position-title">${tv("newPositionMapLabel")}</h3><p class="position-picker-help">${tv("newPositionMapHelp")}</p><div id="new-aed-position-map" class="position-map" role="application" tabindex="0" aria-label="${tv("newPositionMapLabel")}"></div><p class="position-map-coordinates" id="new-aed-position-coordinates" aria-live="polite">${tv("newPreviewCoordinates", { latitude: selectedPosition.latitude.toFixed(5), longitude: selectedPosition.longitude.toFixed(5) })}</p><div class="position-confirmation"><label for="new-aed-position-confirmed"><input id="new-aed-position-confirmed" type="checkbox" /><span id="new-aed-position-label">${tv("newPositionConfirm", { latitude: selectedPosition.latitude.toFixed(5), longitude: selectedPosition.longitude.toFixed(5) })}</span></label><button class="button button-primary" data-action="preview-new-aed">${tv("newPreviewAction")}</button></div></section>`
        : "";
      // Erste von zwei Bestätigungen für eine Neuanlage (siehe newEntryPanelOpen):
      // Erst dieser bewusste Tastendruck öffnet Karte und Positionsbestätigung.
      const startNewEntry = search.status !== "complete" || mayPrepareNewEntry
        ? ""
        : assessment.kind === "candidate-review"
          ? `<button class="button button-quiet" data-action="none-of-these">${tv("noneMatchAction")}</button>`
          : assessment.kind === "new-entry-eligible"
            ? `<button class="button button-quiet" data-action="start-new-entry">${tv("newEntryStart")}</button>`
            : "";
      // Übersichtskarte: zeigt den gesuchten Standort (roter Punkt) und die nummerierten Treffer.
      // Sie entfällt, sobald der Neuanlage-Bereich offen ist – dessen Karte zeigt dieselben Marker.
      const overviewMap = numbered && candidatesToShow.length > 0 && !mayPrepareNewEntry
        ? `<div id="candidate-overview-map" class="position-map" role="application" tabindex="0" aria-label="${tv("overviewMapLabel")}"></div><p class="position-map-privacy">${tv("overviewMapLegend")}</p>`
        : "";
      const retryWaitSeconds = state.retryAvailableAt === undefined ? 0 : Math.max(0, Math.ceil((state.retryAvailableAt - Date.now()) / 1000));
      const retry = search.status === "partial" || assessment.kind === "search-incomplete"
        ? retryWaitSeconds > 0
          ? `<p class="simulation-note search-wait" aria-live="off">${tv("searchWait", { seconds: retryWaitSeconds })}</p>`
          : `<button class="button button-secondary" data-action="retry-search">${tv("searchRetry")}</button>`
        : "";
      const locationSource = activeSearchLocationSource === "photo" ? "locationSourcePhoto" : activeSearchLocationSource === "map" ? "locationSourceMap" : "locationSourcePhone";
      // Bewusst keine technische Zeile mehr zu Datenstand und Snapshot-Kennung: Sie half bei der
      // Fehlersuche, aber nicht der Person vor Ort. Zu alte Daten sperrt der Server ohnehin.
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("searchTitle")}</h2><p>${escapeHtml(outcome)}</p><p class="supporting-copy">${tv(locationSource)}</p>${overviewMap}${candidates ? `<ul class="candidate-list">${candidates}</ul>` : ""}</div></div>${newEntryAction}${retry}${startNewEntry}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    }
    case "new-aed-preview": {
      const point = state.result.kind === "ready" ? state.result.position : state.returnState.location;
      const latitude = point.latitude.toFixed(5);
      const longitude = point.longitude.toFixed(5);
      const content = state.result.kind === "ready"
        ? `<p>${tv("newPreviewCoordinates", { latitude, longitude })}</p><strong>${tv("newPreviewTags")}</strong><ul>${Object.entries(state.result.tags).map(([key, value]) => `<li><code>${escapeHtml(key)}=${escapeHtml(value)}</code></li>`).join("")}</ul><p>${state.result.confirmedDifferentCandidateIds.length > 0 ? tv("newPreviewReviewedCandidates") : tv("newPreviewCaution")}</p>`
        : `<p>${tv(state.result.reason === "position-not-confirmed" ? "newPositionRequired" : state.result.reason === "search-found-candidate" ? "newPreviewFoundCandidate" : "newPreviewSearchInvalid")}</p>`;
      const copy = developmentWriteCopy[language];
      const canCreate = developmentSession && developmentWriteAvailable && state.result.kind === "ready";
      const statusCopy = state.writeStatus === "complete" ? copy.created : state.writeStatus ? copy[state.writeStatus] : "";
      const writeStatus = state.writeStatus ? `<p role="status" class="simulation-note">${statusCopy}</p>` : "";
      // Zweite von zwei Bestätigungen für eine Neuanlage: Ohne diesen Haken bleibt der
      // Speichern-Knopf gesperrt. Der Klick-Handler prüft den Haken zusätzlich noch einmal.
      const writeAction = canCreate && !state.writeStatus
        ? `<div class="position-confirmation"><label for="new-aed-absence-confirmed"><input id="new-aed-absence-confirmed" type="checkbox" /><span>${tv("newAbsenceConfirm")}</span></label></div><button class="button button-primary" data-action="create-development-node" disabled>${copy.createAction}</button>`
        : state.writeStatus === "uncertain" && state.operationId
          ? `<button class="button button-secondary" data-action="retry-development-write">${copy.retry}</button>`
          : "";
      // Der Hinweis „nur eine Vorschau“ steht nur, wenn es nichts zu speichern gibt. Mit Speichern-Knopf sagt dessen
      // Beschriftung („Testserver: AED eintragen“) schon, wohin die Änderung geht.
      // Der Hinweis „nur eine Vorschau“ gilt nur, wenn gar nichts gespeichert werden kann und kein Vorgang läuft. Nach einem
      // Speichern (oder währenddessen) wäre er falsch; dann sagt die Statusmeldung, was passiert ist.
      const noWriteNotice = !canCreate && !state.writeStatus ? `<p class="simulation-note">${tv("previewNoWrite")}</p>` : "";
      // „Zurück“ bleibt hier immer: Es führt zur Positionsbestätigung bzw. zur Suche, nicht nur zu Treffern.
      const navigation = state.writeStatus === "sending" || state.writeStatus === "uncertain" ? "" : `<button class="button button-quiet" data-action="back-to-search">${tv("previewBack")}</button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("newPreviewTitle")}</h2>${content}${noWriteNotice}${writeStatus}</div></div>${writeAction}${navigation}`;
    }
    case "osm-preview": {
      const { result } = state;
      const candidateId = state.candidateId;
      const candidate = state.returnState.search.candidates.find((item) => item.id === candidateId);
      const canWrite = developmentSession && developmentWriteAvailable && candidate?.osmType === "node" && result.kind === "ready";
      // Nur das Wesentliche: das neue Prüfdatum. Der bisherige Wert steht nur da, wenn es einen gibt.
      const content = result.kind === "ready"
        ? `<p><strong>${tv("previewNewDate", { date: result.changes[0].after })}</strong></p>${result.changes[0].before ? `<p>${tv("previewOldDate", { date: escapeHtml(result.changes[0].before) })}</p>` : ""}`
        : `<p>${tv("previewUnsupported")}</p>`;
      const copy = developmentWriteCopy[language];
      const writeStatus = state.writeStatus ? `<p role="status" class="simulation-note">${copy[state.writeStatus]}</p>` : "";
      const writeAction = canWrite && !state.writeStatus
        ? `<button class="button button-primary" data-action="save-development-check">${copy.action}</button>`
        : state.writeStatus === "uncertain" && state.operationId
          ? `<button class="button button-secondary" data-action="retry-development-write">${copy.retry}</button>`
          : "";
      // Nur wenn nichts gespeichert werden kann und kein Vorgang läuft; sonst wäre „nur eine Vorschau“ nach einem Speichern falsch.
      const noWriteNotice = !canWrite && !state.writeStatus ? `<p class="simulation-note">${tv("previewNoWrite")}</p>` : "";
      const recoverableWrite = state.writeStatus === "sending" || state.writeStatus === "uncertain";
      // „Zurück“ gibt es nur, wenn es mehrere Treffer zur Auswahl gab. Bei einem einzigen Treffer hätte es keine Bedeutung.
      // Gezählt wird wie in der Trefferliste: Bei „candidate-review“ die bewerteten Treffer, sonst alle Suchtreffer.
      const shownCandidates = state.returnState.assessment.kind === "candidate-review" ? state.returnState.assessment.candidates.length : state.returnState.search.candidates.length;
      const hasOtherCandidates = shownCandidates > 1;
      const navigation = recoverableWrite ? "" : `${hasOtherCandidates ? `<button class="button button-quiet" data-action="back-to-candidates">${tv("previewBack")}</button>` : ""}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("previewTitle")}</h2><p><strong>${escapeHtml(state.candidateLabel)}</strong></p>${content}${noWriteNotice}${writeStatus}</div></div>${writeAction}${navigation}`;
    }
    case "development-write-recovery": {
      const copy = developmentWriteCopy[language];
      const retry = state.writeStatus === "uncertain"
        ? `<button class="button button-secondary" data-action="retry-development-write">${copy.retry}</button>`
        : "";
      // Bei einer Neuanlage steht die Position da; bei einem Prüfdatum genügt die Bezeichnung des AED.
      const targetLink = state.request.kind === "check-date" ? "" : `<p>${state.request.latitude.toFixed(5)}, ${state.request.longitude.toFixed(5)}</p>`;
      const recoveryMessage = state.request.kind === "create-node" && state.writeStatus === "complete" ? copy.created : copy[state.writeStatus];
      return `<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv("previewTitle")}</h2><p><strong>${escapeHtml(state.request.candidateLabel)}</strong></p>${targetLink}<p class="simulation-note" role="status">${recoveryMessage}</p></div></div>${retry}`;
    }
    case "candidate-error": {
      const errorKey: Record<typeof state.reason, FlowMessageKey> = {
        "location-unavailable": "locationUnavailable", "location-denied": "locationDenied", "location-uncertain": "locationUncertain",
        "sign-in": "errorSignIn", "rate-limited": "searchRateLimited", "service-unavailable": "searchUnavailable", failed: "searchFailed", "invalid-response": "errorInvalidResponse",
      };
      const retryWaitSeconds = state.retryAvailableAt === undefined ? 0 : Math.max(0, Math.ceil((state.retryAvailableAt - Date.now()) / 1000));
      const retry = state.reason === "sign-in"
        ? ""
        : retryWaitSeconds > 0
          ? `<p class="simulation-note search-wait" aria-live="off">${tv("searchWait", { seconds: retryWaitSeconds })}</p>`
          : `<button class="button button-secondary" data-action="retry-search">${tv("searchRetry")}</button>`;
      const locationSource = activeSearchLocationSource === "photo" ? "locationSourcePhoto" : activeSearchLocationSource === "map" ? "locationSourceMap" : "locationSourcePhone";
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv("searchTitle")}</h2><p>${tv(errorKey[state.reason])}</p><p class="supporting-copy">${tv(locationSource)}</p></div></div>${retry}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    }
    case "clarification":
      return `${photoMarkup}${demoNotice()}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${t(state.reason === "multiple" ? "multipleTitle" : "signTitle")}</h2><p>${t(state.reason === "multiple" ? "multipleBody" : "signBody")}</p></div></div>${state.reason === "multiple" ? `<button class="button button-secondary" data-action="candidate-main-entrance">${t("candidateMainEntrance")}</button><button class="button button-secondary" data-action="candidate-sports-hall">${t("candidateSportsHall")}</button>` : ""}<button class="button button-quiet" data-action="retake">${t("clarifyAgain")}</button>`;
    case "proposal":
      return `${photoMarkup}${demoNotice()}<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><p class="eyebrow">${t(state.candidateId === "main-entrance" ? "candidateMainEntrance" : state.candidateId === "sports-hall" ? "candidateSportsHall" : state.proposal === "existing" ? "existingDetail" : "newDetail")}</p><h2>${t(state.proposal === "existing" ? "existingTitle" : "newTitle")}</h2><p>${t(state.proposal === "existing" ? "existingBody" : "newBody")}</p></div></div><button class="button button-primary" data-action="confirm">${icon("check")}<span>${t(state.proposal === "existing" ? "confirmExisting" : "confirmNew")}</span></button><button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
    case "sending":
      return `${photoMarkup}${demoNotice()}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${t("sending")}</span></div>`;
    case "checking-status":
      return `${photoMarkup}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${t("checkingStatus")}</span></div>`;
    case "saved":
      return `${photoMarkup}${demoNotice()}<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><h2>${t("savedTitle")}</h2><p>${t(state.proposal === "existing" ? "savedExisting" : "savedNew")}</p></div></div><p class="simulation-note">${t("savedBody")}</p><button class="button button-primary" data-action="reset">${t("startOver")}</button>`;
    case "unclear-error":
      return `${photoMarkup}${demoNotice()}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${t("unclearTitle")}</h2><p>${t("unclearBody")}</p></div></div><button class="button button-secondary" data-action="recover">${t("checkStatus")}</button>`;
    case "retryable-error":
      return `${photoMarkup}${demoNotice()}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${t("retryTitle")}</h2><p>${t("retryBody")}</p></div></div><button class="button button-secondary" data-action="analyze">${t("retry")}</button><button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
  }
}

function icon(kind: "camera" | "search" | "check"): string {
  const paths = {
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.5 15.5 4 4"/>',
    check: '<path d="m5 12 4.3 4.3L19 6.8"/>',
  };
  return `<svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}

function render(restoreFlowFocus = false): void {
  activePositionPicker?.destroy();
  activePositionPicker = undefined;
  const authenticated = accountState === "signed-in";
  const isReady = state.kind === "ready";
  document.documentElement.lang = language;
  document.title = `${t("appName")} · ${t("tagline")}`;
  app!.innerHTML = `
    <div class="page-shell">
      <header class="topbar"><div class="brand-group"><a class="brand" href="/" aria-label="${t("appName")}" ${hasUnresolvedSave(state) ? 'aria-disabled="true"' : ""}><span>${t("appName")}</span></a>${connectionLamp()}</div><div class="topbar-actions"><button class="info-link" id="open-info" type="button"><span class="info-mark" aria-hidden="true">i</span><span>${t("aboutButton")}</span></button><label class="language-picker"><span class="sr-only">${t("language")}</span><select id="language" aria-label="${t("language")}">${supportedLanguages.map((code) => `<option value="${code}" ${language === code ? "selected" : ""}>${languageNames[code]}</option>`).join("")}</select><span class="language-globe" aria-hidden="true">◎</span></label></div></header>
      ${authenticated ? `<main>
        <section class="hero ${isReady ? "" : "hero-compact"}"><div class="hero-kicker"><span></span>${t("eyebrow")}</div><h1>${isReady ? t("title") : state.kind === "analyzing" || state.kind === "photo-checking" || state.kind === "candidate-searching" || state.kind === "sending" ? t("checking") : t("tagline")}</h1>${isReady ? `<p>${t("intro")}</p>` : ""}</section>
        <section class="capture-card" aria-live="polite" aria-atomic="false">
          <div class="capture-content">${isReady ? `<div class="empty-illustration" aria-hidden="true"><span class="device-card"><span class="device-heart">♥</span><span class="device-zap">ϟ</span></span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>` : statusContent()}</div>
          ${isReady ? `<div class="capture-actions"><label class="button button-primary camera-label">${icon("camera")}<span>${t("camera")}</span><input id="camera-input" type="file" accept="image/*" capture="environment" /></label><label class="button button-secondary camera-label">${t("choosePhoto")}<input id="file-input" type="file" accept="image/*" /></label><p class="supporting-copy">${photoCheckAvailable ? tv("photoCheckNotice") : t("privacy")}</p></div>` : ""}
          ${isReady ? `<details class="demo-panel"><summary>${t("demo")}</summary><h2>${t("testStepsTitle")}</h2><p>${t("testSteps")}</p><label for="scenario">${t("scenario")}</label><select id="scenario">${(Object.keys(scenarioKeys) as DemoScenario[]).map((key) => `<option value="${key}" ${scenario === key ? "selected" : ""}>${t(scenarioKeys[key])}</option>`).join("")}</select><label class="diagnostics-opt-in" for="diagnostics-enabled"><input id="diagnostics-enabled" type="checkbox" ${diagnosticsEnabled ? "checked" : ""}><span><strong>${t("testDiagnostics")}</strong><small>${t("testDiagnosticsPrivacy")}</small></span></label></details>` : ""}
        </section>
      </main>${accountPanel()}` : `<main class="login-main">${loginEntry()}</main>`}
      <footer><span>${t("sourceNote")}</span><span class="demo-badge">DEMO</span><span class="build-mark" id="build-mark">${escapeHtml(buildVersionText())}</span></footer>
      <dialog class="info-dialog" id="info-dialog" aria-labelledby="info-title" aria-describedby="info-intro">
        <div class="info-dialog-content">
          <div class="info-dialog-header"><div><p class="eyebrow">${t("appName")}</p><h2 id="info-title">${t("aboutTitle")}</h2></div><form method="dialog"><button class="dialog-close" aria-label="${t("closeInfo")}">×</button></form></div>
          <p class="info-intro" id="info-intro">${t("aboutIntro")}</p>
          <section class="info-section"><h3>${t("demoInfoTitle")}</h3><p>${t("demoInfoBody")}</p><h3>${t("demoLimitsTitle")}</h3><p>${t("demoLimitsBody")}</p></section>
          <section class="info-section roadmap-section"><h3>${t("roadmapTitle")}</h3><p>${t("roadmapIntro")}</p><ol class="roadmap-list">
            <li class="roadmap-item roadmap-current"><span class="roadmap-status">${t("roadmapNow")}</span><h4>${t("roadmapDemoTitle")}</h4><p>${t("roadmapDemoBody")}</p></li>
            <li class="roadmap-item roadmap-next"><span class="roadmap-status">${t("roadmapNext")}</span><h4>${t("roadmapMobileTitle")}</h4><p>${t("roadmapMobileBody")}</p></li>
            <li class="roadmap-item"><span class="roadmap-status">${t("roadmapNow")}</span><h4>${t("roadmapImagesTitle")}</h4><p>${t("roadmapImagesBody")}</p></li>
            <li class="roadmap-item"><span class="roadmap-status">${t("roadmapNext")}</span><h4>${t("roadmapApiTitle")}</h4><p>${t("roadmapApiBody")}</p></li>
            <li class="roadmap-item"><span class="roadmap-status">${t("roadmapLater")}</span><h4>${t("roadmapOsmTitle")}</h4><p>${t("roadmapOsmBody")}</p></li>
          </ol></section>
          ${authenticated ? `<section class="info-section account-section"><h3>${developmentSession ? t("accountDevSignedIn") : t("accountSignedIn")}</h3><p>${developmentSession ? t("accountDevNotice") : t("accountIdentityOnly")}</p><button class="account-button" id="osm-sign-out" type="button">${t("accountSignOut")}</button></section>` : ""}
          <label class="sound-toggle"><input type="checkbox" id="success-sound-toggle" ${successSound.isEnabled() ? "checked" : ""} /><span>${tv("soundToggle")}</span></label>
          <p class="build-version" id="build-version">${escapeHtml(buildVersionText())}</p>
        </div>
      </dialog>
    </div>`;

  if (state.kind === "location-map") {
    const mapContainer = app!.querySelector<HTMLDivElement>("#search-location-map");
    if (mapContainer) {
      activePositionPicker = createPositionPicker(mapContainer, mapLocationOverride ?? state.center, {
        mapLabel: tv("chooseMapLocation"),
        zoomInLabel: tv("newPositionMapZoomIn"),
        zoomOutLabel: tv("newPositionMapZoomOut"),
        tileErrorLabel: tv("newPositionMapTileError"),
        initialZoom: state.initialZoom,
        onPositionChange(position) {
          mapLocationOverride = position;
          const coordinates = app!.querySelector<HTMLParagraphElement>("#search-location-coordinates");
          if (coordinates) coordinates.textContent = tv("mapLocationCoordinates", { latitude: position.latitude.toFixed(5), longitude: position.longitude.toFixed(5) });
          updateMapSearchButton();
        },
        onZoomChange(zoom) {
          if (state.kind === "location-map") state.initialZoom = zoom;
          updateMapSearchButton();
        },
      });

      function updateMapSearchButton(): void {
        const confirmButton = app!.querySelector<HTMLButtonElement>('[data-action="confirm-map-location"]');
        if (confirmButton) confirmButton.disabled = mapLocationOverride === undefined || (state.kind === "location-map" && (state.initialZoom ?? 19) < minimumMapSearchZoom);
      }
    }
  }

  if (state.kind === "candidate-result" && !newEntryPanelOpen(state)) {
    // Übersichtskarte bei Treffern: nur zum Ansehen. Verschieben ändert keine Auswahl,
    // deshalb macht onPositionChange hier bewusst nichts.
    const overviewContainer = app!.querySelector<HTMLDivElement>("#candidate-overview-map");
    if (overviewContainer) {
      const markers = reviewedCandidateMarkers(state);
      const bounds = overviewContainer.getBoundingClientRect();
      activePositionPicker = createPositionPicker(overviewContainer, state.location, {
        mapLabel: tv("overviewMapLabel"),
        zoomInLabel: tv("newPositionMapZoomIn"),
        zoomOutLabel: tv("newPositionMapZoomOut"),
        tileErrorLabel: tv("newPositionMapTileError"),
        // So weit herauszoomen, dass Standort und alle Treffer gleichzeitig sichtbar sind.
        initialZoom: zoomToFitMarkers(state.location, markers, bounds.width || 300, bounds.height || 225),
        // Der gesuchte Standort ist hier ein fest verankerter roter Marker und NICHT der
        // Bildmittelpunkt. So bleibt er beim Verschieben oder Zoomen an der richtigen Stelle.
        markers: [{ position: state.location, label: "", kind: "origin" }, ...markers],
        hideCrosshair: true,
        onPositionChange() {},
      });
    }
  }

  if (newEntryPanelOpen(state) && state.kind === "candidate-result") {
    const mapContainer = app!.querySelector<HTMLDivElement>("#new-aed-position-map");
    if (mapContainer) {
      activePositionPicker = createPositionPicker(mapContainer, newAedPositionOverride ?? state.location, {
        // Bereits eingetragene AEDs bleiben beim Setzen des neuen Punkts sichtbar.
        markers: reviewedCandidateMarkers(state),
        mapLabel: tv("newPositionMapLabel"),
        zoomInLabel: tv("newPositionMapZoomIn"),
        zoomOutLabel: tv("newPositionMapZoomOut"),
        tileErrorLabel: tv("newPositionMapTileError"),
        onPositionChange(position) {
          newAedPositionOverride = position;
          const confirmation = app!.querySelector<HTMLInputElement>("#new-aed-position-confirmed");
          if (confirmation) confirmation.checked = false;
          const coordinates = app!.querySelector<HTMLParagraphElement>("#new-aed-position-coordinates");
          if (coordinates) coordinates.textContent = tv("newPreviewCoordinates", { latitude: position.latitude.toFixed(5), longitude: position.longitude.toFixed(5) });
          const label = app!.querySelector<HTMLSpanElement>("#new-aed-position-label");
          if (label) label.textContent = tv("newPositionConfirm", { latitude: position.latitude.toFixed(5), longitude: position.longitude.toFixed(5) });
        },
      });
    }
  }

  // Zweite Bestätigung in der Neuanlage-Vorschau: Der Speichern-Knopf wird erst aktiv,
  // wenn der Haken „vor Ort geprüft“ gesetzt ist, und wieder gesperrt, wenn er entfernt wird.
  const absenceConfirmation = app!.querySelector<HTMLInputElement>("#new-aed-absence-confirmed");
  absenceConfirmation?.addEventListener("change", () => {
    const createButton = app!.querySelector<HTMLButtonElement>('[data-action="create-development-node"]');
    if (createButton) createButton.disabled = !absenceConfirmation.checked;
  });

  document.querySelector<HTMLButtonElement>("#open-info")?.addEventListener("click", () => {
    document.querySelector<HTMLDialogElement>("#info-dialog")?.showModal();
  });
  document.querySelector<HTMLButtonElement>("#connection-lamp")?.addEventListener("click", openAccountFromLamp);
  document.querySelector<HTMLInputElement>("#success-sound-toggle")?.addEventListener("change", (event) => {
    const enabled = (event.target as HTMLInputElement).checked;
    successSound.setEnabled(enabled);
    // Beim Einschalten einmal vorspielen: So hört die Person sofort, wie es klingt, und der Ton ist freigeschaltet.
    if (enabled) {
      successSound.prepare();
      successSound.play();
    }
  });
  document.querySelector<HTMLAnchorElement>(".brand")?.addEventListener("click", (event) => {
    if (!hasUnresolvedSave(state)) return;

    // A reload here would erase the only copy of an unresolved draft in this in-memory prototype.
    event.preventDefault();
    if (state.kind === "unclear-error") app!.querySelector<HTMLButtonElement>('[data-action="recover"]')?.focus();
    else focusCurrentState();
  });
  document.querySelector<HTMLSelectElement>("#language")?.addEventListener("change", (event) => {
    language = (event.currentTarget as HTMLSelectElement).value as Language;
    localStorage.setItem("aedjaeger-language", language);
    render();
    // Rendering replaces the select node, so return keyboard focus to its translated replacement.
    app!.querySelector<HTMLSelectElement>("#language")?.focus();
  });
  document.querySelector<HTMLSelectElement>("#scenario")?.addEventListener("change", (event) => {
    scenario = (event.currentTarget as HTMLSelectElement).value as DemoScenario;
    // Choosing a fixture is itself an explicit request to use the local simulation.
    demoMode = true;
  });
  document.querySelector<HTMLInputElement>("#diagnostics-enabled")?.addEventListener("change", (event) => {
    diagnosticsEnabled = (event.currentTarget as HTMLInputElement).checked;
    diagnosticFlowId = diagnosticsEnabled ? crypto.randomUUID() : undefined;
    if (diagnosticsEnabled) recordDiagnostic("test_run_started");
  });
  document.querySelector<HTMLInputElement>("#camera-input")?.addEventListener("change", onPhotoSelected);
  document.querySelector<HTMLInputElement>("#file-input")?.addEventListener("change", onPhotoSelected);
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action, button)));
  bindAccountPanel();
  renderUpdateBanner();

  if (restoreFlowFocus) focusCurrentState();
}

/**
 * Sagt, ob ein Neuladen jetzt etwas Laufendes zerstören würde.
 * Beim Speichern (auch bei unklarem Ergebnis), beim Foto-Prüfen und bei einer offenen Wiederherstellung
 * bleibt der Knopf gesperrt, damit kein Vorgang doppelt oder halb ausgeführt wird.
 */
function reloadBlocked(): boolean {
  return hasUnresolvedSave(state)
    || state.kind === "photo-checking"
    || (state.kind === "development-write-recovery" && (state.writeStatus === "uncertain" || state.writeStatus === "sending"));
}

/**
 * Zeigt oder entfernt den Hinweis „Neue Version verfügbar“.
 *
 * Das Banner liegt bewusst AUSSERHALB von #app. render() baut #app oft komplett neu auf; ein Banner
 * darin würde bei jedem Neuaufbau verschwinden oder den Tastaturfokus verlieren. Hier wird es nur
 * dann neu geschrieben, wenn sich sein Inhalt ändert.
 *
 * Neu geladen wird nie automatisch: Ein Neuladen verwirft das aktuelle Foto und den Entwurf. Die Person
 * entscheidet, und das Banner sagt ihr, was dabei verloren geht.
 */
let renderedUpdateBanner = "";
function renderUpdateBanner(): void {
  let banner = document.querySelector<HTMLElement>("#update-banner");
  if (!updateAvailable) {
    banner?.remove();
    renderedUpdateBanner = "";
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "update-banner";
    banner.className = "update-banner";
    banner.setAttribute("role", "status");
    banner.addEventListener("click", (event) => {
      // Der Zustand wird beim Klick erneut geprüft: Er kann sich seit dem Zeichnen geändert haben.
      if ((event.target as HTMLElement).closest(".update-banner-button") && !reloadBlocked()) window.location.reload();
    });
    app!.before(banner);
    renderedUpdateBanner = "";
  }
  const blocked = reloadBlocked();
  const note = blocked ? tv("updateWaitSave") : hasActivePhotoDraft(state) ? tv("updateLosesPhoto") : "";
  const markup = `<span>${tv("updateAvailable")}${note ? ` ${note}` : ""}</span><button class="update-banner-button" type="button" ${blocked ? "disabled" : ""}>${tv("updateReload")}</button>`;
  // Nur schreiben, wenn sich etwas geändert hat, damit der Fokus auf dem Knopf erhalten bleibt.
  if (markup !== renderedUpdateBanner) {
    banner.innerHTML = markup;
    renderedUpdateBanner = markup;
  }
}

function bindAccountPanel(): void {
  app!.querySelector<HTMLButtonElement>("#osm-sign-out")?.addEventListener("click", () => { void signOutFromOSM(); });
  app!.querySelector<HTMLButtonElement>("#osm-session-retry")?.addEventListener("click", () => { void retryOSMSessionStatus(); });
}

function updateAccountPanel(focusSelector?: string): void {
  const currentPanel = app!.querySelector(".account-panel");
  if (!currentPanel) return;
  const replacement = document.createElement("div");
  replacement.innerHTML = accountPanel();
  const nextPanel = replacement.firstElementChild;
  if (!nextPanel) return;
  currentPanel.replaceWith(nextPanel);
  bindAccountPanel();
  if (focusSelector) {
    const focusTarget = nextPanel instanceof HTMLElement && nextPanel.matches(focusSelector) ? nextPanel : nextPanel.querySelector<HTMLElement>(focusSelector);
    if (focusTarget) focusTarget.focus();
    else if (nextPanel instanceof HTMLElement) nextPanel.focus();
  }
}

/**
 * Fragt den Anmeldestatus beim Server ab und zeichnet die App neu.
 * @param afterLogout true direkt nach „Abmelden“: Meldet der Server dann NOCH „angemeldet“, gilt die Abmeldung als
 *   gescheitert (Fehlermeldung mit Wiederholen-Knopf). Die App zeigt nie still wieder „angemeldet“, wenn jemand
 *   „Abmelden“ getippt hat.
 */
async function refreshAccountState(focusSelector?: string, afterLogout = false): Promise<void> {
  try {
    const status = await loadOSMSession();
    const failedOAuthReturn = oauthReturnFailed;
    if (failedOAuthReturn) {
      oauthReturnFailed = false;
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.delete("login");
      history.replaceState(null, "", `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
    }
    productionLoginAvailable = status.loginAvailable;
    developmentLoginAvailable = status.developmentLoginAvailable;
    developmentSession = status.developmentSession;
    developmentWriteAvailable = status.developmentWriteAvailable;
    photoCheckAvailable = status.photoCheckAvailable;
    const stillSignedInAfterLogout = afterLogout && status.authenticated;
    if (status.authenticated && !stillSignedInAfterLogout) void askForLocationOnceAfterSignIn();
    accountState = stillSignedInAfterLogout ? "logout-error" : status.authenticated ? "signed-in" : !productionLoginAvailable && !developmentLoginAvailable ? "not-configured" : failedOAuthReturn ? "login-error" : "signed-out";
    if (state.kind === "photo" && accountState === "not-configured") recordDiagnostic("live_flow_blocked");
  } catch {
    // Local Vite previews and an unavailable Worker must not imply that an OSM session exists.
    accountState = "connection-error";
  }
  // Rendering the whole app here enforces the gate after sign-in, expiry, and logout.
  render();
  if (focusSelector === "next-action") {
    const nextActionSelector = accountState === "connection-error" ? "#osm-session-retry"
      : accountState === "signed-in" ? "#camera-input"
        : accountState === "signed-out" || accountState === "login-error" ? "#osm-sign-in"
          : "#login-title";
    app!.querySelector<HTMLElement>(nextActionSelector)?.focus();
  } else if (focusSelector) {
    app!.querySelector<HTMLElement>(focusSelector)?.focus();
  }
}

async function signOutFromOSM(): Promise<void> {
  accountState = "checking";
  render();
  try {
    await endOSMSession();
    await refreshAccountState("next-action", true);
  } catch {
    accountState = "logout-error";
    render();
    app!.querySelector<HTMLElement>("#login-title")?.focus();
  }
}

async function retryOSMSessionStatus(): Promise<void> {
  accountState = "checking";
  render();
  await refreshAccountState("next-action");
}

/** Sends one explicitly confirmed test-server edit; a stable operation ID protects uncertain retries. */
async function submitDevelopmentWrite(requestBody: DevelopmentWriteRequest): Promise<void> {
  try {
    const isCheckDate = requestBody.kind === "check-date";
    const response = await fetch(isCheckDate ? "/api/osm/development/check-date" : "/api/osm/development/create-node", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify(requestBody.kind === "check-date" ? {
        operation_id: requestBody.operationId, confirmed: true, target: requestBody.target,
        expected_version: requestBody.expectedVersion, expected_check_date: requestBody.expectedCheckDate, observed_on: requestBody.observedOn,
      } : {
        operation_id: requestBody.operationId, confirmed: true, latitude: requestBody.latitude, longitude: requestBody.longitude,
        observed_on: requestBody.observedOn, location_description: requestBody.locationDescription,
        confirmed_different_candidate_ids: requestBody.confirmedDifferentCandidateIds,
      }),
    });
    const payload: unknown = await response.json();
    const matchesCurrentRequest = (state.kind === "new-aed-preview" && state.operationId === requestBody.operationId)
      || (state.kind === "osm-preview" && state.operationId === requestBody.operationId)
      || (state.kind === "development-write-recovery" && state.request.operationId === requestBody.operationId);
    if (!matchesCurrentRequest) return;
    if (response.ok && isDevelopmentWriteResponse(payload, "complete")) {
      setDevelopmentWriteStatus(requestBody.operationId, "complete");
      clearPendingDevelopmentCheck();
      // Nur hier, bei vom Server ausdrücklich bestätigtem Erfolg, erklingt der Ton. Er ändert nichts am Ablauf.
      successSound.play();
    } else if (response.status === 409) {
      setDevelopmentWriteStatus(requestBody.operationId, "conflict");
      clearPendingDevelopmentCheck();
    } else if (response.status === 202 || response.status >= 500 || !response.ok && !isRecord(payload)) {
      setDevelopmentWriteStatus(requestBody.operationId, "uncertain");
    } else {
      setDevelopmentWriteStatus(requestBody.operationId, "failed");
      clearPendingDevelopmentCheck();
    }
  } catch {
    setDevelopmentWriteStatus(requestBody.operationId, "uncertain");
  }
  if ((state.kind === "new-aed-preview" && state.operationId === requestBody.operationId)
    || (state.kind === "osm-preview" && state.operationId === requestBody.operationId)
    || (state.kind === "development-write-recovery" && state.request.operationId === requestBody.operationId)) render(true);
}

function setDevelopmentWriteStatus(operationId: string, writeStatus: "uncertain" | "sending" | "complete" | "conflict" | "failed"): void {
  if (state.kind === "new-aed-preview" && state.operationId === operationId) {
    state = { ...state, writeStatus };
  } else if (state.kind === "osm-preview" && state.operationId === operationId) {
    state = { ...state, writeStatus };
  } else if (state.kind === "development-write-recovery" && state.request.operationId === operationId) {
    state = { ...state, writeStatus };
  }
}

function isDevelopmentWriteResponse(value: unknown, expectedStatus: string): value is { status: string; version: number } {
  return isRecord(value) && value.status === expectedStatus && Number.isSafeInteger(value.version) && (value.version as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function focusCurrentState(): void {
  if (accountState !== "signed-in") {
    const loginControl = app!.querySelector<HTMLElement>("#osm-session-retry, #osm-sign-in, #login-title");
    loginControl?.focus();
    return;
  }
  const focusTargets: Record<FlowState["kind"], string> = {
    ready: "#camera-input",
    photo: '[data-action="confirm-sighting"], [data-action="check-photo"]',
    "photo-checking": ".loading-row",
    "photo-rejected": ".result-message h2",
    "photo-date": "#photo-observed-on",
    analyzing: ".loading-row",
    "location-choice": ".result-message h2",
    "location-map": ".result-message h2",
    "candidate-searching": ".loading-row",
    "candidate-result": ".result-message h2",
    "osm-preview": ".result-message h2",
    "development-write-recovery": ".result-message h2",
    "new-aed-preview": ".result-message h2",
    "candidate-error": ".result-message h2",
    clarification: ".result-message h2",
    proposal: '[data-action="confirm"]',
    sending: ".loading-row",
    "checking-status": ".loading-row",
    saved: '[data-action="reset"]',
    "unclear-error": ".result-message h2",
    "retryable-error": ".result-message h2",
  };
  const target = app!.querySelector<HTMLElement>(focusTargets[state.kind]);
  if (!target) return;

  // Newly rendered headings and status messages are not normally tabbable; temporary focus lets
  // keyboard and screen-reader users continue at the result instead of falling back to the page.
  if (target.matches("h2, .loading-row")) target.tabIndex = -1;
  target.focus();
}

async function onPhotoSelected(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const selectionVersion = ++photoSelectionVersion;
  // Block OAuth as soon as the chooser returns a file; decoding can take long enough to lose it.
  photoSelectionPending = true;
  updateAccountPanel();
  if (!file.type.startsWith("image/")) {
    photoSelectionPending = false;
    updateAccountPanel();
    window.alert(t("cameraError"));
    return;
  }

  // A MIME type is only a browser hint. Decode the actual bytes before offering an AED workflow.
  const photoUrl = URL.createObjectURL(file);
  let photoLocation: SearchLocation | undefined;
  let photoDate: string | undefined;
  let photoCapturedAtMs: number | undefined;
  try {
    const image = new Image();
    image.src = photoUrl;
    await image.decode();
    // Read only GPS and capture date locally; neither metadata nor image leaves the device.
    photoLocation = await readPhotoLocation(file);
    const capture = await readPhotoCapture(file);
    photoDate = capture?.date;
    // Zeitpunkt der Aufnahme für die „gerade eben“-Prüfung:
    // 1. Die EXIF-Aufnahmezeit hat Vorrang – sie stammt von der Kamera selbst.
    // 2. Fehlt sie, zählt NUR bei „AED fotografieren“ (Kamera-Eingabe) die Dateizeit, denn die
    //    Datei ist dann soeben entstanden. Bei „Foto auswählen“ sagt die Dateizeit nichts über
    //    die Aufnahme aus (z. B. ein gerade erst gespeichertes altes Bild) und wird ignoriert.
    photoCapturedAtMs = capture?.timeMs ?? (input.id === "camera-input" ? file.lastModified : undefined);
  } catch {
    URL.revokeObjectURL(photoUrl);
    if (selectionVersion === photoSelectionVersion) {
      photoSelectionPending = false;
      updateAccountPanel();
      window.alert(t("cameraError"));
    }
    return;
  }
  if (selectionVersion !== photoSelectionVersion) {
    URL.revokeObjectURL(photoUrl);
    return;
  }

  photoSelectionPending = false;
  clearTimers();
  releasePhoto();
  // The open disclosure is an explicit user choice; carry that preview mode into this photo.
  demoMode = demoMode || (document.querySelector<HTMLDetailsElement>(".demo-panel")?.open ?? false);
  selectedPhotoLocation = photoLocation;
  // Merken, ob und wann das Foto mit der Kamera der App entstand. Ob der Handy-Standort fehlendes Foto-GPS ersetzen
  // darf, wird erst bei der Fortsetzung geprüft (die Person kann zwischendurch lange warten oder weggehen).
  selectedPhotoFromCamera = input.id === "camera-input";
  selectedPhotoCapturedAtMs = photoCapturedAtMs;
  // Für die optionale Fotoprüfung merken: die Datei und eine neue Anfragekennung pro Foto.
  selectedPhotoFile = file;
  photoCheckRequestId = createVisionRequestId();
  const today = localCalendarDate();
  observedOn = photoDate ?? today;
  // Ob nach dem Beobachtungsdatum gefragt wird, entscheidet photoDateNeedsConfirmation:
  // Ein gerade eben aufgenommenes Foto ohne eigenes Datum gilt als heutige Beobachtung. Nennt das
  // Foto dagegen selbst einen anderen Tag als heute, bleibt die ausdrückliche Bestätigung bestehen.
  photoDateRequiresConfirmation = photoDateNeedsConfirmation(photoDate, today, isFreshCapture(photoCapturedAtMs));
  activeSearchLocation = undefined;
  activeSearchLocationSource = undefined;
  mapLocationOverride = undefined;
  recordDiagnostic("photo_selected");
  if (accountState === "not-configured") recordDiagnostic("live_flow_blocked");
  state = { kind: "photo", photoUrl };
  render(true);
}

async function handleAction(action: string | undefined, source?: HTMLElement): Promise<void> {
  if (action === "retake") {
    if (hasUnresolvedSave(state)) return;
    recordDiagnostic("test_run_abandoned");
    clearDiagnosticConsent();
    clearTimers();
    releasePhoto();
    demoMode = false;
    state = { kind: "ready" };
  } else if (action === "analyze") {
    const photoUrl = getPhotoUrl(state);
    if (!photoUrl || !(state.kind === "photo" || state.kind === "retryable-error")) return;
    demoMode = true;
    recordDiagnostic("demo_started");
    state = { kind: "analyzing", photoUrl };
    clearTimers();
    analysisTimer = window.setTimeout(() => {
      state = analysisResult(scenario, photoUrl);
      recordDiagnostic("demo_result_shown");
      render(true);
    }, 700);
  } else if (action === "confirm-sighting" && state.kind === "photo" && accountState === "signed-in") {
    // This is a human sighting confirmation only. It neither claims an automatic recognition
    // result nor permits an OSM edit; the separate OSM proposal and confirmation remain later.
    proceedAfterSighting(state.photoUrl);
  } else if (action === "check-photo" && state.kind === "photo" && accountState === "signed-in" && photoCheckAvailable) {
    void runPhotoCheck(state.photoUrl);
  } else if (action === "start-photo-override" && state.kind === "photo-rejected" && state.overrideStep === undefined && accountState === "signed-in") {
    // Erste Bestätigung der Ausnahme: Es folgt noch eine Rückfrage, nichts geht schon weiter.
    state = { ...state, overrideStep: "confirm" };
    render(true);
  } else if (action === "confirm-photo-override" && state.kind === "photo-rejected" && state.overrideStep === "confirm" && accountState === "signed-in") {
    // Zweite Bestätigung: Die Person versichert, dass AED oder Gehäuse zu sehen ist, obwohl die Prüfung keinen erkannt hat.
    proceedAfterSighting(state.photoUrl);
  } else if (action === "confirm-photo-date" && state.kind === "photo-date" && accountState === "signed-in") {
    const dateInput = app!.querySelector<HTMLInputElement>("#photo-observed-on");
    if (!dateInput || !isValidObservedDate(dateInput.value)) return;
    observedOn = dateInput.value;
    photoDateRequiresConfirmation = false;
    continueAfterSighting(state.photoUrl);
  } else if (action === "use-phone-location" && state.kind === "location-choice") {
    activeSearchLocation = undefined;
    activeSearchLocationSource = "phone";
    void runNearbySearch(state.photoUrl);
  } else if (action === "choose-map-location" && state.kind === "location-choice") {
    // Manual map selection must work even when the person denied phone location.
    // Start at a neutral, clearly disclosed map view instead of inferring the device location.
    mapLocationOverride = undefined;
    activeSearchLocationSource = "map";
    state = {
      kind: "location-map",
      photoUrl: state.photoUrl,
      center: { latitude: 50, longitude: 10, accuracyMeters: 1_000 },
      initialZoom: 6,
    };
  } else if (action === "confirm-map-location" && state.kind === "location-map") {
    const position = mapLocationOverride ?? state.center;
    activeSearchLocationSource = "map";
    void runNearbySearch(state.photoUrl, { ...position, accuracyMeters: 100 });
  } else if (action === "retry-search" && (state.kind === "candidate-error" || (state.kind === "candidate-result" && (state.search.status === "partial" || state.assessment.kind === "search-incomplete")))) {
    // A photo's embedded point is fixed, but a phone GPS fix can improve after the user moves.
    // A chosen photo/map point is stable across retries. Phone GPS is deliberately reacquired
    // because the user may have moved since the previous attempt.
    // Ausnahme: Hat die App den Handy-Standort selbst eingesetzt („phone-auto“), gilt er nur, solange das Foto frisch ist.
    // Wer die App nach einem Fehlschlag liegen lässt und woanders erneut versucht, bekommt die ausdrückliche Standortwahl.
    const autoLocationExpired = activeSearchLocationSource === "phone-auto"
      && !(phoneLocationPermission === "granted" && phoneLocationFitsPhoto({ fromCamera: selectedPhotoFromCamera, capturedAtMs: selectedPhotoCapturedAtMs }));
    if (autoLocationExpired) {
      if (searchRetryTimer) window.clearTimeout(searchRetryTimer);
      searchRetryTimer = undefined;
      activeSearchLocation = undefined;
      activeSearchLocationSource = undefined;
      state = { kind: "location-choice", photoUrl: state.photoUrl };
      render(true);
    } else {
      const retryLocation = activeSearchLocationSource === "photo" || activeSearchLocationSource === "map"
        ? activeSearchLocation
        : undefined;
      void runNearbySearch(state.photoUrl, retryLocation);
    }
  } else if (action === "preview-candidate" && state.kind === "candidate-result") {
    const candidateId = source?.dataset.candidateId;
    const candidate = state.search.candidates.find((item) => item.id === candidateId);
    if (!candidate || !candidateId) return;
    const result = previewExistingAedCheck(candidate, true, observedOn);
    const candidateLabel = candidate.tags.name || candidate.tags["defibrillator:location"] || candidate.id;
    state = { kind: "osm-preview", photoUrl: state.photoUrl, candidateId, candidateLabel, result, returnState: state };
  } else if (action === "none-of-these" && state.kind === "candidate-result" && state.search.status === "complete" && state.assessment.kind === "candidate-review") {
    // The person explicitly rejects each displayed nearby AED as the photographed device.
    // A corrected map point and a fresh server-side OSM check are still required before upload.
    newAedPositionOverride = undefined;
    state = { ...state, noneOfTheseConfirmed: true };
  } else if (action === "start-new-entry" && state.kind === "candidate-result" && state.search.status === "complete" && state.assessment.kind === "new-entry-eligible") {
    // Erste Bestätigung bei einer Suche ohne Treffer: Die Person sagt ausdrücklich,
    // dass hier ein AED fehlt. Erst danach erscheinen Karte und Positionsbestätigung.
    newAedPositionOverride = undefined;
    state = { ...state, newEntryRequested: true };
  } else if (action === "preview-new-aed" && state.kind === "candidate-result") {
    if (!newEntryPanelOpen(state)) return;
    const positionConfirmed = app!.querySelector<HTMLInputElement>("#new-aed-position-confirmed")?.checked === true;
    const result = previewNewAed({
      searchStatus: state.search.status,
      assessmentKind: state.assessment.kind,
      position: newAedPositionOverride ?? state.location,
      searchCenter: state.location,
      coverageRadiusMeters: state.search.coverageRadiusMeters,
      nearbyRadiusMeters: 100,
      searchCandidates: state.search.candidates,
      // Only reject AEDs the review panel actually showed. Other search results
      // remain in the duplicate check, especially if the map point is moved.
      confirmedDifferentCandidateIds: state.noneOfTheseConfirmed && state.assessment.kind === "candidate-review"
        ? state.assessment.candidates.map((candidate) => candidate.id)
        : [],
      positionConfirmed,
      observedOn,
    });
    state = { kind: "new-aed-preview", photoUrl: state.photoUrl, result, returnState: state };
  } else if (action === "back-to-search" && state.kind === "new-aed-preview") {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return;
    state = state.returnState;
  } else if (action === "create-development-node" && state.kind === "new-aed-preview") {
    successSound.prepare(); // Beim Tippen: Ton freischalten, er erklingt erst bei bestätigtem Erfolg.
    if (!developmentSession || !developmentWriteAvailable || !crypto.randomUUID || state.result.kind !== "ready" || state.writeStatus) return;
    // Zweite Bestätigung: Ohne gesetzten Haken „vor Ort geprüft“ wird nichts gesendet,
    // auch wenn der Knopf (z. B. per Tastatur oder Skript) trotzdem ausgelöst wurde.
    if (app!.querySelector<HTMLInputElement>("#new-aed-absence-confirmed")?.checked !== true) return;
    const preview = state;
    if (preview.result.kind !== "ready") return;
    const operationId = crypto.randomUUID();
    const request: DevelopmentWriteRequest = {
      kind: "create-node", operationId,
      candidateLabel: `${preview.result.position.latitude.toFixed(5)}, ${preview.result.position.longitude.toFixed(5)}`,
      latitude: preview.result.position.latitude, longitude: preview.result.position.longitude,
      observedOn: preview.result.tags.check_date, locationDescription: null,
      confirmedDifferentCandidateIds: preview.result.confirmedDifferentCandidateIds,
    };
    try {
      // Persist the exact confirmed proposal before network I/O so an interrupted request can be reconciled.
      persistPendingDevelopmentWrite(request);
    } catch {
      state = { ...preview, operationId, writeStatus: "failed" };
      render(true);
      return;
    }
    state = { ...preview, operationId, writeStatus: "sending" };
    render(true);
    void submitDevelopmentWrite(request);
  } else if (action === "back-to-candidates" && state.kind === "osm-preview") {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return;
    state = state.returnState;
  } else if (action === "save-development-check" && state.kind === "osm-preview") {
    successSound.prepare(); // Beim Tippen: Ton freischalten, er erklingt erst bei bestätigtem Erfolg.
    if (!developmentSession || !developmentWriteAvailable || !crypto.randomUUID || state.writeStatus === "sending" || state.writeStatus === "complete") return;
    const preview = state;
    const candidateId = preview.candidateId;
    const candidate = preview.returnState.search.candidates.find((item) => item.id === candidateId);
    if (!candidate || candidate.osmType !== "node" || preview.result.kind !== "ready") return;
    const operationId = preview.operationId ?? crypto.randomUUID();
    const change = preview.result.changes[0];
    const request: DevelopmentWriteRequest = {
      kind: "check-date", operationId,
      target: candidate.id,
      candidateLabel: preview.candidateLabel,
      ...(candidate.version === undefined ? {} : { expectedVersion: candidate.version }),
      expectedCheckDate: change.before,
      observedOn: change.after,
    };
    try {
      // Save the exact confirmed proposal before sending so a reload can safely check the same operation.
      persistPendingDevelopmentWrite(request);
    } catch {
      state = { ...preview, operationId, writeStatus: "failed" };
      render(true);
      return;
    }
    state = { ...preview, operationId, writeStatus: "sending" };
    render(true);
    void submitDevelopmentWrite(request);
  } else if (action === "retry-development-write" && (state.kind === "development-write-recovery" || state.kind === "new-aed-preview" || state.kind === "osm-preview")) {
    successSound.prepare();
    if (!developmentSession || !developmentWriteAvailable || state.writeStatus !== "uncertain") return;
    const request = state.kind === "development-write-recovery" ? state.request : readPendingDevelopmentWrite();
    if (!request) return;
    state = { ...state, writeStatus: "sending" };
    render(true);
    void submitDevelopmentWrite(request);
  } else if (action === "confirm" && state.kind === "proposal") {
    const { photoUrl, proposal, candidateId } = state;
    state = { kind: "sending", photoUrl, proposal, candidateId };
    clearTimers();
    saveTimer = window.setTimeout(() => {
      state = confirmationResult(scenario, photoUrl, proposal, candidateId);
      recordDiagnostic("demo_confirmed");
      render(true);
    }, 650);
  } else if ((action === "candidate-main-entrance" || action === "candidate-sports-hall") && state.kind === "clarification") {
    const candidateId: CandidateId = action === "candidate-main-entrance" ? "main-entrance" : "sports-hall";
    state = chooseCandidate(state, candidateId);
  } else if (action === "recover" && state.kind === "unclear-error") {
    const uncertainState = state;
    state = { kind: "checking-status", photoUrl: uncertainState.photoUrl, proposal: uncertainState.proposal, candidateId: uncertainState.candidateId };
    clearTimers();
    saveTimer = window.setTimeout(() => {
      state = recoveryResult(uncertainState);
      render(true);
    }, 650);
  } else if (action === "reset") {
    clearDiagnosticConsent();
    clearTimers();
    releasePhoto();
    demoMode = false;
    state = { kind: "ready" };
  }
  render(true);
}

function clearTimers(): void {
  if (analysisTimer) window.clearTimeout(analysisTimer);
  if (saveTimer) window.clearTimeout(saveTimer);
  if (searchRetryTimer) window.clearTimeout(searchRetryTimer);
  analysisTimer = undefined;
  saveTimer = undefined;
  searchRetryTimer = undefined;
}

async function runNearbySearch(photoUrl: string, providedLocation?: SearchLocation): Promise<void> {
  newAedPositionOverride = undefined;
  if (searchRetryTimer) window.clearTimeout(searchRetryTimer);
  searchRetryTimer = undefined;
  if (accountState !== "signed-in") {
    accountState = "signed-out";
    render(true);
    return;
  }

  state = { kind: "candidate-searching", photoUrl };
  recordDiagnostic("nearby_search_started");
  render(true);
  try {
    const location = providedLocation ?? await getPhoneLocation();
    activeSearchLocation = location;
    const search = await requestNearbyCandidates(location);
    const { assessment } = assessCandidateSearch(location, search, { nearbyRadiusMeters: 100, maximumAccuracyMeters: 100 });
    // Keep coordinates only in the active in-memory photo flow so a later preview can stay tied to
    // the exact search location. They are discarded when the photo is replaced and never persisted.
    const retryAvailableAt = search.status === "partial"
      ? Date.now() + (search.retryAfterSeconds ?? 30) * 1_000
      : undefined;
    state = { kind: "candidate-result", photoUrl, search, assessment, location, ...(retryAvailableAt === undefined ? {} : { retryAvailableAt }) };
    recordDiagnostic("nearby_search_finished");
    if (retryAvailableAt !== undefined) scheduleSearchRetryCountdown(retryAvailableAt);
  } catch (error) {
    recordDiagnostic("nearby_search_finished");
    const code = error instanceof CandidateSearchError ? error.code : "search_failed";
    if (code === "authentication_required") accountState = "signed-out";
    const reasons = {
      location_unavailable: "location-unavailable",
      location_denied: "location-denied",
      location_too_uncertain: "location-uncertain",
      authentication_required: "sign-in",
      search_rate_limited: "rate-limited",
      source_unavailable: "service-unavailable",
      source_timeout: "service-unavailable",
      coverage_unavailable: "service-unavailable",
      search_unavailable: "service-unavailable",
      session_unavailable: "service-unavailable",
      network_error: "service-unavailable",
      invalid_response: "invalid-response",
      search_failed: "failed",
    } as const;
    const retryAfterSeconds = error instanceof CandidateSearchError ? error.retryAfterSeconds : undefined;
    const retryAvailableAt = retryAfterSeconds === undefined ? undefined : Date.now() + retryAfterSeconds * 1_000;
    state = { kind: "candidate-error", photoUrl, reason: reasons[code as keyof typeof reasons] ?? "failed", ...(retryAvailableAt === undefined ? {} : { retryAvailableAt }) };
    if (retryAvailableAt !== undefined) scheduleSearchRetryCountdown(retryAvailableAt);
  }
  render(true);
}

function scheduleSearchRetryCountdown(retryAvailableAt: number): void {
  const remainingSeconds = Math.max(0, Math.ceil((retryAvailableAt - Date.now()) / 1_000));
  if (remainingSeconds === 0) {
    searchRetryTimer = undefined;
    render(true);
    return;
  }
  const waitText = app!.querySelector<HTMLElement>(".search-wait");
  if (waitText) waitText.textContent = tv("searchWait", { seconds: remainingSeconds });
  searchRetryTimer = window.setTimeout(() => scheduleSearchRetryCountdown(retryAvailableAt), Math.min(1_000, retryAvailableAt - Date.now()));
}

function getPhoneLocation(): Promise<SearchLocation> {
  if (!navigator.geolocation) return Promise.reject(new CandidateSearchError("location_unavailable"));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy }),
      (error) => reject(new CandidateSearchError(error.code === error.PERMISSION_DENIED ? "location_denied" : "location_unavailable")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
}

/**
 * Geht nach bestätigter Sichtbarkeit weiter: erst ggf. die Datumsfrage, dann Standort und Suche.
 * Beide Wege (Selbstbestätigung und bestandene Fotoprüfung) nutzen dieselbe Fortsetzung, damit
 * die Datums- und Standortregeln überall gleich gelten.
 */
function proceedAfterSighting(photoUrl: string): void {
  if (photoDateRequiresConfirmation) {
    state = { kind: "photo-date", photoUrl, suggestedDate: observedOn };
    render(true);
  } else continueAfterSighting(photoUrl);
}

/**
 * Fotoprüfung per OpenAI (nur nach ausdrücklichem Tippen und nur, wenn der Server sie freigibt).
 *
 * Ablauf: Foto lokal verkleinern und ohne EXIF/GPS neu kodieren → an den eigenen Server senden →
 * Ergebnis auswerten.
 *  - AED oder Gehäuse erkannt: weiter wie nach der Selbstbestätigung.
 *  - Kein AED / nicht eindeutig: Sackgasse mit „Anderes Foto“ (kein Weiterklicken).
 *  - Jeder technische Fehler (Limit, Ausfall, Timeout, ungültige Antwort): Rückfall auf die
 *    Selbstbestätigung. Ein Ausfall des Dienstes darf die App nicht lahmlegen; die Person bleibt
 *    weiter diejenige, die bestätigt, dass AED oder Gehäuse zu sehen ist.
 * Standort und Konto verlassen das Gerät dabei nie: Das Bild enthält nach dem Neukodieren keine Metadaten.
 */
async function runPhotoCheck(photoUrl: string): Promise<void> {
  const file = selectedPhotoFile;
  const requestId = photoCheckRequestId;
  if (!file || !requestId) return;
  state = { kind: "photo-checking", photoUrl };
  render(true);
  let outcome: "recognized" | "not-aed" | "unclear" | "unavailable";
  let failureCode: string | undefined;
  try {
    const image = await preparePhotoForAnalysis(file);
    const observation = await requestVisionObservation(image, fetch, requestId);
    outcome = isAedRecognized(observation) ? "recognized" : observation.scene === "unclear" ? "unclear" : "not-aed";
  } catch (error) {
    // Jeder Fehler (VisionClientError oder unerwartet) führt nur zum Rückfall, nie zu einem Absturz.
    outcome = "unavailable";
    failureCode = describePhotoCheckFailure(error);
  }
  // Wurde das Foto inzwischen verworfen oder ersetzt, darf das späte Ergebnis nichts mehr ändern.
  if (state.kind !== "photo-checking" || state.photoUrl !== photoUrl || selectedPhotoFile !== file) return;
  if (outcome === "recognized") {
    proceedAfterSighting(photoUrl);
  } else if (outcome === "unavailable") {
    state = { kind: "photo", photoUrl, photoCheck: "unavailable", ...(failureCode ? { photoCheckCode: failureCode } : {}) };
    render(true);
  } else {
    state = { kind: "photo-rejected", photoUrl, reason: outcome };
    render(true);
  }
}

/**
 * Macht aus einem Fehler der Fotoprüfung einen kurzen Code für die Anzeige, zum Beispiel
 * „analysis_failed (HTTP 502, OpenAI 401, invalid_api_key)“. Es kommen nur geprüfte, feste Kennungen
 * vor; Fehlertexte, Fotos und Schlüssel sind nie darin.
 */
function describePhotoCheckFailure(error: unknown): string {
  if (error instanceof VisionClientError) return error.detail ? `${error.code} (${error.detail})` : error.code;
  // Unerwarteter Fehler im Browser: nur der Typname, falls er wie ein Typname aussieht.
  return error instanceof Error && /^[A-Za-z]{1,40}$/u.test(error.name) ? `unexpected_error (${error.name})` : "unexpected_error";
}

function continueAfterSighting(photoUrl: string): void {
  recordDiagnostic("sighting_confirmed");
  if (selectedPhotoLocation) {
    activeSearchLocation = selectedPhotoLocation;
    activeSearchLocationSource = "photo";
    void runNearbySearch(photoUrl, selectedPhotoLocation);
  } else if (phoneLocationPermission === "granted" && phoneLocationFitsPhoto({ fromCamera: selectedPhotoFromCamera, capturedAtMs: selectedPhotoCapturedAtMs })) {
    // Das iPhone liefert Kamerafotos aus dem Browser oft ohne Ortsangabe. Die Person steht gerade am AED und
    // hat dem Handy den Standort einmal erlaubt: Der Handy-Standort ersetzt das fehlende Foto-GPS, ohne
    // Zwischenfrage. Die Anzeige nennt „Handy-Standort verwendet“. Bei Galerie-Fotos und älteren Aufnahmen
    // bleibt die ausdrückliche Wahl (siehe else), weil das Handy dort woanders sein kann.
    // „phone-auto“ merkt, dass die App den Standort selbst eingesetzt hat: Beim Wiederholen wird die Frische neu geprüft.
    activeSearchLocation = undefined;
    activeSearchLocationSource = "phone-auto";
    void runNearbySearch(photoUrl);
  } else {
    state = { kind: "location-choice", photoUrl };
    render(true);
  }
}

/**
 * Fragt nach dem Anmelden einmal nach dem Standort, falls das Handy noch nicht entschieden hat.
 * Das ist der „einmal beim Start“-Moment: Danach fragt die App nie wieder, und die Erlaubnis gilt für
 * frisch aufgenommene Fotos ohne GPS. Der Browser zeigt dabei seinen eigenen Systemdialog.
 */
async function askForLocationOnceAfterSignIn(): Promise<void> {
  if (locationAskAttempted) return;
  locationAskAttempted = true;
  phoneLocationPermission = await readLocationPermission();
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    // Ohne Browser-Speicher lässt sich „einmal“ nicht merken; dann wird nicht gefragt.
    return;
  }
  askForLocationOnce({
    permission: phoneLocationPermission,
    storage,
    geolocation: navigator.geolocation,
    onGranted: () => { phoneLocationPermission = "granted"; },
  });
}

function releasePhoto(): void {
  newAedPositionOverride = undefined;
  const photoUrl = getPhotoUrl(state);
  if (photoUrl?.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
  selectedPhotoLocation = undefined;
  selectedPhotoFromCamera = false;
  selectedPhotoCapturedAtMs = undefined;
  selectedPhotoFile = undefined;
  photoCheckRequestId = undefined;
  photoDateRequiresConfirmation = false;
  observedOn = localCalendarDate();
  activeSearchLocation = undefined;
  activeSearchLocationSource = undefined;
  mapLocationOverride = undefined;
}

render();
void refreshAccountState();
// Hält die Erlaubnis aktuell, auch wenn die Person sie später in den Systemeinstellungen ändert.
void watchLocationPermission((permission) => { phoneLocationPermission = permission; });
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // Every build gets a new worker URL, including deployments that only change the HTML, manifest or icon.
    const workerUrl = new URL("/sw.js", window.location.origin);
    workerUrl.searchParams.set("revision", __AEDJAEGER_BUILD_REVISION__);
    navigator.serviceWorker.register(workerUrl).catch(() => undefined);
    // Merkt, wenn nach dem Start eine neuere Version veröffentlicht wird, und zeigt dann das Banner.
    startUpdateWatcher({ runningRevision: __AEDJAEGER_BUILD_REVISION__, onUpdate: () => { updateAvailable = true; renderUpdateBanner(); } });
  });
}
