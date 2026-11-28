import type { Language, TranslationKey } from "../../i18n/translations";
import type { FlowMessageKey } from "../../i18n/flowTranslations";
import { icon } from "../markup";

type Translate = (key: TranslationKey) => string;
type TranslateFlow = (key: FlowMessageKey) => string;

export type AppShellContext = {
  language: Language;
  languageNames: Record<Language, string>;
  supportedLanguages: readonly Language[];
  t: Translate;
  tv: TranslateFlow;
  authenticated: boolean;
  isReady: boolean;
  isChecking: boolean;
  photoSelectionError: boolean;
  photoCheckAvailable: boolean;
  developmentSession: boolean;
  successSoundEnabled: boolean;
  brandIsDisabled: boolean;
  connectionLamp: string;
  emptyIllustration: () => string;
  statusContent: () => string;
  accountPanel: () => string;
  loginEntry: () => string;
  sourceNote: string;
  buildVersion: string;
  escapeHtml: (value: string) => string;
};

/** Build the top-level app markup from already prepared views and explicit session state. */
export function renderAppShell(context: AppShellContext): string {
  const {
    language,
    languageNames,
    supportedLanguages,
    t,
    tv,
    authenticated,
    isReady,
    isChecking,
    photoSelectionError,
    photoCheckAvailable,
    developmentSession,
    successSoundEnabled,
    brandIsDisabled,
    connectionLamp,
    emptyIllustration,
    statusContent,
    accountPanel,
    loginEntry,
    sourceNote,
    buildVersion,
    escapeHtml,
  } = context;
  // Impressum und Datenschutzerklärung gibt es auf Deutsch und Englisch (Entscheidung vom 28.11.2026).
  // Wer die App nicht auf Deutsch nutzt, springt direkt zur englischen Fassung auf derselben Seite.
  const legalAnchor = language === "de" ? "" : "#en";

  return `
    <div class="page-shell">
      <header class="topbar"><div class="brand-group"><a class="brand" href="/" aria-label="${t("appName")}" ${brandIsDisabled ? 'aria-disabled="true"' : ""}><span>${t("appName")}</span></a>${connectionLamp}</div><div class="topbar-actions"><button class="info-link" id="open-info" type="button"><span class="info-mark" aria-hidden="true">i</span><span>${t("aboutButton")}</span></button><label class="language-picker"><span class="sr-only">${t("language")}</span><select id="language" aria-label="${t("language")}">${supportedLanguages.map((code) => `<option value="${code}" ${language === code ? "selected" : ""}>${languageNames[code]}</option>`).join("")}</select><span class="language-globe" aria-hidden="true">◎</span></label></div></header>
      ${
        authenticated
          ? `<main>
        <section class="hero ${isReady ? "" : "hero-compact"}"><div class="hero-kicker"><span></span>${t("eyebrow")}</div><h1>${isReady ? t("title") : isChecking ? t("checking") : t("tagline")}</h1>${isReady ? `<p>${t("intro")}</p>` : ""}</section>
        <section class="capture-card" aria-live="polite" aria-atomic="false">
          <div class="capture-content">${
            isReady
              ? `${photoSelectionError ? `<p class="photo-selection-error" role="alert" tabindex="-1">${t("cameraError")}</p>` : ""}${emptyIllustration()}`
              : statusContent()
          }</div>
          ${isReady ? `<div class="capture-actions"><label class="button button-primary camera-label">${icon("camera")}<span>${t("camera")}</span><input id="camera-input" type="file" accept="image/*" capture="environment" /></label><label class="button button-secondary camera-label">${t("choosePhoto")}<input id="file-input" type="file" accept="image/*" /></label><p class="supporting-copy">${photoCheckAvailable ? tv("photoCheckNotice") : t("privacy")}</p></div>` : ""}
        </section>
      </main>${accountPanel()}`
          : `<main class="login-main">${loginEntry()}</main>`
      }
      <footer><span>${sourceNote}</span><span class="build-mark" id="build-mark">${escapeHtml(buildVersion)}</span></footer>
      <dialog class="info-dialog" id="info-dialog" aria-labelledby="info-title" aria-describedby="info-intro">
        <div class="info-dialog-content">
          <div class="info-dialog-header"><div><p class="eyebrow">${t("appName")}</p><h2 id="info-title">${t("aboutTitle")}</h2></div><form method="dialog"><button class="dialog-close" aria-label="${t("closeInfo")}">×</button></form></div>
          <p class="info-intro" id="info-intro">${t("aboutIntro")}</p>
          <section class="info-section"><h3>${t("infoHowTitle")}</h3><p>${t("infoHowBody")}</p><h3>${t("infoLimitsTitle")}</h3><p>${t("infoLimitsBody")}</p></section>
          <section class="info-section legal-links"><h3>${t("legalTitle")}</h3><p><a href="/impressum${legalAnchor}">${t("legalImprint")}</a> · <a href="/datenschutz${legalAnchor}">${t("legalPrivacy")}</a></p></section>
          <section class="info-section icon-credits"><h3>${t("iconCreditsTitle")}</h3><p>${t("iconCreditsBody")} <a href="https://github.com/mapbox/maki/blob/main/icons/defibrillator.svg" target="_blank" rel="noopener noreferrer">${t("iconCreditsSource")}</a> · <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">${t("iconCreditsLicense")}</a>.</p></section>
          ${authenticated ? `<section class="info-section account-section"><h3>${developmentSession ? t("accountDevSignedIn") : t("accountSignedIn")}</h3><p>${developmentSession ? t("accountDevNotice") : t("accountIdentityOnly")}</p><button class="account-button" id="osm-sign-out" type="button">${t("accountSignOut")}</button></section>` : ""}
          <label class="sound-toggle"><input type="checkbox" id="success-sound-toggle" ${successSoundEnabled ? "checked" : ""} /><span>${tv("soundToggle")}</span></label>
          <p class="build-version" id="build-version">${escapeHtml(buildVersion)}</p>
        </div>
      </dialog>
    </div>`;
}
