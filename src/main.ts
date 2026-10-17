import "./styles.css";
import { analysisResult, chooseCandidate, confirmationResult, recoveryResult, type CandidateId, type DemoScenario, type FlowState } from "./domain/workflow";
import { translate, translations, type Language, type TranslationKey } from "./i18n/translations";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root element was not found.");

const languageNames: Record<Language, string> = { de: "Deutsch", en: "English", pl: "Polski", ja: "日本語", fr: "Français", es: "Español" };
const scenarioKeys: Record<DemoScenario, TranslationKey> = {
  existing: "existingScenario", new: "newScenario", multiple: "multipleScenario", unclear: "unclearScenario", "search-error": "searchErrorScenario", "upload-unclear": "uploadErrorScenario",
};
const supportedLanguages = Object.keys(translations) as Language[];
let language = readLanguage();
let scenario: DemoScenario = "existing";
let state: FlowState = { kind: "ready" };
let analysisTimer: number | undefined;
let saveTimer: number | undefined;

function readLanguage(): Language {
  const saved = localStorage.getItem("aedjaeger-language");
  if (saved && supportedLanguages.includes(saved as Language)) return saved as Language;
  const deviceLanguage = navigator.language.slice(0, 2) as Language;
  return supportedLanguages.includes(deviceLanguage) ? deviceLanguage : "de";
}

function t(key: TranslationKey): string { return translate(language, key); }
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function getPhotoUrl(current: FlowState): string | undefined {
  return "photoUrl" in current ? current.photoUrl : undefined;
}

function statusContent(): string {
  const photoUrl = getPhotoUrl(state);
  const photoMarkup = photoUrl ? `<img class="photo-preview" src="${escapeHtml(photoUrl)}" alt="${t("photoAlt")}" />` : "";
  switch (state.kind) {
    case "ready":
      return `<div class="empty-illustration" aria-hidden="true"><span class="device-card"><span class="device-heart">♥</span><span class="device-zap">ϟ</span></span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>`;
    case "photo":
      return `${photoMarkup}<p class="supporting-copy">${t("privacy")}</p><button class="button button-primary" data-action="analyze">${icon("search")}<span>${t("analyze")}</span></button><button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
    case "analyzing":
      return `${photoMarkup}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${t("checking")}</span></div>`;
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

function render(): void {
  const isReady = state.kind === "ready";
  document.documentElement.lang = language;
  document.title = `${t("appName")} · ${t("tagline")}`;
  app!.innerHTML = `
    <div class="page-shell">
      <header class="topbar"><a class="brand" href="/" aria-label="${t("appName")}"><span class="brand-mark">${icon("check")}</span><span>${t("appName")}</span></a><label class="language-picker"><span class="sr-only">${t("language")}</span><select id="language" aria-label="${t("language")}">${supportedLanguages.map((code) => `<option value="${code}" ${language === code ? "selected" : ""}>${languageNames[code]}</option>`).join("")}</select><span class="language-globe" aria-hidden="true">◎</span></label></header>
      <main>
        <section class="hero ${isReady ? "" : "hero-compact"}"><div class="hero-kicker"><span></span>${t("eyebrow")}</div><h1>${isReady ? t("title") : state.kind === "analyzing" || state.kind === "sending" ? t("checking") : t("tagline")}</h1>${isReady ? `<p>${t("intro")}</p>` : ""}</section>
        <section class="capture-card" aria-live="polite" aria-atomic="false">
          <div class="capture-content">${isReady ? `<div class="empty-illustration" aria-hidden="true"><span class="device-card"><span class="device-heart">♥</span><span class="device-zap">ϟ</span></span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>` : statusContent()}</div>
          ${isReady ? `<div class="capture-actions"><label class="button button-primary camera-label">${icon("camera")}<span>${t("camera")}</span><input id="camera-input" type="file" accept="image/*" capture="environment" /></label><label class="button button-secondary camera-label">${t("choosePhoto")}<input id="file-input" type="file" accept="image/*" /></label><p class="supporting-copy">${t("privacy")}</p></div>` : ""}
          ${isReady ? `<details class="demo-panel"><summary>${t("demo")}</summary><label for="scenario">${t("scenario")}</label><select id="scenario">${(Object.keys(scenarioKeys) as DemoScenario[]).map((key) => `<option value="${key}" ${scenario === key ? "selected" : ""}>${t(scenarioKeys[key])}</option>`).join("")}</select></details>` : ""}
        </section>
      </main>
      <footer><span class="footer-symbol" aria-hidden="true">✳</span><span>${t("sourceNote")}</span><span class="demo-badge">DEMO</span></footer>
    </div>`;

  document.querySelector<HTMLSelectElement>("#language")?.addEventListener("change", (event) => {
    language = (event.currentTarget as HTMLSelectElement).value as Language;
    localStorage.setItem("aedjaeger-language", language);
    render();
  });
  document.querySelector<HTMLSelectElement>("#scenario")?.addEventListener("change", (event) => {
    scenario = (event.currentTarget as HTMLSelectElement).value as DemoScenario;
  });
  document.querySelector<HTMLInputElement>("#camera-input")?.addEventListener("change", onPhotoSelected);
  document.querySelector<HTMLInputElement>("#file-input")?.addEventListener("change", onPhotoSelected);
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action)));
}

function onPhotoSelected(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    window.alert(t("cameraError"));
    return;
  }
  clearTimers();
  releasePhoto();
  state = { kind: "photo", photoUrl: URL.createObjectURL(file) };
  render();
}

function handleAction(action: string | undefined): void {
  if (action === "retake") {
    releasePhoto();
    state = { kind: "ready" };
  } else if (action === "analyze") {
    const photoUrl = getPhotoUrl(state);
    if (!photoUrl || !(state.kind === "photo" || state.kind === "retryable-error")) return;
    state = { kind: "analyzing", photoUrl };
    clearTimers();
    analysisTimer = window.setTimeout(() => {
      state = analysisResult(scenario, photoUrl);
      render();
    }, 700);
  } else if (action === "confirm" && state.kind === "proposal") {
    const { photoUrl, proposal, candidateId } = state;
    state = { kind: "sending", photoUrl, proposal, candidateId };
    clearTimers();
    saveTimer = window.setTimeout(() => {
      state = confirmationResult(scenario, photoUrl, proposal, candidateId);
      render();
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
      render();
    }, 650);
  } else if (action === "reset") {
    clearTimers();
    releasePhoto();
    state = { kind: "ready" };
  }
  render();
}

function clearTimers(): void {
  if (analysisTimer) window.clearTimeout(analysisTimer);
  if (saveTimer) window.clearTimeout(saveTimer);
  analysisTimer = undefined;
  saveTimer = undefined;
}
function releasePhoto(): void {
  const photoUrl = getPhotoUrl(state);
  if (photoUrl?.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
}

render();
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
