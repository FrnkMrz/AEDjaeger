import type { TranslationKey } from "../../i18n/translations";
import type { FlowMessageKey } from "../../i18n/flowTranslations";

export type AccountState =
  | "checking"
  | "not-configured"
  | "connection-error"
  | "login-error"
  | "signed-out"
  | "signed-in"
  | "logout-error";

type Translate = (key: TranslationKey, values?: Record<string, number | string>) => string;
type TranslateFlow = (key: FlowMessageKey, values?: Record<string, number | string>) => string;

export type AccountViewContext = {
  t: Translate;
  tv: TranslateFlow;
  accountState: AccountState;
  productionLoginAvailable: boolean;
  developmentLoginAvailable: boolean;
  photoSelectionPending: boolean;
  activePhotoDraft: boolean;
  pendingDevelopmentWrite: boolean;
  illustrationMarkup: string;
};

function signInLinks(context: AccountViewContext): string {
  const productionLink = context.productionLoginAvailable
    ? `<a class="button button-primary account-sign-in" id="osm-sign-in" href="/api/auth/osm/start">${context.t("accountSignIn")}</a>`
    : "";
  const developmentLink = context.developmentLoginAvailable
    ? `<a class="button button-secondary account-sign-in" id="osm-dev-sign-in" href="/api/auth/osm/development/start">${context.t("accountDevSignIn")}</a><p class="simulation-note">${context.t("accountDevNotice")}</p>`
    : "";
  return `${productionLink}${developmentLink}`;
}

/** Die OSM-Anmeldung ist Voraussetzung für alle Arbeitsfunktionen der App. */
export function loginEntry(context: AccountViewContext): string {
  const registerLink = `<a class="account-create-link" href="https://www.openstreetmap.org/user/new" target="_blank" rel="noopener noreferrer">${context.t("accountCreate")}</a>`;
  const createHelp = `<p class="account-create-help">${context.t("accountCreateHelp")}</p>`;
  let status = "";
  let actions = "";
  const pendingRecovery = context.pendingDevelopmentWrite
    ? `<div class="login-status-wrap"><p class="login-status" role="status">${context.tv("recoveryNeedSignIn")}</p><button class="button button-secondary" data-action="continue-recovery">${context.tv("recoveryContinue")}</button></div>`
    : "";

  if (context.accountState === "checking") {
    status = `<p class="login-status" role="status" aria-live="polite">${context.t("accountChecking")}</p>`;
  } else if (context.accountState === "connection-error") {
    status = `<p class="login-status" role="alert">${context.t("accountConnectionError")}</p>`;
    actions = `<button class="button button-secondary account-sign-in" id="osm-session-retry" type="button">${context.t("accountRetry")}</button>`;
  } else if (context.accountState === "not-configured") {
    status = `<p class="login-status" role="status">${context.t("accountUnavailable")}</p>`;
  } else {
    if (context.accountState === "login-error")
      status = `<p class="login-status" role="alert">${context.t("accountLoginError")}</p>`;
    if (context.accountState === "logout-error") {
      status = `<p class="login-status" role="alert">${context.t("accountSignOutError")}</p>`;
      // Keep logout retryable if the server may still hold the user's session.
      actions = `<button class="button button-secondary account-sign-in" id="osm-sign-out" type="button">${context.t("accountSignOut")}</button>`;
    } else {
      actions = signInLinks(context);
    }
  }

  return `<section class="login-card" aria-labelledby="login-title">
    <div class="empty-illustration" aria-hidden="true"><span class="device-card">${context.illustrationMarkup}</span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>
    <p class="hero-kicker"><span></span>${context.t("eyebrow")}</p>
    <h1 id="login-title" tabindex="-1">${context.t("accountGateTitle")}</h1>
    <p class="login-intro">${context.t("accountGateIntro")}</p>
    <p class="login-requirement">${context.t("accountRequired")}</p>
    ${status ? `<div class="login-status-wrap">${status}</div>` : ""}
    ${actions ? `<div class="login-actions">${actions}</div>` : ""}
    ${pendingRecovery}
    <div class="account-create">${registerLink}${createHelp}</div>
    <p class="login-credentials-note">${context.t("accountCredentialsNote")}</p>
  </section>`;
}

export function accountPanel(context: AccountViewContext): string {
  if (context.accountState === "checking")
    return `<section class="account-panel" aria-live="polite" tabindex="-1">${context.t("accountChecking")}</section>`;
  if (context.accountState === "not-configured")
    return `<section class="account-panel" aria-live="polite" tabindex="-1">${context.t("accountUnavailable")}</section>`;
  if (context.accountState === "connection-error")
    return `<section class="account-panel" aria-live="polite" tabindex="-1"><span>${context.t("accountConnectionError")}</span><button class="account-button" id="osm-session-retry" type="button">${context.t("accountRetry")}</button></section>`;
  if ((context.photoSelectionPending || context.activePhotoDraft) && context.accountState !== "signed-in")
    return `<section class="account-panel" aria-live="polite" tabindex="-1">${context.t("accountLoginBlocked")}</section>`;
  if (context.accountState === "login-error")
    return `<section class="account-panel" aria-live="polite"><p role="alert">${context.t("accountLoginError")}</p>${signInLinks(context)}</section>`;
  // Angemeldet: Kein Block auf dem Hauptbildschirm. Die Lampe steht in der Kopfzeile, Abmelden im Info-Dialog.
  if (context.accountState === "signed-in") return "";
  if (context.accountState === "logout-error") {
    return `<section class="account-panel" aria-live="polite"><span>${context.t("accountSignOutError")}</span><button class="account-button" id="osm-sign-out" type="button">${context.t("accountSignOut")}</button></section>`;
  }
  return `<section class="account-panel">${signInLinks(context)}<p>${context.t("accountIdentityOnly")}</p></section>`;
}
