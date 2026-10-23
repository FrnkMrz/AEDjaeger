import "./styles.css";
import { endOSMSession, loadOSMSession } from "./auth/osmSession";
import { analysisResult, chooseCandidate, confirmationResult, recoveryResult, type CandidateId, type DemoScenario, type FlowState } from "./domain/workflow";
import { translate, translations, type Language, type TranslationKey } from "./i18n/translations";
import { translateVision, type VisionMessageKey } from "./i18n/visionTranslations";
import { createVisionRequestId, preparePhotoForAnalysis, requestVisionObservation, VisionClientError } from "./vision/analyzePhoto";
import { assessCandidates } from "./domain/candidateMatch";
import { previewExistingAedCheck } from "./domain/osmChangeProposal";
import { CandidateSearchError, requestNearbyCandidates, type PhoneLocation } from "./osm/candidateSearch";
import type { VisionObservation } from "./contracts/visionObservation";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root element was not found.");

const languageNames: Record<Language, string> = { de: "Deutsch", en: "English", pl: "Polski", ja: "日本語", fr: "Français", es: "Español" };
const scenarioKeys: Record<DemoScenario, TranslationKey> = {
  existing: "existingScenario", new: "newScenario", multiple: "multipleScenario", unclear: "unclearScenario", "search-error": "searchErrorScenario", "upload-unclear": "uploadErrorScenario",
};
const supportedLanguages = Object.keys(translations) as Language[];
let language = readLanguage();
let scenario: DemoScenario = "existing";
// Local fixture workflows stay hidden until the user explicitly opens the preview panel.
let demoMode = false;
let state: FlowState = { kind: "ready" };
type AccountState = "checking" | "not-configured" | "connection-error" | "login-error" | "signed-out" | "signed-in" | "logout-error";
let accountState: AccountState = "checking";
let oauthReturnFailed = new URLSearchParams(window.location.search).get("login") === "error";
let analysisTimer: number | undefined;
let saveTimer: number | undefined;
let searchRetryTimer: number | undefined;
let selectedPhotoFile: File | undefined;
// Keep a stable ID while this photo is active; the server uses it to avoid double reservations after retries.
let liveAnalysisRequestId: string | undefined;
let photoSelectionVersion = 0;
let photoSelectionPending = false;

function readLanguage(): Language {
  const saved = localStorage.getItem("aedjaeger-language");
  if (saved && supportedLanguages.includes(saved as Language)) return saved as Language;
  const deviceLanguage = navigator.language.slice(0, 2) as Language;
  return supportedLanguages.includes(deviceLanguage) ? deviceLanguage : "de";
}

function t(key: TranslationKey, values?: Record<string, number | string>): string {
  const translated = translate(language, key);
  return values ? translated.replace(/\{(\w+)\}/gu, (_, name: string) => String(values[name] ?? "")) : translated;
}
function tv(key: VisionMessageKey, values?: Record<string, number | string>): string { return translateVision(language, key, values); }

function accountPanel(): string {
  if (accountState === "checking") return `<section class="account-panel" aria-live="polite" tabindex="-1">${t("accountChecking")}</section>`;
  if (accountState === "not-configured") return `<section class="account-panel" aria-live="polite" tabindex="-1">${t("accountUnavailable")}</section>`;
  if (accountState === "connection-error") return `<section class="account-panel" aria-live="polite" tabindex="-1"><span>${t("accountConnectionError")}</span><button class="account-button" id="osm-session-retry" type="button">${t("accountRetry")}</button></section>`;
  if ((photoSelectionPending || hasActivePhotoDraft(state)) && accountState !== "signed-in") return `<section class="account-panel" aria-live="polite" tabindex="-1">${t("accountLoginBlocked")}</section>`;
  if (accountState === "login-error") return `<section class="account-panel" aria-live="polite"><p role="alert">${t("accountLoginError")}</p><a class="account-button" id="osm-sign-in" href="/api/auth/osm/start">${t("accountSignIn")}</a></section>`;
  if (accountState === "signed-in") {
    return `<section class="account-panel" aria-live="polite"><div><strong>${t("accountSignedIn")}</strong><p>${t("accountIdentityOnly")}</p></div><button class="account-button" id="osm-sign-out" type="button">${t("accountSignOut")}</button></section>`;
  }
  if (accountState === "logout-error") {
    return `<section class="account-panel" aria-live="polite"><span>${t("accountSignOutError")}</span><button class="account-button" id="osm-sign-out" type="button">${t("accountSignOut")}</button></section>`;
  }
  return `<section class="account-panel"><a class="account-button" id="osm-sign-in" href="/api/auth/osm/start">${t("accountSignIn")}</a><p>${t("accountIdentityOnly")}</p></section>`;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function getPhotoUrl(current: FlowState): string | undefined {
  return "photoUrl" in current ? current.photoUrl : undefined;
}

function hasUnresolvedSave(current: FlowState): boolean {
  return current.kind === "vision-analyzing" || current.kind === "candidate-searching" || current.kind === "sending" || current.kind === "checking-status" || current.kind === "unclear-error";
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
    case "photo":
      return `${photoMarkup}<p class="supporting-copy">${tv("consent")}</p>${accountState === "signed-in" ? `<button class="button button-primary" data-action="analyze-live">${icon("search")}<span>${tv("action")}</span></button>` : `<p class="supporting-copy">${tv("signIn")}</p>`}${demoMode ? `<button class="button button-secondary" data-action="analyze">${t("demoAnalyze")}</button>` : ""}<button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
    case "analyzing":
      return `${photoMarkup}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${t("checking")}</span></div>`;
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
      const retryWaitSeconds = state.retryAvailableAt === undefined ? 0 : Math.max(0, Math.ceil((state.retryAvailableAt - Date.now()) / 1000));
      const retry = search.status === "partial" || assessment.kind === "search-incomplete"
        ? retryWaitSeconds > 0
          ? `<p class="simulation-note search-wait" aria-live="off">${tv("searchWait", { seconds: retryWaitSeconds })}</p>`
          : `<button class="button button-secondary" data-action="retry-search">${tv("searchRetry")}</button>`
        : "";
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("searchTitle")}</h2><p>${escapeHtml(outcome)}</p>${candidates ? `<ul class="candidate-list">${candidates}</ul>` : ""}<p class="simulation-note">${tv("searchNoWrite")}</p></div></div>${retry}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    }
    case "osm-preview": {
      const { result } = state;
      const content = result.kind === "ready"
        ? `<p><strong>${tv("previewCheckDate")}</strong></p><p>${tv("previewOldDate", { date: escapeHtml(result.changes[0].before ?? tv("previewNoDate")) })}</p><p>${tv("previewNewDate", { date: result.changes[0].after })}</p>`
        : `<p>${tv("previewUnsupported")}</p>`;
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("previewTitle")}</h2><p>${tv("previewTarget", { target: state.candidateLabel })}</p><p><a href="https://www.openstreetmap.org/${escapeHtml(state.candidateId)}" target="_blank" rel="noopener noreferrer">${escapeHtml(state.candidateId)} ↗</a></p>${content}<p class="simulation-note">${tv("previewNoWrite")}</p></div></div><button class="button button-quiet" data-action="back-to-candidates">${tv("previewBack")}</button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
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
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${t(state.reason === "multiple" ? "multipleTitle" : "signTitle")}</h2><p>${t(state.reason === "multiple" ? "multipleBody" : "signBody")}</p></div></div>${state.reason === "multiple" ? `<button class="button button-secondary" data-action="candidate-main-entrance">${t("candidateMainEntrance")}</button><button class="button button-secondary" data-action="candidate-sports-hall">${t("candidateSportsHall")}</button>` : ""}<button class="button button-quiet" data-action="retake">${t("clarifyAgain")}</button>`;
    case "proposal":
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><p class="eyebrow">${t(state.candidateId === "main-entrance" ? "candidateMainEntrance" : state.candidateId === "sports-hall" ? "candidateSportsHall" : state.proposal === "existing" ? "existingDetail" : "newDetail")}</p><h2>${t(state.proposal === "existing" ? "existingTitle" : "newTitle")}</h2><p>${t(state.proposal === "existing" ? "existingBody" : "newBody")}</p></div></div><button class="button button-primary" data-action="confirm">${icon("check")}<span>${t(state.proposal === "existing" ? "confirmExisting" : "confirmNew")}</span></button><button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
    case "sending":
      return `${photoMarkup}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${t("sending")}</span></div>`;
    case "checking-status":
      return `${photoMarkup}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${t("checkingStatus")}</span></div>`;
    case "saved":
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><h2>${t("savedTitle")}</h2><p>${t(state.proposal === "existing" ? "savedExisting" : "savedNew")}</p></div></div><p class="simulation-note">${t("savedBody")}</p><button class="button button-primary" data-action="reset">${t("startOver")}</button>`;
    case "unclear-error":
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${t("unclearTitle")}</h2><p>${t("unclearBody")}</p></div></div><button class="button button-secondary" data-action="recover">${t("checkStatus")}</button>`;
    case "retryable-error":
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${t("retryTitle")}</h2><p>${t("retryBody")}</p></div></div><button class="button button-secondary" data-action="analyze">${t("retry")}</button><button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
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
          ${isReady ? `<details class="demo-panel"><summary>${t("demo")}</summary><label for="scenario">${t("scenario")}</label><select id="scenario">${(Object.keys(scenarioKeys) as DemoScenario[]).map((key) => `<option value="${key}" ${scenario === key ? "selected" : ""}>${t(scenarioKeys[key])}</option>`).join("")}</select></details>` : ""}
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
    accountState = status.authenticated ? "signed-in" : !status.loginAvailable ? "not-configured" : failedOAuthReturn ? "login-error" : "signed-out";
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
  state = { kind: "photo", photoUrl };
  render(true);
}

function handleAction(action: string | undefined, source?: HTMLElement): void {
  if (action === "retake") {
    clearTimers();
    releasePhoto();
    demoMode = false;
    state = { kind: "ready" };
  } else if (action === "analyze") {
    const photoUrl = getPhotoUrl(state);
    if (!photoUrl || !(state.kind === "photo" || state.kind === "retryable-error")) return;
    state = { kind: "analyzing", photoUrl };
    clearTimers();
    analysisTimer = window.setTimeout(() => {
      state = analysisResult(scenario, photoUrl);
      render(true);
    }, 700);
  } else if (action === "analyze-live") {
    if (state.kind !== "photo" || accountState !== "signed-in" || !selectedPhotoFile) return;
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
  } else if (action === "back-to-candidates" && state.kind === "osm-preview") {
    state = state.returnState;
  } else if (action === "retry-live") {
    if (state.kind !== "vision-error" || (state.reason !== "session-unavailable" && state.reason !== "analysis-budget-unavailable") || !selectedPhotoFile) return;
    void runVisionAnalysis(state.photoUrl, selectedPhotoFile);
  } else if (action === "confirm" && state.kind === "proposal") {
    const { photoUrl, proposal, candidateId } = state;
    state = { kind: "sending", photoUrl, proposal, candidateId };
    clearTimers();
    saveTimer = window.setTimeout(() => {
      state = confirmationResult(scenario, photoUrl, proposal, candidateId);
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
    state = { kind: "vision-result", photoUrl, observation };
  } catch (error) {
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
  if (searchRetryTimer) window.clearTimeout(searchRetryTimer);
  searchRetryTimer = undefined;
  if (accountState !== "signed-in") {
    accountState = "signed-out";
    render(true);
    return;
  }

  state = { kind: "candidate-searching", photoUrl, observation };
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
    if (retryAvailableAt !== undefined) scheduleSearchRetryCountdown(retryAvailableAt);
  } catch (error) {
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
