import "./styles.css";
import { endOSMSession, loadOSMSession } from "./auth/osmSession";
import { analysisResult, chooseCandidate, confirmationResult, recoveryResult, type CandidateId, type DemoScenario, type DevelopmentWriteRequest, type FlowState } from "./domain/workflow";
import { translate, translations, type Language, type TranslationKey } from "./i18n/translations";
import { translateVision, type VisionMessageKey } from "./i18n/visionTranslations";
import { createVisionRequestId, preparePhotoForAnalysis, requestVisionObservation, VisionClientError } from "./vision/analyzePhoto";
import { assessCandidates } from "./domain/candidateMatch";
import { createPositionPicker, type Coordinate } from "./map/positionPicker";
import { previewExistingAedCheck, previewNewAed } from "./domain/osmChangeProposal";
import { CandidateSearchError, requestNearbyCandidates, type PhoneLocation } from "./osm/candidateSearch";
import type { VisionObservation } from "./contracts/visionObservation";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root element was not found.");

const languageNames: Record<Language, string> = { de: "Deutsch", en: "English", pl: "Polski", ja: "日本語", fr: "Français", es: "Español" };
const developmentWriteCopy: Record<Language, { action: string; createAction: string; retry: string; sending: string; complete: string; created: string; uncertain: string; conflict: string; failed: string; testOnly: string }> = {
  de: { action: "Testserver: Prüfdatum speichern", createAction: "Testserver: AED eintragen", retry: "Testserver: Status erneut prüfen", sending: "Testserver: Änderung wird gesendet…", complete: "Testserver: Vor-Ort-Prüfung gespeichert.", created: "Testserver: Neuer AED wurde eingetragen.", uncertain: "Testserver: Ergebnis unklar. Mit derselben Anfrage erneut prüfen; keine neue Änderung wird blind gesendet.", conflict: "Testserver: In der Nähe gibt es einen AED oder der OSM-Eintrag änderte sich. Suche bitte erneut.", failed: "Testserver: Änderung fehlgeschlagen. Bitte Eintrag erneut prüfen.", testOnly: "Änderungen bleiben auf dem OSM-Testserver." },
  en: { action: "Test server: Save visit date", createAction: "Test server: Add AED", retry: "Test server: Check status again", sending: "Test server: Sending update…", complete: "Test server: Visit confirmation saved.", created: "Test server: New AED added.", uncertain: "Test server: Result is unclear. Check again using the same request; no new edit will be sent blindly.", conflict: "Test server: An AED is nearby or the OSM entry changed. Search again.", failed: "Test server: Update failed. Please check the entry again.", testOnly: "Changes stay on the OSM test server." },
  pl: { action: "Serwer testowy: zapisz datę kontroli", createAction: "Serwer testowy: dodaj AED", retry: "Serwer testowy: sprawdź ponownie stan", sending: "Serwer testowy: wysyłanie zmiany…", complete: "Serwer testowy: zapisano potwierdzenie kontroli.", created: "Serwer testowy: dodano nowy AED.", uncertain: "Serwer testowy: wynik jest niepewny. Sprawdź ponownie to samo żądanie; nie wyślemy w ciemno nowej zmiany.", conflict: "Serwer testowy: w pobliżu jest AED albo wpis OSM został zmieniony. Wyszukaj ponownie.", failed: "Serwer testowy: nie udało się zapisać zmiany. Sprawdź ponownie wpis.", testOnly: "Zmiany pozostają na serwerze testowym OSM." },
  ja: { action: "テストサーバー：確認日を保存", createAction: "テストサーバー：AEDを登録", retry: "テストサーバー：状態を再確認", sending: "テストサーバー：変更を送信中…", complete: "テストサーバー：現地確認を保存しました。", created: "テストサーバー：新しいAEDを登録しました。", uncertain: "テストサーバー：結果を確認できません。同じリクエストで再確認してください。新しい変更を無確認で送信しません。", conflict: "テストサーバー：近くにAEDがあるか、OSMの項目が変更されています。再検索してください。", failed: "テストサーバー：変更に失敗しました。項目を再確認してください。", testOnly: "変更はOSMテストサーバーにのみ保存されます。" },
  fr: { action: "Serveur de test : enregistrer la date", createAction: "Serveur de test : ajouter un DAE", retry: "Serveur de test : vérifier à nouveau", sending: "Serveur de test : envoi de la modification…", complete: "Serveur de test : visite confirmée.", created: "Serveur de test : nouveau DAE ajouté.", uncertain: "Serveur de test : résultat incertain. Vérifiez à nouveau avec la même requête ; aucune nouvelle modification ne sera envoyée à l’aveugle.", conflict: "Serveur de test : un DAE est proche ou la fiche OSM a changé. Relancez la recherche.", failed: "Serveur de test : échec de la modification. Vérifiez à nouveau la fiche.", testOnly: "Les modifications restent sur le serveur de test OSM." },
  es: { action: "Servidor de pruebas: guardar fecha", createAction: "Servidor de pruebas: añadir DEA", retry: "Servidor de pruebas: comprobar estado", sending: "Servidor de pruebas: enviando cambio…", complete: "Servidor de pruebas: visita confirmada.", created: "Servidor de pruebas: se añadió un DEA.", uncertain: "Servidor de pruebas: resultado incierto. Comprueba de nuevo con la misma solicitud; no enviaremos otro cambio a ciegas.", conflict: "Servidor de pruebas: hay un DEA cerca o la ficha OSM ha cambiado. Vuelve a buscar.", failed: "Servidor de pruebas: no se pudo guardar. Comprueba de nuevo la ficha.", testOnly: "Los cambios solo se guardan en el servidor de pruebas de OSM." },
};
const scenarioKeys: Record<DemoScenario, TranslationKey> = {
  existing: "existingScenario", new: "newScenario", multiple: "multipleScenario", unclear: "unclearScenario", "search-error": "searchErrorScenario", "upload-unclear": "uploadErrorScenario",
};
const supportedLanguages = Object.keys(translations) as Language[];
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
let oauthReturnFailed = new URLSearchParams(window.location.search).get("login") === "error";
let analysisTimer: number | undefined;
let saveTimer: number | undefined;
let searchRetryTimer: number | undefined;
let selectedPhotoFile: File | undefined;
// Keep a stable ID while this photo is active; the server uses it to avoid double reservations after retries.
let liveAnalysisRequestId: string | undefined;
let photoSelectionVersion = 0;
let photoSelectionPending = false;
let activePositionPicker: { destroy(): void } | undefined;
let newAedPositionOverride: Coordinate | undefined;

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
      && Number.isSafeInteger(value.expectedVersion) && (value.expectedVersion as number) > 0
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
      && (value.locationDescription === null || typeof value.locationDescription === "string" && value.locationDescription.length <= 255)) return value as unknown as DevelopmentWriteRequest;
    return undefined;
  } catch {
    return undefined;
  }
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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
function tv(key: VisionMessageKey, values?: Record<string, number | string>): string { return translateVision(language, key, values); }

type DiagnosticEvent =
  | "test_run_started" | "photo_selected" | "demo_started" | "demo_result_shown" | "demo_confirmed"
  | "live_flow_blocked" | "live_analysis_started" | "live_analysis_finished" | "live_analysis_failed"
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

function demoNotice(): string {
  return demoMode ? `<p class="simulation-note" role="note">${t("testResultNotice")}</p>` : "";
}

function signInLinks(): string {
  const productionLink = productionLoginAvailable ? `<a class="account-button" id="osm-sign-in" href="/api/auth/osm/start">${t("accountSignIn")}</a>` : "";
  const developmentLink = developmentLoginAvailable ? `<a class="account-button" id="osm-dev-sign-in" href="/api/auth/osm/development/start">${t("accountDevSignIn")}</a><p class="simulation-note">${t("accountDevNotice")}</p>` : "";
  return `${productionLink}${developmentLink}`;
}

function accountPanel(): string {
  if (accountState === "checking") return `<section class="account-panel" aria-live="polite" tabindex="-1">${t("accountChecking")}</section>`;
  if (accountState === "not-configured") return `<section class="account-panel" aria-live="polite" tabindex="-1">${t("accountUnavailable")}</section>`;
  if (accountState === "connection-error") return `<section class="account-panel" aria-live="polite" tabindex="-1"><span>${t("accountConnectionError")}</span><button class="account-button" id="osm-session-retry" type="button">${t("accountRetry")}</button></section>`;
  if ((photoSelectionPending || hasActivePhotoDraft(state)) && accountState !== "signed-in") return `<section class="account-panel" aria-live="polite" tabindex="-1">${t("accountLoginBlocked")}</section>`;
  if (accountState === "login-error") return `<section class="account-panel" aria-live="polite"><p role="alert">${t("accountLoginError")}</p>${signInLinks()}</section>`;
  if (accountState === "signed-in") {
    const signedInTitle = developmentSession ? t("accountDevSignedIn") : t("accountSignedIn");
    const sessionMessage = developmentSession ? t("accountDevNotice") : t("accountIdentityOnly");
    return `<section class="account-panel" aria-live="polite"><div><strong>${signedInTitle}</strong><p>${sessionMessage}</p></div><button class="account-button" id="osm-sign-out" type="button">${t("accountSignOut")}</button></section>`;
  }
  if (accountState === "logout-error") {
    return `<section class="account-panel" aria-live="polite"><span>${t("accountSignOutError")}</span><button class="account-button" id="osm-sign-out" type="button">${t("accountSignOut")}</button></section>`;
  }
  return `<section class="account-panel">${signInLinks()}<p>${t("accountIdentityOnly")}</p></section>`;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function getPhotoUrl(current: FlowState): string | undefined {
  return "photoUrl" in current ? current.photoUrl : undefined;
}

function hasUnresolvedSave(current: FlowState): boolean {
  return current.kind === "vision-analyzing" || current.kind === "candidate-searching" || current.kind === "sending" || current.kind === "checking-status" || current.kind === "unclear-error"
    || (current.kind === "new-aed-preview" && (current.writeStatus === "sending" || current.writeStatus === "uncertain"))
    || (current.kind === "osm-preview" && (current.writeStatus === "sending" || current.writeStatus === "uncertain"));
}

function hasActivePhotoDraft(current: FlowState): boolean {
  return current.kind !== "ready" && current.kind !== "saved";
}

function statusContent(): string {
  const photoUrl = getPhotoUrl(state);
  const photoMarkup = photoUrl ? `<img class="photo-preview" src="${escapeHtml(photoUrl)}" alt="${t("photoAlt")}" />` : "";
  switch (state.kind) {
    case "ready":
      return `<div class="empty-illustration" aria-hidden="true"><span class="device-card"><span class="device-heart">♥</span><span class="device-zap">ϟ</span></span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>`;
    case "photo": {
      const liveAction = accountState === "signed-in" && (!developmentSession || developmentWriteAvailable)
        ? `<button class="button button-primary" data-action="analyze-live">${icon("search")}<span>${tv("action")}</span></button>`
        : developmentSession
          ? `<p class="supporting-copy">${t("accountDevPhotoDisabled")}</p>`
          : accountState === "not-configured"
            ? `<p class="supporting-copy">${t("liveUnavailable")}</p>`
            : `<p class="supporting-copy">${tv("signIn")}</p>`;
      const demoAction = demoMode || accountState !== "signed-in" ? `<button class="button button-secondary" data-action="analyze">${t("demoAnalyze")}</button>` : "";
      return `${photoMarkup}<p class="supporting-copy">${tv("consent")}</p>${liveAction}${demoAction}<p class="simulation-note">${t("testPhotoNotice")}</p><button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
    }
    case "analyzing":
      return `${photoMarkup}${demoNotice()}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${t("demoRunning")}</span></div>`;
    case "vision-analyzing":
      return `${photoMarkup}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${tv("progress")}</span></div>`;
    case "vision-result": {
      const observation = state.observation;
      const sceneKey: Record<typeof observation.scene, VisionMessageKey> = {
        device_visible: "device", enclosure_visible: "enclosure", sign_only: "sign",
        empty_holder: "emptyHolder", multiple_devices: "multiple", other_object: "other", unclear: "unclear",
      };
      const visibleText = observation.readable_text.length ? observation.readable_text.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : `<li>${tv("noText")}</li>`;
      const details = [
        observation.manufacturer ? `<p><strong>${tv("manufacturer")}:</strong> ${escapeHtml(observation.manufacturer)}</p>` : "",
        observation.model ? `<p><strong>${tv("model")}:</strong> ${escapeHtml(observation.model)}</p>` : "",
      ].join("");
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("resultTitle")}</h2><p>${tv("sceneLabel")}: ${tv(sceneKey[observation.scene])}</p><p>${tv("count", { count: observation.device_count })}</p><strong>${tv("readableText")}</strong><ul>${visibleText}</ul>${details}<p class="simulation-note">${tv("notOsm")}</p></div></div><p class="supporting-copy">${tv("searchConsent")}</p><button class="button button-primary" data-action="search-nearby">${icon("search")}<span>${tv("searchAction")}</span></button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
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
      const candidates = candidatesToShow.map(({ candidate, distanceMeters }) => {
          const label = candidate.tags.name || candidate.tags["defibrillator:location"] || candidate.id;
          const distance = distanceMeters === undefined ? "" : `<span>${escapeHtml(tv("distance", { distance: Math.round(distanceMeters) }))}</span>`;
          const reviewAction = candidate.osmType === "node"
            ? `<button class="button button-secondary" data-action="preview-candidate" data-candidate-id="${escapeHtml(candidate.id)}">${tv("selectCandidate")}</button>`
            : `<span class="supporting-copy">${tv("previewUnsupportedShort")}</span>`;
          return `<li class="candidate-item"><strong>${escapeHtml(label)}</strong>${distance}<a href="https://www.openstreetmap.org/${escapeHtml(candidate.id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(candidate.id)} ↗</a>${reviewAction}</li>`;
        }).join("");
      let outcome: string;
      if (search.status === "partial" || assessment.kind === "search-incomplete") outcome = tv("searchPartial");
      else if (assessment.kind === "candidate-review") outcome = tv("searchFound", { count: assessment.candidates.length });
      else if (assessment.kind === "new-entry-eligible") outcome = tv("searchNoMatch");
      else if (assessment.kind === "location-too-uncertain") outcome = tv("locationUncertain");
      else outcome = tv("searchFailedResult");
      const selectedPosition = newAedPositionOverride ?? state.location;
      const newEntryAction = search.status === "complete" && assessment.kind === "new-entry-eligible"
        ? `<section class="position-picker-panel" aria-labelledby="new-aed-position-title"><h3 id="new-aed-position-title">${tv("newPositionMapLabel")}</h3><p class="position-picker-help">${tv("newPositionMapHelp")}</p><p class="position-map-privacy">${tv("newPositionMapPrivacy")}</p><div id="new-aed-position-map" class="position-map" role="application" tabindex="0" aria-label="${tv("newPositionMapLabel")}"></div><p class="position-map-coordinates" id="new-aed-position-coordinates" aria-live="polite">${tv("newPreviewCoordinates", { latitude: selectedPosition.latitude.toFixed(5), longitude: selectedPosition.longitude.toFixed(5) })}</p><div class="position-confirmation"><label for="new-aed-position-confirmed"><input id="new-aed-position-confirmed" type="checkbox" /><span id="new-aed-position-label">${tv("newPositionConfirm", { latitude: selectedPosition.latitude.toFixed(5), longitude: selectedPosition.longitude.toFixed(5) })}</span></label><button class="button button-primary" data-action="preview-new-aed">${tv("newPreviewAction")}</button></div></section>`
        : "";
      const retryWaitSeconds = state.retryAvailableAt === undefined ? 0 : Math.max(0, Math.ceil((state.retryAvailableAt - Date.now()) / 1000));
      const retry = search.status === "partial" || assessment.kind === "search-incomplete"
        ? retryWaitSeconds > 0
          ? `<p class="simulation-note search-wait" aria-live="off">${tv("searchWait", { seconds: retryWaitSeconds })}</p>`
          : `<button class="button button-secondary" data-action="retry-search">${tv("searchRetry")}</button>`
        : "";
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("searchTitle")}</h2><p>${escapeHtml(outcome)}</p>${candidates ? `<ul class="candidate-list">${candidates}</ul>` : ""}<p class="simulation-note">${tv("searchNoWrite")}</p></div></div>${newEntryAction}${retry}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    }
    case "new-aed-preview": {
      const point = state.result.kind === "ready" ? state.result.position : state.returnState.location;
      const latitude = point.latitude.toFixed(5);
      const longitude = point.longitude.toFixed(5);
      // Coordinates are numeric GPS values validated by the location and proposal boundaries.
      const mapUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=19/${latitude}/${longitude}`;
      const content = state.result.kind === "ready"
        ? `<p>${tv("newPreviewCoordinates", { latitude, longitude })}</p><p><a href="${mapUrl}" target="_blank" rel="noopener noreferrer">${tv("newPreviewOpenMap")}</a></p><strong>${tv("newPreviewTags")}</strong><ul>${Object.entries(state.result.tags).map(([key, value]) => `<li><code>${escapeHtml(key)}=${escapeHtml(value)}</code></li>`).join("")}</ul><p>${tv("newPreviewCaution")}</p>`
        : `<p>${tv(state.result.reason === "position-not-confirmed" ? "newPositionRequired" : state.result.reason === "search-found-candidate" ? "newPreviewFoundCandidate" : "newPreviewSearchInvalid")}</p><p><a href="${mapUrl}" target="_blank" rel="noopener noreferrer">${tv("newPreviewOpenMap")}</a></p>`;
      const copy = developmentWriteCopy[language];
      const canCreate = developmentSession && developmentWriteAvailable && state.result.kind === "ready";
      const statusCopy = state.writeStatus === "complete" ? copy.created : state.writeStatus ? copy[state.writeStatus] : "";
      const writeStatus = state.writeStatus ? `<p role="status" class="simulation-note">${statusCopy}</p>` : "";
      const writeAction = canCreate && !state.writeStatus
        ? `<button class="button button-primary" data-action="create-development-node">${copy.createAction}</button>`
        : state.writeStatus === "uncertain" && state.operationId
          ? `<button class="button button-secondary" data-action="retry-development-write">${copy.retry}</button>`
          : "";
      const noWriteNotice = developmentSession ? copy.testOnly : tv("previewNoWrite");
      const navigation = state.writeStatus === "sending" || state.writeStatus === "uncertain" ? "" : `<button class="button button-quiet" data-action="back-to-search">${tv("previewBack")}</button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("newPreviewTitle")}</h2>${content}<p class="simulation-note">${noWriteNotice}</p>${writeStatus}</div></div>${writeAction}${navigation}`;
    }
    case "osm-preview": {
      const { result } = state;
      const candidateId = state.candidateId;
      const candidate = state.returnState.search.candidates.find((item) => item.id === candidateId);
      const canWrite = developmentSession && developmentWriteAvailable && candidate?.osmType === "node" && candidate.version !== undefined && result.kind === "ready";
      const content = result.kind === "ready"
        ? `<p><strong>${tv("previewCheckDate")}</strong></p><p>${tv("previewOldDate", { date: escapeHtml(result.changes[0].before ?? tv("previewNoDate")) })}</p><p>${tv("previewNewDate", { date: result.changes[0].after })}</p>`
        : `<p>${tv("previewUnsupported")}</p>`;
      const copy = developmentWriteCopy[language];
      const writeStatus = state.writeStatus ? `<p role="status" class="simulation-note">${copy[state.writeStatus]}</p>` : "";
      const writeAction = canWrite && !state.writeStatus
        ? `<button class="button button-primary" data-action="save-development-check">${copy.action}</button>`
        : state.writeStatus === "uncertain" && state.operationId
          ? `<button class="button button-secondary" data-action="retry-development-write">${copy.retry}</button>`
          : "";
      const noWriteNotice = developmentSession ? copy.testOnly : tv("previewNoWrite");
      const recoverableWrite = state.writeStatus === "sending" || state.writeStatus === "uncertain";
      const navigation = recoverableWrite ? "" : `<button class="button button-quiet" data-action="back-to-candidates">${tv("previewBack")}</button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("previewTitle")}</h2><p>${tv("previewTarget", { target: escapeHtml(state.candidateLabel) })}</p><p><a href="https://www.openstreetmap.org/${escapeHtml(state.candidateId)}" target="_blank" rel="noopener noreferrer">${escapeHtml(state.candidateId)} ↗</a></p>${content}<p class="simulation-note">${noWriteNotice}</p>${writeStatus}</div></div>${writeAction}${navigation}`;
    }
    case "development-write-recovery": {
      const copy = developmentWriteCopy[language];
      const retry = state.writeStatus === "uncertain"
        ? `<button class="button button-secondary" data-action="retry-development-write">${copy.retry}</button>`
        : "";
      const targetLink = state.request.kind === "check-date"
        ? `<p><a href="https://www.openstreetmap.org/${escapeHtml(state.request.target)}" target="_blank" rel="noopener noreferrer">${escapeHtml(state.request.target)} ↗</a></p>`
        : `<p>${state.request.latitude.toFixed(5)}, ${state.request.longitude.toFixed(5)}</p>`;
      const recoveryMessage = state.request.kind === "create-node" && state.writeStatus === "complete" ? copy.created : copy[state.writeStatus];
      return `<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv("previewTitle")}</h2><p>${tv("previewTarget", { target: escapeHtml(state.request.candidateLabel) })}</p>${targetLink}<p class="simulation-note" role="status">${recoveryMessage}</p></div></div>${retry}`;
    }
    case "candidate-error": {
      const errorKey: Record<typeof state.reason, VisionMessageKey> = {
        "location-unavailable": "locationUnavailable", "location-denied": "locationDenied", "location-uncertain": "locationUncertain",
        "sign-in": "errorSignIn", "rate-limited": "searchRateLimited", "service-unavailable": "searchUnavailable", failed: "searchFailed", "invalid-response": "errorInvalidResponse",
      };
      const retryWaitSeconds = state.retryAvailableAt === undefined ? 0 : Math.max(0, Math.ceil((state.retryAvailableAt - Date.now()) / 1000));
      const retry = state.reason === "sign-in"
        ? ""
        : retryWaitSeconds > 0
          ? `<p class="simulation-note search-wait" aria-live="off">${tv("searchWait", { seconds: retryWaitSeconds })}</p>`
          : `<button class="button button-secondary" data-action="retry-search">${tv("searchRetry")}</button>`;
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv("searchTitle")}</h2><p>${tv(errorKey[state.reason])}</p></div></div>${retry}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    }
    case "vision-error":
      const errorKey: Record<typeof state.reason, VisionMessageKey> = {
        "sign-in": "errorSignIn", "not-allowed": "errorNotAllowed", budget: "errorBudget", unavailable: "errorUnavailable",
        "session-unavailable": "errorSessionUnavailable",
        "analysis-budget-unavailable": "errorBudgetUnavailable",
        "analysis-claim-uncertain": "errorClaimUncertain",
        "invalid-image": "errorInvalidImage", failed: "errorFailed", "invalid-response": "errorInvalidResponse",
      };
      const retryNotice = state.reason === "failed" || state.reason === "invalid-response" ? `<p class="simulation-note">${tv("noAutoRetry")}</p>` : "";
      const retryableBeforeProvider = state.reason === "session-unavailable" || state.reason === "analysis-budget-unavailable";
      const retryButton = retryableBeforeProvider ? `<button class="button button-secondary" data-action="retry-live">${tv("retrySession")}</button>` : "";
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv("errorTitle")}</h2><p>${tv(errorKey[state.reason])}</p>${retryNotice}</div></div>${retryButton}<button class="button button-quiet" data-action="reset">${tv("return")}</button>`;
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
  const isReady = state.kind === "ready";
  document.documentElement.lang = language;
  document.title = `${t("appName")} · ${t("tagline")}`;
  app!.innerHTML = `
    <div class="page-shell">
      <header class="topbar"><a class="brand" href="/" aria-label="${t("appName")}" ${hasUnresolvedSave(state) ? 'aria-disabled="true"' : ""}><span class="brand-mark">${icon("check")}</span><span>${t("appName")}</span></a><div class="topbar-actions"><button class="info-link" id="open-info" type="button"><span class="info-mark" aria-hidden="true">i</span><span>${t("aboutButton")}</span></button><label class="language-picker"><span class="sr-only">${t("language")}</span><select id="language" aria-label="${t("language")}">${supportedLanguages.map((code) => `<option value="${code}" ${language === code ? "selected" : ""}>${languageNames[code]}</option>`).join("")}</select><span class="language-globe" aria-hidden="true">◎</span></label></div></header>
      <main>
        <section class="hero ${isReady ? "" : "hero-compact"}"><div class="hero-kicker"><span></span>${t("eyebrow")}</div><h1>${isReady ? t("title") : state.kind === "analyzing" || state.kind === "vision-analyzing" || state.kind === "sending" ? t("checking") : t("tagline")}</h1>${isReady ? `<p>${t("intro")}</p>` : ""}</section>
        <section class="capture-card" aria-live="polite" aria-atomic="false">
          <div class="capture-content">${isReady ? `<div class="empty-illustration" aria-hidden="true"><span class="device-card"><span class="device-heart">♥</span><span class="device-zap">ϟ</span></span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>` : statusContent()}</div>
          ${isReady ? `<div class="capture-actions"><label class="button button-primary camera-label">${icon("camera")}<span>${t("camera")}</span><input id="camera-input" type="file" accept="image/*" capture="environment" /></label><label class="button button-secondary camera-label">${t("choosePhoto")}<input id="file-input" type="file" accept="image/*" /></label><p class="supporting-copy">${t("privacy")}</p></div>` : ""}
          ${isReady ? `<details class="demo-panel"><summary>${t("demo")}</summary><h2>${t("testStepsTitle")}</h2><p>${t("testSteps")}</p><label for="scenario">${t("scenario")}</label><select id="scenario">${(Object.keys(scenarioKeys) as DemoScenario[]).map((key) => `<option value="${key}" ${scenario === key ? "selected" : ""}>${t(scenarioKeys[key])}</option>`).join("")}</select><label class="diagnostics-opt-in" for="diagnostics-enabled"><input id="diagnostics-enabled" type="checkbox" ${diagnosticsEnabled ? "checked" : ""}><span><strong>${t("testDiagnostics")}</strong><small>${t("testDiagnosticsPrivacy")}</small></span></label></details>` : ""}
        </section>
      </main>
      ${accountPanel()}
      <footer><span class="footer-symbol" aria-hidden="true">✳</span><span>${t("sourceNote")}</span><span class="demo-badge">DEMO</span></footer>
      <dialog class="info-dialog" id="info-dialog" aria-labelledby="info-title" aria-describedby="info-intro">
        <div class="info-dialog-content">
          <div class="info-dialog-header"><div><p class="eyebrow">${t("appName")}</p><h2 id="info-title">${t("aboutTitle")}</h2></div><form method="dialog"><button class="dialog-close" aria-label="${t("closeInfo")}">×</button></form></div>
          <p class="info-intro" id="info-intro">${t("aboutIntro")}</p>
          <section class="info-section"><h3>${t("demoInfoTitle")}</h3><p>${t("demoInfoBody")}</p><h3>${t("demoLimitsTitle")}</h3><p>${t("demoLimitsBody")}</p></section>
          <section class="info-section roadmap-section"><h3>${t("roadmapTitle")}</h3><p>${t("roadmapIntro")}</p><ol class="roadmap-list">
            <li class="roadmap-item roadmap-current"><span class="roadmap-status">${t("roadmapNow")}</span><h4>${t("roadmapDemoTitle")}</h4><p>${t("roadmapDemoBody")}</p></li>
            <li class="roadmap-item roadmap-next"><span class="roadmap-status">${t("roadmapNext")}</span><h4>${t("roadmapMobileTitle")}</h4><p>${t("roadmapMobileBody")}</p></li>
            <li class="roadmap-item"><span class="roadmap-status">${t("roadmapLater")}</span><h4>${t("roadmapImagesTitle")}</h4><p>${t("roadmapImagesBody")}</p></li>
            <li class="roadmap-item"><span class="roadmap-status">${t("roadmapLater")}</span><h4>${t("roadmapApiTitle")}</h4><p>${t("roadmapApiBody")}</p></li>
            <li class="roadmap-item"><span class="roadmap-status">${t("roadmapLater")}</span><h4>${t("roadmapOsmTitle")}</h4><p>${t("roadmapOsmBody")}</p></li>
          </ol></section>
        </div>
      </dialog>
    </div>`;

  if (state.kind === "candidate-result" && state.search.status === "complete" && state.assessment.kind === "new-entry-eligible") {
    const mapContainer = app!.querySelector<HTMLDivElement>("#new-aed-position-map");
    if (mapContainer) {
      activePositionPicker = createPositionPicker(mapContainer, newAedPositionOverride ?? state.location, {
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

  document.querySelector<HTMLButtonElement>("#open-info")?.addEventListener("click", () => {
    document.querySelector<HTMLDialogElement>("#info-dialog")?.showModal();
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

  if (restoreFlowFocus) focusCurrentState();
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

async function refreshAccountState(focusSelector?: string): Promise<void> {
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
    accountState = status.authenticated ? "signed-in" : !productionLoginAvailable && !developmentLoginAvailable ? "not-configured" : failedOAuthReturn ? "login-error" : "signed-out";
    if (state.kind === "photo" && accountState === "not-configured") recordDiagnostic("live_flow_blocked");
  } catch {
    // Local Vite previews and an unavailable Worker must not imply that an OSM session exists.
    accountState = "connection-error";
  }
  const nextActionSelector = accountState === "connection-error" ? "#osm-session-retry"
    : accountState === "signed-in" ? "#osm-sign-out"
      : accountState === "signed-out" || accountState === "login-error" ? "#osm-sign-in"
        : ".account-panel";
  updateAccountPanel(focusSelector === "next-action" ? nextActionSelector : focusSelector);
  // A photo may be selected while the initial session check is still running.
  if (state.kind === "photo") render();
}

async function signOutFromOSM(): Promise<void> {
  accountState = "checking";
  updateAccountPanel(".account-panel");
  try {
    await endOSMSession();
    await refreshAccountState("next-action");
  } catch {
    accountState = "logout-error";
    updateAccountPanel("#osm-sign-out");
  }
}

async function retryOSMSessionStatus(): Promise<void> {
  accountState = "checking";
  updateAccountPanel(".account-panel");
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
  const focusTargets: Record<FlowState["kind"], string> = {
    ready: "#camera-input",
    photo: accountState === "signed-in" ? '[data-action="analyze-live"]' : '[data-action="retake"]',
    analyzing: ".loading-row",
    "vision-analyzing": ".loading-row",
    "vision-result": ".result-message h2",
    "candidate-searching": ".loading-row",
    "candidate-result": ".result-message h2",
    "osm-preview": ".result-message h2",
    "development-write-recovery": ".result-message h2",
    "new-aed-preview": ".result-message h2",
    "candidate-error": ".result-message h2",
    "vision-error": ".result-message h2",
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
  try {
    const image = new Image();
    image.src = photoUrl;
    await image.decode();
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
  selectedPhotoFile = file;
  liveAnalysisRequestId = undefined;
  recordDiagnostic("photo_selected");
  if (accountState === "not-configured") recordDiagnostic("live_flow_blocked");
  state = { kind: "photo", photoUrl };
  render(true);
}

function handleAction(action: string | undefined, source?: HTMLElement): void {
  if (action === "retake") {
    if (hasUnresolvedSave(state)) return;
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
  } else if (action === "analyze-live") {
    if (state.kind !== "photo" || accountState !== "signed-in" || !selectedPhotoFile) return;
    recordDiagnostic("live_analysis_started");
    void runVisionAnalysis(state.photoUrl, selectedPhotoFile);
  } else if (action === "search-nearby" && state.kind === "vision-result") {
    void runNearbySearch(state.photoUrl, state.observation);
  } else if (action === "retry-search" && (state.kind === "candidate-error" || (state.kind === "candidate-result" && (state.search.status === "partial" || state.assessment.kind === "search-incomplete")))) {
    void runNearbySearch(state.photoUrl, state.observation);
  } else if (action === "preview-candidate" && state.kind === "candidate-result") {
    const candidateId = source?.dataset.candidateId;
    const candidate = state.search.candidates.find((item) => item.id === candidateId);
    if (!candidate || !candidateId) return;
    const result = previewExistingAedCheck(candidate, true, new Date().toISOString().slice(0, 10));
    const candidateLabel = candidate.tags.name || candidate.tags["defibrillator:location"] || candidate.id;
    state = { kind: "osm-preview", photoUrl: state.photoUrl, candidateId, candidateLabel, result, returnState: state };
  } else if (action === "preview-new-aed" && state.kind === "candidate-result") {
    if (state.search.status !== "complete" || state.assessment.kind !== "new-entry-eligible") return;
    const positionConfirmed = app!.querySelector<HTMLInputElement>("#new-aed-position-confirmed")?.checked === true;
    const result = previewNewAed({
      searchStatus: state.search.status,
      assessmentKind: state.assessment.kind,
      position: newAedPositionOverride ?? state.location,
      searchCenter: state.location,
      coverageRadiusMeters: state.search.coverageRadiusMeters,
      nearbyRadiusMeters: 100,
      searchCandidates: state.search.candidates,
      positionConfirmed,
      observedOn: new Date().toISOString().slice(0, 10),
    });
    state = { kind: "new-aed-preview", photoUrl: state.photoUrl, result, returnState: state };
  } else if (action === "back-to-search" && state.kind === "new-aed-preview") {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return;
    state = state.returnState;
  } else if (action === "create-development-node" && state.kind === "new-aed-preview") {
    if (!developmentSession || !developmentWriteAvailable || !crypto.randomUUID || state.result.kind !== "ready" || state.writeStatus) return;
    const preview = state;
    if (preview.result.kind !== "ready") return;
    const operationId = crypto.randomUUID();
    const request: DevelopmentWriteRequest = {
      kind: "create-node", operationId,
      candidateLabel: `${preview.result.position.latitude.toFixed(5)}, ${preview.result.position.longitude.toFixed(5)}`,
      latitude: preview.result.position.latitude, longitude: preview.result.position.longitude,
      observedOn: preview.result.tags.check_date, locationDescription: null,
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
    if (!developmentSession || !developmentWriteAvailable || !crypto.randomUUID || state.writeStatus === "sending" || state.writeStatus === "complete") return;
    const preview = state;
    const candidateId = preview.candidateId;
    const candidate = preview.returnState.search.candidates.find((item) => item.id === candidateId);
    if (!candidate || candidate.osmType !== "node" || candidate.version === undefined || preview.result.kind !== "ready") return;
    const operationId = preview.operationId ?? crypto.randomUUID();
    const change = preview.result.changes[0];
    const request: DevelopmentWriteRequest = {
      kind: "check-date", operationId,
      target: candidate.id,
      candidateLabel: preview.candidateLabel,
      expectedVersion: candidate.version,
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
    if (!developmentSession || !developmentWriteAvailable || state.writeStatus !== "uncertain") return;
    const request = state.kind === "development-write-recovery" ? state.request : readPendingDevelopmentWrite();
    if (!request) return;
    state = { ...state, writeStatus: "sending" };
    render(true);
    void submitDevelopmentWrite(request);
  } else if (action === "retry-live") {
    if (state.kind !== "vision-error" || (state.reason !== "session-unavailable" && state.reason !== "analysis-budget-unavailable") || !selectedPhotoFile) return;
    void runVisionAnalysis(state.photoUrl, selectedPhotoFile);
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

async function runVisionAnalysis(photoUrl: string, file: File): Promise<void> {
  // The button is the user's explicit choice to send this single photo to the protected API.
  state = { kind: "vision-analyzing", photoUrl };
  render(true);
  try {
    const sanitizedImage = await preparePhotoForAnalysis(file);
    liveAnalysisRequestId ??= createVisionRequestId();
    const observation = await requestVisionObservation(sanitizedImage, fetch, liveAnalysisRequestId);
    recordDiagnostic("live_analysis_finished");
    state = { kind: "vision-result", photoUrl, observation };
  } catch (error) {
    recordDiagnostic("live_analysis_failed");
    const code = error instanceof VisionClientError ? error.code : "analysis_failed";
    // A 401 means the server no longer accepts this browser session, even if its last check passed.
    if (code === "authentication_required") accountState = "signed-out";
    const reasons = {
      authentication_required: "sign-in",
      analysis_not_allowed: "not-allowed",
      analysis_budget_exceeded: "budget",
      analysis_unavailable: "unavailable",
      session_unavailable: "session-unavailable",
      analysis_budget_unavailable: "analysis-budget-unavailable",
      analysis_claim_uncertain: "analysis-claim-uncertain",
      invalid_image: "invalid-image",
      image_too_large: "invalid-image",
      image_processing_failed: "invalid-image",
      analysis_failed: "failed",
      invalid_response: "invalid-response",
    } as const;
    state = { kind: "vision-error", photoUrl, reason: reasons[code] };
  }
  render(true);
}

async function runNearbySearch(photoUrl: string, observation: VisionObservation): Promise<void> {
  newAedPositionOverride = undefined;
  if (searchRetryTimer) window.clearTimeout(searchRetryTimer);
  searchRetryTimer = undefined;
  if (accountState !== "signed-in") {
    accountState = "signed-out";
    render(true);
    return;
  }

  state = { kind: "candidate-searching", photoUrl, observation };
  recordDiagnostic("nearby_search_started");
  render(true);
  try {
    const location = await getPhoneLocation();
    const search = await requestNearbyCandidates(location);
    const assessment = assessCandidates(location, search, { nearbyRadiusMeters: 100, maximumAccuracyMeters: 100 });
    // Keep coordinates only in the active in-memory photo flow so a later preview can stay tied to
    // the exact search location. They are discarded when the photo is replaced and never persisted.
    const retryAvailableAt = search.status === "partial"
      ? Date.now() + (search.retryAfterSeconds ?? 30) * 1_000
      : undefined;
    state = { kind: "candidate-result", photoUrl, observation, search, assessment, location, ...(retryAvailableAt === undefined ? {} : { retryAvailableAt }) };
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
      overpass_rate_limited: "rate-limited",
      search_unavailable: "service-unavailable",
      session_unavailable: "service-unavailable",
      overpass_unavailable: "service-unavailable",
      overpass_timeout: "service-unavailable",
      network_error: "service-unavailable",
      overpass_invalid_response: "invalid-response",
      overpass_response_too_large: "invalid-response",
      invalid_response: "invalid-response",
      search_failed: "failed",
    } as const;
    const retryAfterSeconds = error instanceof CandidateSearchError ? error.retryAfterSeconds : undefined;
    const retryAvailableAt = retryAfterSeconds === undefined ? undefined : Date.now() + retryAfterSeconds * 1_000;
    state = { kind: "candidate-error", photoUrl, observation, reason: reasons[code as keyof typeof reasons] ?? "failed", ...(retryAvailableAt === undefined ? {} : { retryAvailableAt }) };
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

function getPhoneLocation(): Promise<PhoneLocation> {
  if (!navigator.geolocation) return Promise.reject(new CandidateSearchError("location_unavailable"));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy }),
      (error) => reject(new CandidateSearchError(error.code === error.PERMISSION_DENIED ? "location_denied" : "location_unavailable")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
}

function releasePhoto(): void {
  newAedPositionOverride = undefined;
  const photoUrl = getPhotoUrl(state);
  if (photoUrl?.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
  selectedPhotoFile = undefined;
  liveAnalysisRequestId = undefined;
}

render();
void refreshAccountState();
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // Every build gets a new worker URL, including deployments that only change the HTML, manifest or icon.
    const workerUrl = new URL("/sw.js", window.location.origin);
    workerUrl.searchParams.set("revision", __AEDJAEGER_BUILD_REVISION__);
    navigator.serviceWorker.register(workerUrl).catch(() => undefined);
  });
}
