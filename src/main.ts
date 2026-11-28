import "./styles.css";
import { isRecord } from "../shared/typeGuards.js";
import { endOSMSession, loadOSMSession } from "./auth/osmSession";
import type { CandidateResultState, DevelopmentWriteRequest, FlowState } from "./domain/workflow";
import { translate, translations, type Language, type TranslationKey } from "./i18n/translations";
import { translateFlow, type FlowMessageKey } from "./i18n/flowTranslations";
import { readPhotoCapture, readPhotoLocation } from "./vision/photoLocation";
import {
  createVisionRequestId,
  preparePhotoForAnalysis,
  requestVisionObservation,
  VisionClientError,
} from "./vision/analyzePhoto";
import { isAedRecognized } from "./contracts/visionObservation";
import { formatBuildTime } from "./pwa/buildInfo";
import { MAX_LOCATION_ACCURACY_METERS, NEARBY_RADIUS_METERS } from "./domain/matchPolicy";
import { successSound } from "./sound/successSound";
import { openSaveDialog, type SaveDialog, type SaveDialogOutcome } from "./ui/saveDialog";
import { buildSaveLogLines, parseOSMApiLog, readSavedIds } from "./domain/saveLog";
import { readStoredValue, removeStoredValue, writeStoredValue } from "./storage/safeStorage";
import { startUpdateWatcher } from "./pwa/updateCheck";
import {
  askForLocationOnce,
  phoneLocationFitsPhoto,
  readLocationPermission,
  watchLocationPermission,
  type LocationPermission,
} from "./location/phoneLocationPermission";
import { assessCandidateSearch } from "./domain/assessCandidateSearch";
import { getPhotoUrl, hasActivePhotoDraft, hasUnresolvedSave, isNewEntryPanelOpen } from "./domain/workflowSelectors";
import type { Coordinate } from "./map/positionPicker";
import { previewNewAed } from "./domain/osmChangeProposal";
import {
  EMPTY_DETAIL_FORM,
  buildDetailTags,
  formFromExistingTags,
  isDetailKey,
  levelLeftBehindByIndoorChange,
  planDetailChanges,
  validateDetailTags,
  type AedDetailForm,
  type DetailCorrection,
  type DetailKey,
  type DetailPlanResult,
  type DetailTags,
} from "./contracts/aedDetails";
import { CandidateSearchError, requestNearbyCandidates, type SearchLocation } from "./osm/candidateSearch";
import { ExistingNodeError, requestExistingNode } from "./osm/existingNode";
import { developmentWritePath, sendDevelopmentWrite } from "./net/developmentWrite";
import { isChangesetLocale } from "./contracts/changesetComment";
import { createPhotoSessionState } from "./state/photoSession";
import { dispatchUiAction } from "./ui/actions/actionRouter";
import { handleCandidateAction } from "./ui/actions/candidateActions";
import { handleDevelopmentWriteAction } from "./ui/actions/developmentWriteActions";
import { handleExistingDetailsAction } from "./ui/actions/existingDetailsActions";
import { handleNewEntryAction } from "./ui/actions/newEntryActions";
import { dispatchPhotoLocationAction } from "./ui/actions/photoLocationActions";
import { renderStatusContent } from "./ui/views/statusContent";
import {
  accountPanel as renderAccountPanel,
  loginEntry as renderLoginEntry,
  type AccountState,
} from "./ui/views/accountViews";
import {
  detailContinueLabel as renderDetailContinueLabel,
  detailHas as detailHasValue,
  detailMoreCountText as renderDetailMoreCountText,
  existingValueLabel as renderExistingValueLabel,
  renderDetailForm,
  type DetailFormViewContext,
} from "./ui/views/detailForm";
import { bindDetailForm as bindDetailFormInput } from "./ui/controllers/detailFormBinding";
import { bindWorkflowMap } from "./ui/controllers/mapBindings";
import { bindRenderedControls } from "./ui/controllers/renderBindings";
import { createUpdateBannerRenderer } from "./ui/controllers/updateBanner";
import { createAccountPanelBindings } from "./ui/controllers/accountPanelBindings";
import {
  isCalendarDate,
  isFreshCapture,
  isValidObservedDate,
  localCalendarDate,
  photoDateNeedsConfirmation,
} from "./domain/localDate";
import { defibrillatorMark, escapeHtml } from "./ui/markup";
import { renderAppShell } from "./ui/views/appShell";

const app = (() => {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) throw new Error("App root element was not found.");
  return root;
})();

const languageNames: Record<Language, string> = {
  de: "Deutsch",
  en: "English",
  pl: "Polski",
  ja: "日本語",
  fr: "Français",
  es: "Español",
};
// Exakter Maki-Pfad (CC0 1.0); der Info-Dialog zeigt Quelle und Lizenz an.
const defibrillatorPath =
  "m1.54995 7.33811c-2.386799-4.5965 3.63-7.660899 5.952-3.0644 2.3215-4.596499 8.33875-1.5322 5.95235 3.0644-.0869.1671-.2028.3456-.3114.5212h-1.8079l-1.81455-2.7216c-.06321-.09473-.1511-.1704-.25417-.21884-.10308-.04843-.21743-.06779-.3307-.05599-.11327.01181-.22117.05433-.31205.12298-.09087.06865-.16126.16082-.20358.26655l-1.6484 4.12-1.33-1.33c-.11716-.11707-.27597-.18288-.4416-.183h-3.1389c-.1086-.1757-.2245-.3542-.3111-.5213zm9.45005 1.7713c-.103-.00003-.2044-.02545-.2951-.07399-.0908-.04854-.1682-.11871-.2254-.20431l-1.34085-2.0111-1.5587 3.89679c-.03839.096-.10002.181-.17936.2474-.07935.0663-.17393.1119-.27524.1326-.04125.0086-.08327.0128-.1254.0126-.16568.0001-.32462-.0656-.4419-.1826l-1.8169-1.81739h-2.0054c1.36645 1.66819 2.85739 3.23039 4.46 4.67319.08531.077.19616.1197.3111.1197s.22579-.0427.3111-.1197c1.59778-1.4447 3.08545-3.0068 4.45055-4.67319z";
const supportedLanguages = Object.keys(translations) as Language[];
type DevelopmentWriteStatus = Extract<FlowState, { kind: "development-write-recovery" }>["writeStatus"];
const developmentWriteStatusKeys: Record<DevelopmentWriteStatus, FlowMessageKey> = {
  sending: "developmentSending",
  complete: "developmentComplete",
  unchanged: "developmentUnchanged",
  notFound: "developmentNotFound",
  uncertain: "developmentUncertain",
  conflict: "developmentConflict",
  failed: "developmentFailed",
  // Limits gibt es nur am echten OSM; der Testserver meldet diesen Zustand nie.
  limited: "developmentFailed",
};
/** Dieselben Zustände am echten OSM (Etappe Q3), ohne das Präfix „Testserver:“. */
const productionWriteStatusKeys: Record<DevelopmentWriteStatus, FlowMessageKey> = {
  sending: "productionSending",
  complete: "productionComplete",
  unchanged: "productionUnchanged",
  notFound: "productionNotFound",
  uncertain: "productionUncertain",
  conflict: "productionConflict",
  failed: "productionFailed",
  limited: "productionLimited",
};
const minimumMapSearchZoom = 15;
const PENDING_DEVELOPMENT_WRITE_KEY_PREFIX = "aedjaeger-pending-osm-development-write:";
const LEGACY_PENDING_DEVELOPMENT_WRITE_KEY = "aedjaeger-pending-osm-development-write";
const PENDING_DEVELOPMENT_WRITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const photoSession = createPhotoSessionState(localCalendarDate());
let language = readLanguage();
let pendingDevelopmentWriteOwnerHash: string | undefined;
let developmentWriteOwnerHash: string | undefined;
let pendingDevelopmentWrite = readPendingDevelopmentWrite();
let state: FlowState = pendingDevelopmentWrite
  ? { kind: "development-write-recovery", request: pendingDevelopmentWrite, writeStatus: "uncertain" }
  : { kind: "ready" };
let accountState: AccountState = "checking";
let productionLoginAvailable = false;
let developmentLoginAvailable = false;
let developmentSession = false;
let developmentWriteAvailable = false;
// Fotoprüfung: Nur wenn der Server sie für dieses Konto freigibt, bietet die App den Foto-Upload an.
let photoCheckAvailable = false;
// Update-Hinweis: wird true, sobald der Wächter eine neuere veröffentlichte Version erkennt.
let updateAvailable = false;
// Standort-Erlaubnis des Handys (nur lesen, nie anfragen). Nur bei „granted“ nutzt die App den Handy-Standort
// ohne Zwischenfrage, und das nur für ein frisch aufgenommenes Kamerafoto ohne Foto-GPS.
let phoneLocationPermission: LocationPermission = "unknown";
// `photoSession` merkt Herkunft und Aufnahmezeit gemeinsam mit Foto-/Datums-/Suchstandortdaten.
// Die einmalige Standortanfrage wird pro Seitenaufruf höchstens einmal versucht (und pro Gerät nur einmal gestellt).
let locationAskAttempted = false;
let oauthReturnFailed = new URLSearchParams(window.location.search).get("login") === "error";
let searchRetryTimer: number | undefined;
// Keep a stable ID while this photo is active; the server uses it to avoid double reservations after retries.
let activePositionPicker: { destroy(): void } | undefined;
let newAedPositionOverride: Coordinate | undefined;
// Eingaben im Detailformular für eine Neuanlage. Sie liegen bewusst außerhalb von `state`: render() baut die
// Seite bei jedem Zustandswechsel neu auf, die Eingaben sollen dabei (und beim Zurückgehen aus der Vorschau)
// erhalten bleiben. Sie bleiben nur im Arbeitsspeicher und werden mit dem Foto verworfen (resetDetailForm).
let detailForm: AedDetailForm = { ...EMPTY_DETAIL_FORM };
// Ob der Abschnitt „Mehr Angaben“ aufgeklappt ist. Merken, damit er beim Neuzeichnen nicht zuklappt.
let detailMoreOpen = false;
// Nur beim Ergänzen eines bestehenden AED gesetzt: der frisch gelesene OSM-Stand (Detail-Schlüssel und Prüfdatum). Schlüssel, die
// hier stehen, sind im Formular gesperrt. Bei einer Neuanlage bleibt er undefined.
let detailExistingTags: Readonly<Record<string, string>> | undefined;
// Betreiber-Schalter für Korrekturen (Etappe P5): Der Server meldet ihn im Sitzungsstatus. Ohne ihn bleibt es beim Ergänzen.
let developmentCorrectionsAvailable = false;
// Echtes OSM (Etappe Q3): nur true, wenn der Server es für diese Sitzung ausdrücklich freigibt.
let productionWriteAvailable = false;
let productionWriteOwnerHash: string | undefined;
// Echtes OSM (Etappe Q5): Neuanlagen freigegeben (beide Schalter am Server).
let productionNewAedsAvailable = false;
/** Grenzen am echten OSM aus der letzten 429-Antwort des Servers; vorher die Standardwerte. */
let lastProductionWriteLimits = { perAccountPerDay: 20, perAedPerDay: 5 };

/** Gehört ein Vorgang zum echten OSM? Nur dann gelten dessen Kontokennung, Route und Texte. */
function isProductionWrite(request: DevelopmentWriteRequest): boolean {
  return request.environment === "production";
}

/** Die Kontokennung, mit der ein Vorgang nach einem Netzabbruch sicher fortgesetzt wird (je Umgebung verschieden). */
function ownerHashFor(request: DevelopmentWriteRequest): string | undefined {
  return isProductionWrite(request) ? productionWriteOwnerHash : developmentWriteOwnerHash;
}
// Korrekturmodus des Formulars: Vorhandene Werte sind vorbelegt und änderbar. Ohne ihn sind sie gesperrt (nur Ergänzen).
let detailCorrectMode = false;
// Im Korrekturmodus: Schlüssel, deren Wert sich im Formular nicht darstellen lässt (zum Beispiel access=permissive). Sie bleiben gesperrt.
let detailLockedKeys: ReadonlySet<DetailKey> = new Set();

function readLanguage(): Language {
  // Nicht lesbarer Speicher (zum Beispiel "alle Cookies blockieren") darf den Start nicht verhindern: dann gilt die Gerätesprache.
  const saved = readStoredValue("aedjaeger-language");
  if (saved && supportedLanguages.includes(saved as Language)) return saved as Language;
  const deviceLanguage = navigator.language.slice(0, 2) as Language;
  return supportedLanguages.includes(deviceLanguage) ? deviceLanguage : "de";
}

type StoredDevelopmentWrite = {
  version: 1;
  savedAt: number;
  expiresAt: number;
  ownerHash?: string;
  request: DevelopmentWriteRequest;
};

function readPendingDevelopmentWrite(operationId?: string): DevelopmentWriteRequest | undefined {
  const entries: Array<{ key: string; value: string }> = [];
  try {
    const storage = globalThis.localStorage;
    if (operationId) {
      const key = pendingDevelopmentWriteKey(operationId);
      const value = storage.getItem(key);
      if (value) entries.push({ key, value });
    } else {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(PENDING_DEVELOPMENT_WRITE_KEY_PREFIX)) {
          const value = storage.getItem(key);
          if (value) entries.push({ key, value });
        }
      }
    }
  } catch {
    /* Browser storage is optional; legacy session storage remains a best-effort fallback. */
  }
  for (const entry of entries) {
    try {
      const envelope: unknown = JSON.parse(entry.value);
      if (
        isRecord(envelope) &&
        envelope.version === 1 &&
        Number.isSafeInteger(envelope.savedAt) &&
        Number.isSafeInteger(envelope.expiresAt) &&
        (envelope.savedAt as number) <= Date.now() + 60_000 &&
        (envelope.expiresAt as number) > Date.now() &&
        (envelope.expiresAt as number) - (envelope.savedAt as number) <= PENDING_DEVELOPMENT_WRITE_LIFETIME_MS
      ) {
        const request = parseDevelopmentWriteRequest(JSON.stringify(envelope.request) ?? "");
        const keyOperationId = entry.key.slice(PENDING_DEVELOPMENT_WRITE_KEY_PREFIX.length);
        if (
          request &&
          request.operationId === keyOperationId &&
          (!operationId || request.operationId === operationId)
        ) {
          pendingDevelopmentWriteOwnerHash =
            typeof envelope.ownerHash === "string" && /^[a-f0-9]{64}$/u.test(envelope.ownerHash)
              ? envelope.ownerHash
              : undefined;
          return request;
        }
      }
    } catch {
      // Beschädigte und abgelaufene Entwürfe dürfen den Start nicht blockieren.
    }
    removeStoredValue(entry.key);
  }

  // Eine Version lang alte sessionStorage-Einträge übernehmen, damit ein offener Vorgang nach dem Update erhalten bleibt.
  let legacyRaw: string | null = null;
  let legacyCheck = false;
  try {
    legacyRaw = sessionStorage.getItem(LEGACY_PENDING_DEVELOPMENT_WRITE_KEY);
    if (!legacyRaw) {
      legacyRaw = sessionStorage.getItem("aedjaeger-pending-osm-development-check");
      legacyCheck = legacyRaw !== null;
    }
  } catch {
    return undefined;
  }
  if (!legacyRaw) return undefined;
  const request = parseDevelopmentWriteRequest(legacyRaw, legacyCheck);
  if (!request) {
    removeLegacyDevelopmentWrite();
    return undefined;
  }
  try {
    // The top-level binding is still being initialized from this migration path.
    persistPendingDevelopmentWrite(request, false);
  } catch {
    // Die alte Sitzungskopie bleibt als Rückfall erhalten, falls localStorage nicht verfügbar ist.
    return request;
  }
  removeLegacyDevelopmentWrite();
  return request;
}

function parseDevelopmentWriteRequest(raw: string, legacyCheck = false): DevelopmentWriteRequest | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      typeof value.operationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.operationId) ||
      typeof value.candidateLabel !== "string" ||
      value.candidateLabel.length > 255 ||
      !isCalendarDate(value.observedOn)
    )
      return undefined;
    const kind = legacyCheck ? "check-date" : value.kind;
    if (
      kind === "check-date" &&
      typeof value.target === "string" &&
      /^node\/[1-9]\d{0,15}$/u.test(value.target) &&
      (value.expectedVersion === undefined ||
        (Number.isSafeInteger(value.expectedVersion) && (value.expectedVersion as number) > 0)) &&
      (value.expectedCheckDate === null || isCalendarDate(value.expectedCheckDate)) &&
      (value.environment === undefined || value.environment === "production") &&
      (value.locale === undefined || isChangesetLocale(value.locale)) &&
      // Echtes OSM: Prüfdatum, Ergänzungen und Korrekturen (Q3, Q4, Q6) mit denselben Prüfungen wie beim Testserver.
      true
    ) {
      if (value.details !== undefined) {
        const checkedDetails = validateDetailTags(value.details);
        if (!checkedDetails.ok || Object.keys(checkedDetails.tags).length === 0 || value.expectedVersion === undefined)
          return undefined;
        value.details = checkedDetails.tags;
      }
      if (value.expectedBefore !== undefined || value.confirmedCorrections !== undefined) {
        const before = value.expectedBefore;
        if (
          value.details === undefined ||
          value.confirmedCorrections !== true ||
          !isRecord(before) ||
          Object.keys(before).length === 0 ||
          Object.values(before).some((old) => typeof old !== "string" || old.length === 0 || old.length > 255)
        )
          return undefined;
      }
      return { ...value, kind: "check-date" } as unknown as DevelopmentWriteRequest;
    }
    if (
      kind === "create-node" &&
      typeof value.latitude === "number" &&
      Number.isFinite(value.latitude) &&
      Math.abs(value.latitude) <= 90 &&
      typeof value.longitude === "number" &&
      Number.isFinite(value.longitude) &&
      Math.abs(value.longitude) <= 180
    ) {
      const confirmedIds = value.confirmedDifferentCandidateIds ?? [];
      if (
        !Array.isArray(confirmedIds) ||
        confirmedIds.length > 100 ||
        confirmedIds.some((id) => typeof id !== "string" || !/^(node|way|relation)\/[1-9]\d{0,15}$/u.test(id)) ||
        new Set(confirmedIds).size !== confirmedIds.length
      )
        return undefined;
      let rawDetails: unknown = value.details;
      if (rawDetails === undefined) {
        if (value.locationDescription === null || value.locationDescription === undefined) rawDetails = {};
        else if (typeof value.locationDescription === "string")
          rawDetails = { "defibrillator:location": value.locationDescription };
        else return undefined;
      }
      const checkedDetails = validateDetailTags(rawDetails);
      if (!checkedDetails.ok) return undefined;
      // Ziel und Sprache prüfen: nur "production" oder nichts, nur eine der sechs App-Sprachen.
      if (value.environment !== undefined && value.environment !== "production") return undefined;
      if (value.locale !== undefined && !isChangesetLocale(value.locale)) return undefined;
      return {
        kind: "create-node",
        ...(value.environment === "production" ? { environment: "production" as const } : {}),
        ...(isChangesetLocale(value.locale) ? { locale: value.locale } : {}),
        operationId: value.operationId,
        candidateLabel: value.candidateLabel,
        latitude: value.latitude,
        longitude: value.longitude,
        observedOn: value.observedOn,
        details: checkedDetails.tags,
        confirmedDifferentCandidateIds: confirmedIds,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function pendingDevelopmentWriteKey(operationId: string): string {
  return `${PENDING_DEVELOPMENT_WRITE_KEY_PREFIX}${operationId}`;
}

function persistPendingDevelopmentWrite(
  request: DevelopmentWriteRequest,
  updateRuntimeState = true,
  ownerHash = ownerHashFor(request),
): void {
  const savedAt = Date.now();
  const stored: StoredDevelopmentWrite = {
    version: 1,
    savedAt,
    expiresAt: savedAt + PENDING_DEVELOPMENT_WRITE_LIFETIME_MS,
    ...(ownerHash ? { ownerHash } : {}),
    request,
  };
  if (!writeStoredValue(pendingDevelopmentWriteKey(request.operationId), JSON.stringify(stored))) {
    throw new Error("Der offene Speichervorgang konnte nicht sicher gesichert werden.");
  }
  if (updateRuntimeState) {
    pendingDevelopmentWrite = request;
    pendingDevelopmentWriteOwnerHash = ownerHash;
  }
}

function removeLegacyDevelopmentWrite(): void {
  try {
    sessionStorage.removeItem(LEGACY_PENDING_DEVELOPMENT_WRITE_KEY);
    sessionStorage.removeItem("aedjaeger-pending-osm-development-check");
  } catch {
    /* Die migrierte Kopie in localStorage bleibt maßgeblich. */
  }
}

function clearPendingDevelopmentCheck(operationId: string): void {
  removeStoredValue(pendingDevelopmentWriteKey(operationId));
  removeLegacyDevelopmentWrite();
  if (pendingDevelopmentWrite?.operationId === operationId) {
    pendingDevelopmentWriteOwnerHash = undefined;
    pendingDevelopmentWrite = readPendingDevelopmentWrite();
  }
}

function t(key: TranslationKey, values?: Record<string, number | string>): string {
  const translated = translate(language, key);
  return values ? translated.replace(/\{(\w+)\}/gu, (_, name: string) => String(values[name] ?? "")) : translated;
}
function tv(key: FlowMessageKey, values?: Record<string, number | string>): string {
  // Der Limit-Text nennt die Grenzen, die der Server zuletzt gemeldet hat (im Cloudflare-Dashboard einstellbar).
  // Ohne Meldung gelten die Standardwerte 20 und 5. So muss keine Ansicht die Zahlen selbst kennen.
  if (key === "productionLimited" && !values) {
    return translateFlow(language, key, {
      perDay: lastProductionWriteLimits.perAccountPerDay,
      perAed: lastProductionWriteLimits.perAedPerDay,
    });
  }
  return translateFlow(language, key, values);
}
function accountViewContext() {
  return {
    t,
    tv,
    accountState,
    productionLoginAvailable,
    developmentLoginAvailable,
    photoSelectionPending: photoSession.selectionPending,
    activePhotoDraft: hasActivePhotoDraft(state),
    pendingDevelopmentWrite: Boolean(pendingDevelopmentWrite),
    pendingProductionWrite: pendingDevelopmentWrite ? isProductionWrite(pendingDevelopmentWrite) : false,
    illustrationMarkup: defibrillatorMark(defibrillatorPath),
  };
}

function loginEntry(): string {
  return renderLoginEntry(accountViewContext());
}

function accountPanel(): string {
  return renderAccountPanel(accountViewContext());
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
  return `<button class="connection-lamp-button" id="connection-lamp" type="button" aria-label="${escapeHtml(label)}"><span class="connection-lamp ${connected ? "connection-lamp-on" : "connection-lamp-off"}" aria-hidden="true">${connected ? "✓" : "−"}</span></button>`;
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
    target = app.querySelector<HTMLElement>(selector);
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

/**
 * Baut die nummerierten Kartenmarker für die angezeigten Suchtreffer.
 * Die Nummer (1, 2, 3 …) ist dieselbe wie in der Trefferliste, damit man Karte und Liste
 * leicht zuordnen kann. Es werden nur die tatsächlich angezeigten Treffer markiert.
 */
/**
 * Baut die Vorschau einer Neuanlage aus dem Suchergebnis, der bestätigten Position und den Detailangaben.
 *
 * Alle Sicherheitsprüfungen (vollständige Suche, keine Treffer in der Nähe, bestätigte Position, gültige
 * Details) stecken in `previewNewAed`. Diese Funktion reicht nur die Eingaben dorthin weiter. Sie wird an
 * zwei Stellen gebraucht: bei nicht bestätigter Position (dann entsteht eine gesperrte Vorschau mit
 * Hinweis) und nach dem Detailformular (dann entsteht die echte Vorschau).
 *
 * @param current            Der Zustand „Suchergebnis“, aus dem die Neuanlage kommt.
 * @param positionConfirmed  true, wenn die Person die Position ausdrücklich bestätigt hat.
 * @param details            Geprüfte Detailtags aus dem Formular (leer oder weggelassen = keine Angaben).
 */
function computeNewAedPreview(current: CandidateResultState, positionConfirmed: boolean, details?: DetailTags) {
  return previewNewAed({
    searchStatus: current.search.status,
    assessmentKind: current.assessment.kind,
    position: newAedPositionOverride ?? current.location,
    searchCenter: current.location,
    coverageRadiusMeters: current.search.coverageRadiusMeters,
    nearbyRadiusMeters: NEARBY_RADIUS_METERS,
    searchCandidates: current.search.candidates,
    // Only reject AEDs the review panel actually showed. Other search results
    // remain in the duplicate check, especially if the map point is moved.
    confirmedDifferentCandidateIds:
      current.noneOfTheseConfirmed && current.assessment.kind === "candidate-review"
        ? current.assessment.candidates.map((candidate) => candidate.id)
        : [],
    positionConfirmed,
    observedOn: photoSession.observedOn,
    ...(details === undefined ? {} : { details }),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Detailformular für eine Neuanlage (Etappe P2, Entscheidung vom 13.11.2026)
//
// Aufbau: Große Auswahlfelder statt Aufklapplisten, „Weiß ich nicht“ als Vorgabe, eine feste Fußleiste mit einem
// Hauptknopf. Die Regeln, welche Eingabe welches OSM-Tag ergibt, stehen NICHT hier, sondern im gemeinsamen
// Vertrag src/contracts/aedDetails.ts (buildDetailTags). Dieser Teil kümmert sich nur um Anzeige und Bedienung.
//
// Wichtig für das Verständnis: render() baut die ganze Seite bei jedem Zustandswechsel neu auf. Das wäre beim
// Tippen in ein Textfeld schlecht (der Cursor springt weg, eine japanische Eingabe bricht ab). Deshalb ändern
// Eingaben im Formular nur `detailForm` und aktualisieren gezielt die Fußleiste. Nur bei Auswahlfeldern, die
// weitere Felder ein- oder ausblenden, wird der Formularteil (#detail-form) neu gezeichnet.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Abschnitt des Formulars, in dem ein Schlüssel steht. Damit erscheint eine Fehlermeldung direkt beim
 * betroffenen Feld und nicht irgendwo.
 */
const DETAIL_GROUP_OF_KEY: Record<DetailKey, string> = {
  "defibrillator:location": "location",
  access: "access",
  opening_hours: "hours",
  indoor: "indoor",
  level: "indoor",
  operator: "more",
  phone: "more",
  description: "more",
  ref: "more",
};

/** Setzt das Formular zurück (neues Foto, Foto verworfen, neue Suche). */
function resetDetailForm(): void {
  detailForm = { ...EMPTY_DETAIL_FORM };
  detailMoreOpen = false;
  detailExistingTags = undefined;
  detailCorrectMode = false;
  detailLockedKeys = new Set();
}

function detailFormViewContext(): DetailFormViewContext {
  return {
    t,
    tv,
    escapeHtml,
    form: detailForm,
    existingTags: detailExistingTags,
    correctMode: detailCorrectMode,
    lockedKeys: detailLockedKeys,
    moreOpen: detailMoreOpen,
  };
}

function detailMoreCountText(): string {
  return renderDetailMoreCountText(detailFormViewContext());
}

function detailContinueLabel(count: number): string {
  return renderDetailContinueLabel(count, tv);
}

function detailEverythingPresent(): boolean {
  if (detailExistingTags === undefined || detailCorrectMode) return false;
  const keys: DetailKey[] = [
    "defibrillator:location",
    "access",
    "opening_hours",
    "indoor",
    "operator",
    "phone",
    "description",
    "ref",
  ];
  if (!keys.every((key) => detailHasValue(detailFormViewContext(), key))) return false;
  return detailHasValue(detailFormViewContext(), "level") || detailExistingTags.indoor !== "yes";
}

/**
 * Der Formularteil (alles außer Fußleiste). Wird bei Auswahländerungen komplett neu geschrieben.
 * Beim Ergänzen eines bestehenden AED (detailExistingTags gesetzt) erscheint jedes schon eingetragene Feld nur als
 * gesperrte Zeile „Schon eingetragen: …“. Nur Fehlendes lässt sich ausfüllen.
 */
function detailFormMarkup(): string {
  return renderDetailForm(detailFormViewContext());
}

/**
 * Was das Formular jetzt ergäbe, als Plan:
 *  - Neuanlage: alle ausgefüllten Angaben als Ergänzungen.
 *  - Bestehender AED: Ergänzungen und (im Korrekturmodus) Korrekturen gegen den frisch gelesenen Stand. Schon vorhandene
 *    Werte werden nie überschrieben, solange der Korrekturmodus aus ist; gelöscht wird in keinem Modus etwas.
 */
function currentDetailPlan(): DetailPlanResult {
  if (detailExistingTags === undefined) {
    const built = buildDetailTags(detailForm);
    return built.ok ? { ok: true, additions: built.tags, corrections: [], tags: built.tags } : built;
  }
  return planDetailChanges(detailForm, detailExistingTags, detailCorrectMode ? "correct" : "add-only");
}

/** Fußleiste: der eine Hauptknopf (immer erreichbar) und „Zurück“. Die Aktionen unterscheiden Neuanlage und Ergänzen. */
function detailFooterMarkup(): string {
  const built = currentDetailPlan();
  const count = built.ok ? Object.keys(built.tags).length : 0;
  const existing = detailExistingTags !== undefined;
  const continueAction = existing ? "existing-details-continue" : "details-continue";
  const backAction = existing ? "back-from-existing-details" : "back-from-details";
  const backLabel = existing ? tv("previewBack") : tv("detailsBackToMap");
  return `<div class="detail-footer"><button class="button button-primary" id="detail-continue" type="button" data-action="${continueAction}"${built.ok ? "" : " disabled"}>${detailContinueLabel(count)}</button></div><button class="button button-quiet" type="button" data-action="${backAction}">${backLabel}</button>`;
}

/**
 * Aktualisiert Hauptknopf, Fehlermeldung und Zähler, ohne das Formular neu zu zeichnen.
 * Wird nach jeder Eingabe aufgerufen. Ist eine Angabe ungültig, sperrt sie den Knopf und zeigt die Meldung
 * direkt bei dem betroffenen Abschnitt.
 */
function updateDetailFooter(): void {
  const built = currentDetailPlan();
  const button = app.querySelector<HTMLButtonElement>("#detail-continue");
  if (button) {
    button.disabled = !built.ok;
    button.textContent = detailContinueLabel(built.ok ? Object.keys(built.tags).length : 0);
  }
  const failingGroup = !built.ok && isDetailKey(built.key) ? DETAIL_GROUP_OF_KEY[built.key] : undefined;
  app.querySelectorAll<HTMLElement>("[data-detail-error]").forEach((slot) => {
    slot.hidden = slot.dataset.detailError !== failingGroup;
  });
  // Steckt der Fehler in „Mehr Angaben“, muss der Abschnitt offen sein, sonst sieht ihn niemand.
  if (failingGroup === "more") {
    const details = app.querySelector<HTMLDetailsElement>("#detail-more");
    if (details) details.open = true;
  }
  const moreCount = app.querySelector<HTMLElement>("#detail-more-count");
  if (moreCount) moreCount.textContent = detailMoreCountText();
  showDetailChanges(built.ok ? built.corrections : [], built.ok ? staleLevelNote(built.tags) : "");
}

/**
 * Hinweis, wenn eine Korrektur auf „draußen“ eine alte Ebene in OSM zurücklässt (siehe levelLeftBehindByIndoorChange).
 * Leer, wenn es nichts zu sagen gibt oder kein bestehender AED bearbeitet wird.
 */
function staleLevelNote(tags: DetailTags): string {
  if (detailExistingTags === undefined) return "";
  const level = levelLeftBehindByIndoorChange(detailExistingTags, tags);
  return level === null ? "" : tv("detailLevelStays", { level });
}

/** Welche Frage dazugehört, wenn ein Abschnitt mehrere Schlüssel enthält (damit „Vorher: …“ eindeutig bleibt). */
const DETAIL_KEY_LABEL: Partial<Record<DetailKey, FlowMessageKey>> = {
  indoor: "detailIndoorLabel",
  level: "detailLevelLabel",
  operator: "detailOperatorLabel",
  phone: "detailPhoneLabel",
  description: "detailDescriptionLabel",
  ref: "detailRefLabel",
};

/**
 * Zeigt bei jedem Abschnitt mit einer Korrektur den alten Wert („Vorher: …“) und hebt den Abschnitt hervor.
 * So sieht die Person schon im Formular, was sie ändert, nicht erst in der Vorschau.
 */
function showDetailChanges(corrections: readonly DetailCorrection[], levelNote = ""): void {
  const linesByGroup = new Map<string, string[]>();
  // Der Hinweis zur stehenbleibenden Ebene gehört zur Gruppe „drinnen/draußen“.
  if (levelNote !== "") linesByGroup.set("indoor", [levelNote]);
  for (const correction of corrections) {
    const group = DETAIL_GROUP_OF_KEY[correction.key];
    const label = group === "indoor" || group === "more" ? DETAIL_KEY_LABEL[correction.key] : undefined;
    const was = tv("detailWas", {
      value: renderExistingValueLabel(detailFormViewContext(), correction.key, correction.before),
    });
    linesByGroup.set(group, [...(linesByGroup.get(group) ?? []), label ? `${tv(label)}: ${was}` : was]);
  }
  app.querySelectorAll<HTMLElement>("[data-detail-was]").forEach((slot) => {
    const lines = linesByGroup.get(slot.dataset.detailWas ?? "");
    slot.hidden = lines === undefined;
    slot.textContent = lines ? lines.join(" · ") : "";
    slot.closest(".detail-group, .detail-more")?.classList.toggle("is-changed", lines !== undefined);
  });
}

/**
 * Zeichnet nur den Formularteil neu (nach einer Auswahländerung) und setzt den Fokus zurück auf das Feld, das die
 * Person gerade bedient hat. So bleibt die Bedienung per Tastatur und Screenreader zusammenhängend.
 */
function refreshDetailForm(focusId?: string): void {
  const host = app.querySelector<HTMLElement>("#detail-form");
  if (!host) return;
  host.innerHTML = detailFormMarkup();
  updateDetailFooter();
  if (focusId) document.getElementById(focusId)?.focus();
}

/** Setzt den Wert des Ebenen-Zählers in der Anzeige (ohne Neuzeichnen). */
function showDetailLevel(): void {
  const output = app.querySelector<HTMLOutputElement>("#detail-level-value");
  if (output) output.textContent = detailForm.level === null ? "–" : String(detailForm.level);
}

/**
 * Verbindet das Formular mit seinen Eingaben. Die Abhörer hängen am äußeren Behälter #detail-form, der beim
 * Neuzeichnen des Inhalts bestehen bleibt: So gibt es nie doppelte Abhörer und keine verlorenen.
 * Wird von render() aufgerufen, nachdem die Seite neu geschrieben wurde.
 */
function bindDetailForm(): void {
  bindDetailFormInput(app, {
    getForm: () => detailForm,
    refreshDetailForm,
    showDetailLevel,
    updateDetailFooter,
    setMoreOpen: (open) => {
      detailMoreOpen = open;
    },
  });
}

function statusContent(): string {
  const photoUrl = getPhotoUrl(state);
  const photoMarkup = photoUrl
    ? `<img class="photo-preview" src="${escapeHtml(photoUrl)}" alt="${t("photoAlt")}" />`
    : "";
  return renderStatusContent({
    state,
    t,
    tv,
    escapeHtml,
    photoMarkup,
    photoCheckAvailable,
    selectedPhotoFileAvailable: photoSession.file !== undefined,
    mapLocationOverride: photoSession.mapLocationOverride,
    minimumMapSearchZoom,
    defibrillatorPath,
    developmentSession,
    developmentWriteAvailable,
    developmentWriteOwnerHash,
    developmentCorrectionsAvailable,
    productionWriteAvailable: productionWriteAvailable && Boolean(productionWriteOwnerHash),
    productionNewAedsAvailable: productionNewAedsAvailable && Boolean(productionWriteOwnerHash),
    productionWriteStatusKeys,
    newAedPositionOverride,
    searchLocationSource: photoSession.searchLocationSource,
    language,
    developmentWriteStatusKeys,
    newEntryPanelOpen: isNewEntryPanelOpen,
    isRecoveryOwnerMismatch,
    detailEverythingPresent,
    detailFormMarkup,
    detailFooterMarkup,
  });
}

function render(restoreFlowFocus = false, preserveOpenInfoDialog = false): void {
  const infoDialogWasOpen =
    preserveOpenInfoDialog && (document.querySelector<HTMLDialogElement>("#info-dialog")?.open ?? false);
  activePositionPicker?.destroy();
  activePositionPicker = undefined;
  const isReady = state.kind === "ready";
  document.documentElement.lang = language;
  document.title = `${t("appName")} · ${t("tagline")}`;
  const authenticated = accountState === "signed-in";
  const isChecking = state.kind === "photo-checking" || state.kind === "candidate-searching";
  app.innerHTML = renderAppShell({
    language,
    languageNames,
    supportedLanguages,
    t,
    tv,
    authenticated,
    isReady,
    isChecking,
    photoSelectionError: photoSession.selectionError,
    photoCheckAvailable,
    developmentSession,
    successSoundEnabled: successSound.isEnabled(),
    brandIsDisabled: hasUnresolvedSave(state),
    connectionLamp: connectionLamp(),
    emptyIllustration: () =>
      `<div class="empty-illustration" aria-hidden="true"><span class="device-card">${defibrillatorMark(defibrillatorPath)}</span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>`,
    statusContent,
    accountPanel,
    loginEntry,
    sourceNote: t("sourceNote"),
    buildVersion: buildVersionText(),
    escapeHtml,
  });

  if (infoDialogWasOpen) document.querySelector<HTMLDialogElement>("#info-dialog")?.showModal();

  activePositionPicker = bindWorkflowMap({
    app,
    state,
    photoSession,
    minimumMapSearchZoom,
    newEntryPanelOpen: isNewEntryPanelOpen,
    newAedPositionOverride,
    setNewAedPositionOverride: (position) => {
      newAedPositionOverride = position;
    },
    tv,
  });

  // Detailformular: Eingaben mit dem gemerkten Formularzustand verbinden.
  if (state.kind === "new-aed-details" || (state.kind === "existing-aed-details" && state.load.status === "ready"))
    bindDetailForm();

  bindRenderedControls(app, {
    hasUnresolvedSave: () => hasUnresolvedSave(state),
    focusCurrentState,
    openAccountFromLamp,
    onSoundToggle: (enabled) => {
      successSound.setEnabled(enabled);
      // Beim Einschalten einmal vorspielen: So hört die Person sofort, wie es klingt, und der Ton ist freigeschaltet.
      if (enabled) {
        successSound.prepare();
        successSound.play();
      }
    },
    onLanguageChange: (nextLanguage) => {
      language = nextLanguage;
      // Scheitert das Merken, gilt die Sprache trotzdem für die offene Seite.
      writeStoredValue("aedjaeger-language", language);
      render();
    },
    onPhotoSelected,
    onAction: (action, source) => {
      void handleAction(action, source);
    },
    bindAccountPanel,
    renderUpdateBanner,
    restoreFlowFocus,
  });
}

/**
 * Sagt, ob ein Neuladen jetzt etwas Laufendes zerstören würde.
 * Beim Speichern (auch bei unklarem Ergebnis), beim Foto-Prüfen und bei einer offenen Wiederherstellung
 * bleibt der Knopf gesperrt, damit kein Vorgang doppelt oder halb ausgeführt wird.
 */
function reloadBlocked(): boolean {
  return (
    hasUnresolvedSave(state) ||
    state.kind === "photo-checking" ||
    (state.kind === "development-write-recovery" &&
      (state.writeStatus === "uncertain" || state.writeStatus === "sending"))
  );
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
const renderUpdateBanner = createUpdateBannerRenderer({
  app,
  isUpdateAvailable: () => updateAvailable,
  reloadBlocked,
  hasActivePhotoDraft: () => hasActivePhotoDraft(state),
  translate: tv,
  reload: () => window.location.reload(),
});

const accountPanelBindings = createAccountPanelBindings({
  app,
  renderPanel: accountPanel,
  onSignOut: () => {
    void signOutFromOSM();
  },
  onRetrySession: () => {
    void retryOSMSessionStatus();
  },
});

function bindAccountPanel(): void {
  accountPanelBindings.bind();
}

function updateAccountPanel(focusSelector?: string): void {
  accountPanelBindings.update(focusSelector);
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
    developmentWriteOwnerHash = status.developmentWriteOwnerHash;
    // „Korrekturen in dieser Sitzung erlaubt“: am Testserver gilt dessen Schalter, am echten OSM der eigene (Etappe Q6).
    // Der Schalter der einen Umgebung wirkt nie auf die andere.
    developmentCorrectionsAvailable = status.developmentSession
      ? status.developmentCorrectionsAvailable
      : status.productionCorrectionsAvailable;
    photoCheckAvailable = status.photoCheckAvailable;
    productionWriteAvailable = status.productionWriteAvailable && !status.developmentSession;
    productionWriteOwnerHash = status.productionWriteOwnerHash;
    productionNewAedsAvailable = status.productionNewAedsAvailable && !status.developmentSession;
    if (
      pendingDevelopmentWrite &&
      !pendingDevelopmentWriteOwnerHash &&
      !isProductionWrite(pendingDevelopmentWrite) &&
      developmentSession &&
      developmentWriteOwnerHash
    ) {
      // Upgrade a same-session pre-owner marker as soon as the Worker confirms the development account.
      try {
        persistPendingDevelopmentWrite(pendingDevelopmentWrite, true, developmentWriteOwnerHash);
      } catch {
        // Storage migration is best-effort: keep the authenticated session and legacy marker usable in this tab.
        pendingDevelopmentWriteOwnerHash = developmentWriteOwnerHash;
      }
    }
    const stillSignedInAfterLogout = afterLogout && status.authenticated;
    if (status.authenticated && !stillSignedInAfterLogout) void askForLocationOnceAfterSignIn();
    accountState = stillSignedInAfterLogout
      ? "logout-error"
      : status.authenticated
        ? "signed-in"
        : !productionLoginAvailable && !developmentLoginAvailable
          ? "not-configured"
          : failedOAuthReturn
            ? "login-error"
            : "signed-out";
  } catch {
    // Local Vite previews and an unavailable Worker must not imply that an OSM session exists.
    accountState = "connection-error";
  }
  // Rendering the whole app here enforces the gate after sign-in, expiry, and logout.
  render();
  if (pendingDevelopmentWrite && accountState === "signed-out") {
    // Der offene Vorgang braucht die passende Anmeldung: echtes OSM oder Testserver.
    app
      .querySelector<HTMLElement>(isProductionWrite(pendingDevelopmentWrite) ? "#osm-sign-in" : "#osm-dev-sign-in")
      ?.focus();
  } else if (focusSelector === "next-action") {
    const nextActionSelector =
      accountState === "connection-error"
        ? "#osm-session-retry"
        : accountState === "signed-in"
          ? "#camera-input"
          : accountState === "signed-out" || accountState === "login-error"
            ? "#osm-sign-in"
            : "#login-title";
    app.querySelector<HTMLElement>(nextActionSelector)?.focus();
  } else if (focusSelector) {
    app.querySelector<HTMLElement>(focusSelector)?.focus();
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
    app.querySelector<HTMLElement>("#login-title")?.focus();
  }
}

async function retryOSMSessionStatus(): Promise<void> {
  accountState = "checking";
  render();
  await refreshAccountState("next-action");
}

/** Sends one explicitly confirmed test-server edit; a stable operation ID protects uncertain retries. */
async function submitDevelopmentWrite(requestBody: DevelopmentWriteRequest): Promise<void> {
  const isCheckDate = requestBody.kind === "check-date";
  // Das Speicher-Fenster öffnet sich sofort beim Tippen und zeigt, was passiert (siehe src/ui/saveDialog.ts).
  // Es zeigt nur an; welche Zustände der Vorgang durchläuft, entscheidet weiter allein der Code unten.
  const saveDialog = openSaveDialog(tv, developmentWritePath(requestBody), () => focusCurrentState());
  let responsePayload: unknown;
  try {
    const { ok, status, payload } = await sendDevelopmentWrite(requestBody, ownerHashFor(requestBody));
    responsePayload = payload;
    // Die Schritte des Servers (Änderungssatz angelegt, hochgeladen, geschlossen) ins Fenster schreiben.
    saveDialog.addServerLines(buildSaveLogLines(parseOSMApiLog(payload)));
    const matchesCurrentRequest =
      (state.kind === "new-aed-preview" && state.operationId === requestBody.operationId) ||
      (state.kind === "osm-preview" && state.operationId === requestBody.operationId) ||
      (state.kind === "development-write-recovery" && state.request.operationId === requestBody.operationId);
    if (!matchesCurrentRequest) {
      saveDialog.dismiss();
      return;
    }
    if (ok && isDevelopmentWriteResponse(payload, "complete")) {
      // "already_current": Das Datum stand schon so auf dem Knoten. Der Server hat bewusst nichts geschrieben (kein neuer
      // Änderungssatz). Das ist ein Erfolg im Sinne von "der Stand stimmt", aber kein Speichern. Darum eine eigene
      // Meldung ("Schon aktuell. Es wurde nichts geändert.") und kein Ton: Ein Ton für nichts wäre eine Belohnung ohne Leistung.
      const unchanged = isCheckDate && payload.already_current === true;
      setDevelopmentWriteStatus(requestBody.operationId, unchanged ? "unchanged" : "complete");
      clearPendingDevelopmentCheck(requestBody.operationId);
      // Nur bei einem vom Server bestätigten, echten Schreibvorgang erklingt der Ton. Er ändert nichts am Ablauf.
      if (!unchanged) successSound.play();
    } else if (
      status === 429 &&
      isRecord(payload) &&
      (payload.error === "daily_limit" || payload.error === "object_recently_changed")
    ) {
      // Echtes OSM: Ein Limit hat gegriffen, BEVOR etwas an OSM ging. Eindeutig: nichts geändert, kein Wiederholen-Knopf.
      lastProductionWriteLimits = readProductionWriteLimits(payload.limits) ?? lastProductionWriteLimits;
      setDevelopmentWriteStatus(requestBody.operationId, "limited");
      clearPendingDevelopmentCheck(requestBody.operationId);
    } else if (status === 409) {
      setDevelopmentWriteStatus(requestBody.operationId, "conflict");
      clearPendingDevelopmentCheck(requestBody.operationId);
    } else if (status === 404 && isRecord(payload) && payload.error === "target_not_found") {
      // Eindeutig: Den Knoten gibt es auf dem Testserver nicht (zum Beispiel ein AED aus dem Archiv des echten OSM).
      // Nichts wurde geschrieben; ein erneutes Prüfen würde dasselbe ergeben. Darum kein "unklar" und kein Prüfen-Knopf.
      setDevelopmentWriteStatus(requestBody.operationId, "notFound");
      clearPendingDevelopmentCheck(requestBody.operationId);
    } else if (isRecord(payload) && payload.error === "write_failed") {
      // Der Server hat den Vorgang endgültig als gescheitert festgehalten. Wiederholen liefert dieselbe Antwort,
      // darum "fehlgeschlagen" (neuer Versuch von vorn) statt "unklar".
      setDevelopmentWriteStatus(requestBody.operationId, "failed");
      clearPendingDevelopmentCheck(requestBody.operationId);
    } else if (status === 403 && isRecord(payload) && payload.error === "recovery_identity_mismatch") {
      // Ein anderer Tab kann das gemeinsame Sitzungscookie inzwischen auf ein anderes Konto umgestellt haben.
      // Der Server hat deshalb nichts geschrieben; den Marker aber behalten, bis das richtige Konto zurück ist.
      setDevelopmentWriteStatus(requestBody.operationId, "uncertain");
      finishSaveDialog(saveDialog, requestBody, payload);
      await refreshAccountState();
      return;
    } else if (status === 202 || status >= 500 || (!ok && !isRecord(payload))) {
      setDevelopmentWriteStatus(requestBody.operationId, "uncertain");
    } else {
      setDevelopmentWriteStatus(requestBody.operationId, "failed");
      clearPendingDevelopmentCheck(requestBody.operationId);
    }
  } catch {
    // Keine oder keine lesbare Antwort: Ob gespeichert wurde, ist offen. Der Zustand „unklar“ bietet das erneute Prüfen an.
    setDevelopmentWriteStatus(requestBody.operationId, "uncertain");
    saveDialog.addLine(tv("saveLogNoAnswer"), "error");
  }
  finishSaveDialog(saveDialog, requestBody, responsePayload);
  if (
    (state.kind === "new-aed-preview" && state.operationId === requestBody.operationId) ||
    (state.kind === "osm-preview" && state.operationId === requestBody.operationId) ||
    (state.kind === "development-write-recovery" && state.request.operationId === requestBody.operationId)
  )
    render(true, true);
}

/**
 * Schließt das Speicher-Fenster mit dem Ergebnis ab, das der Ablauf gerade festgelegt hat.
 * Die Schlussmeldung ist derselbe Text wie auf dem Bildschirm dahinter, damit beide dasselbe sagen.
 */
function finishSaveDialog(saveDialog: SaveDialog, requestBody: DevelopmentWriteRequest, payload: unknown): void {
  const writeStatus =
    state.kind === "new-aed-preview" && state.operationId === requestBody.operationId
      ? state.writeStatus
      : state.kind === "osm-preview" && state.operationId === requestBody.operationId
        ? state.writeStatus
        : state.kind === "development-write-recovery" && state.request.operationId === requestBody.operationId
          ? state.writeStatus
          : undefined;
  if (!writeStatus || writeStatus === "sending") {
    saveDialog.dismiss();
    return;
  }
  // Bei Erfolg passt die Meldung zur Art des Vorgangs: neuer AED, Prüfdatum, Prüfdatum mit Ergänzungen oder Korrekturen.
  const statusKeys = isProductionWrite(requestBody) ? productionWriteStatusKeys : developmentWriteStatusKeys;
  const completeKey: FlowMessageKey = isProductionWrite(requestBody)
    ? requestBody.kind === "create-node"
      ? "productionCreated"
      : requestBody.expectedBefore && requestBody.confirmedCorrections === true
        ? "productionChangesComplete"
        : requestBody.details && Object.keys(requestBody.details).length > 0
          ? "productionDetailsComplete"
          : "productionComplete"
    : requestBody.kind === "create-node"
      ? "developmentCreated"
      : requestBody.expectedBefore && requestBody.confirmedCorrections === true
        ? "developmentChangesComplete"
        : requestBody.details && Object.keys(requestBody.details).length > 0
          ? "developmentDetailsComplete"
          : "developmentComplete";
  const outcome: SaveDialogOutcome =
    writeStatus === "complete"
      ? "complete"
      : writeStatus === "unchanged"
        ? "unchanged"
        : writeStatus === "uncertain"
          ? "uncertain"
          : "failed";
  const ids = readSavedIds(payload, requestBody.kind === "check-date" ? requestBody.target : undefined);
  saveDialog.finish({
    outcome,
    message: tv(writeStatus === "complete" ? completeKey : statusKeys[writeStatus]),
    nodeId: ids.nodeId,
    changesetId: ids.changesetId,
  });
}

/**
 * Prüft die vom Server gemeldeten Grenzen. Die Antwort ist eine Vertrauensgrenze: Nur ganze Zahlen von 1 bis 1000
 * werden angezeigt, alles andere wird ignoriert (dann bleibt der bisherige Text mit den bekannten Zahlen).
 */
function readProductionWriteLimits(value: unknown): { perAccountPerDay: number; perAedPerDay: number } | undefined {
  if (!isRecord(value)) return undefined;
  const perDay = value.per_account_per_day;
  const perAed = value.per_aed_per_day;
  const valid = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1 && (n as number) <= 1_000;
  return valid(perDay) && valid(perAed) ? { perAccountPerDay: perDay, perAedPerDay: perAed } : undefined;
}

function setDevelopmentWriteStatus(
  operationId: string,
  writeStatus: "uncertain" | "sending" | "complete" | "unchanged" | "notFound" | "conflict" | "failed" | "limited",
): void {
  if (state.kind === "new-aed-preview" && state.operationId === operationId) {
    // Eine Neuanlage kennt kein "schon aktuell"; der Server meldet es dort nie. Sicherheitshalber gilt es als erstellt.
    state = {
      ...state,
      writeStatus:
        writeStatus === "unchanged"
          ? "complete"
          : writeStatus === "notFound" || writeStatus === "limited"
            ? "failed"
            : writeStatus,
    };
  } else if (state.kind === "osm-preview" && state.operationId === operationId) {
    state = { ...state, writeStatus };
  } else if (state.kind === "development-write-recovery" && state.request.operationId === operationId) {
    state = { ...state, writeStatus };
  }
}

function isDevelopmentWriteResponse(
  value: unknown,
  expectedStatus: string,
): value is { status: string; version: number; already_current?: unknown } {
  return (
    isRecord(value) &&
    value.status === expectedStatus &&
    Number.isSafeInteger(value.version) &&
    (value.version as number) > 0
  );
}

function isRecoveryOwnerMismatch(): boolean {
  const currentOwnerHash = pendingDevelopmentWrite ? ownerHashFor(pendingDevelopmentWrite) : developmentWriteOwnerHash;
  return Boolean(
    pendingDevelopmentWriteOwnerHash && currentOwnerHash && pendingDevelopmentWriteOwnerHash !== currentOwnerHash,
  );
}

function focusCurrentState(): void {
  if (accountState !== "signed-in") {
    const loginControl = app.querySelector<HTMLElement>(
      "#osm-dev-sign-in, #osm-session-retry, #osm-sign-in, #login-title",
    );
    loginControl?.focus();
    return;
  }
  const focusTargets: Record<FlowState["kind"], string> = {
    ready: "#camera-input",
    photo: '[data-action="confirm-sighting"], [data-action="check-photo"]',
    "photo-checking": ".loading-row",
    "photo-rejected": ".result-message h2",
    "photo-date": "#photo-observed-on",
    "location-choice": ".result-message h2",
    "location-map": ".result-message h2",
    "candidate-searching": ".loading-row",
    "candidate-result": ".result-message h2",
    "osm-preview": ".result-message h2",
    "development-write-recovery": ".result-message h2",
    "new-aed-preview": ".result-message h2",
    "new-aed-details": ".result-message h2",
    "existing-aed-details": ".result-message h2",
    "candidate-error": ".result-message h2",
  };
  const target = app.querySelector<HTMLElement>(focusTargets[state.kind]);
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
  const selectionVersion = ++photoSession.selectionVersion;
  // Block OAuth as soon as the chooser returns a file; decoding can take long enough to lose it.
  photoSession.selectionPending = true;
  updateAccountPanel();
  if (!file.type.startsWith("image/")) {
    photoSession.selectionPending = false;
    showPhotoSelectionError();
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
    if (selectionVersion === photoSession.selectionVersion) {
      photoSession.selectionPending = false;
      showPhotoSelectionError();
    }
    return;
  }
  if (selectionVersion !== photoSession.selectionVersion) {
    URL.revokeObjectURL(photoUrl);
    return;
  }

  photoSession.selectionPending = false;
  photoSession.selectionError = false;
  clearTimers();
  releasePhoto();
  photoSession.locationFromPhoto = photoLocation;
  // Merken, ob und wann das Foto mit der Kamera der App entstand. Ob der Handy-Standort fehlendes Foto-GPS ersetzen
  // darf, wird erst bei der Fortsetzung geprüft (die Person kann zwischendurch lange warten oder weggehen).
  photoSession.fromCamera = input.id === "camera-input";
  photoSession.capturedAtMs = photoCapturedAtMs;
  // Für die optionale Fotoprüfung merken: die Datei und eine neue Anfragekennung pro Foto.
  photoSession.file = file;
  photoSession.checkRequestId = createVisionRequestId();
  const today = localCalendarDate();
  photoSession.observedOn = photoDate ?? today;
  // Ob nach dem Beobachtungsdatum gefragt wird, entscheidet photoDateNeedsConfirmation:
  // Ein gerade eben aufgenommenes Foto ohne eigenes Datum gilt als heutige Beobachtung. Nennt das
  // Foto dagegen selbst einen anderen Tag als heute, bleibt die ausdrückliche Bestätigung bestehen.
  photoSession.dateRequiresConfirmation = photoDateNeedsConfirmation(
    photoDate,
    today,
    isFreshCapture(photoCapturedAtMs),
  );
  photoSession.searchLocation = undefined;
  photoSession.searchLocationSource = undefined;
  photoSession.mapLocationOverride = undefined;
  state = { kind: "photo", photoUrl };
  render(true);
}

function showPhotoSelectionError(): void {
  photoSession.selectionError = true;
  render();
  app?.querySelector<HTMLElement>(".photo-selection-error")?.focus();
}

async function handleAction(action: string | undefined, source?: HTMLElement): Promise<void> {
  const result = await dispatchUiAction(action, {
    photoLocation: () =>
      dispatchPhotoLocationAction(action, {
        getState: () => state,
        setState: (nextState) => {
          state = nextState;
        },
        photoSession,
        accountSignedIn: accountState === "signed-in",
        photoCheckAvailable,
        phoneLocationPermission,
        phoneLocationFitsPhoto: () =>
          phoneLocationFitsPhoto({ fromCamera: photoSession.fromCamera, capturedAtMs: photoSession.capturedAtMs }),
        readObservedDate: () => app.querySelector<HTMLInputElement>("#photo-observed-on")?.value,
        isValidObservedDate,
        runPhotoCheck: (photoUrl) => {
          void runPhotoCheck(photoUrl);
        },
        proceedAfterSighting,
        continueAfterSighting,
        runNearbySearch: (photoUrl, location) => {
          void runNearbySearch(photoUrl, location);
        },
        clearSearchRetryTimer: () => {
          if (searchRetryTimer) window.clearTimeout(searchRetryTimer);
          searchRetryTimer = undefined;
        },
        render,
      }),
    candidate: () =>
      handleCandidateAction(action, {
        state,
        source,
        observedOn: photoSession.observedOn,
        setState: (nextState) => {
          state = nextState;
        },
        setNewAedPositionOverride: (position) => {
          newAedPositionOverride = position;
        },
      }),
    newEntry: () =>
      handleNewEntryAction(action, {
        state,
        setState: (nextState) => {
          state = nextState;
        },
        newEntryPanelOpen: isNewEntryPanelOpen,
        readPositionConfirmed: () =>
          app.querySelector<HTMLInputElement>("#new-aed-position-confirmed")?.checked === true,
        clearExistingDetailTags: () => {
          detailExistingTags = undefined;
        },
        newAedPositionOverride,
        computePreview: computeNewAedPreview,
        buildDetails: buildDetailTags,
        getDetailForm: () => detailForm,
        updateDetailFooter,
      }),
    existingDetails: () =>
      handleExistingDetailsAction(action, {
        state,
        source,
        observedOn: photoSession.observedOn,
        developmentWriteEnabled: developmentSession && developmentWriteAvailable && Boolean(developmentWriteOwnerHash),
        productionDetailsEnabled: !developmentSession && productionWriteAvailable && Boolean(productionWriteOwnerHash),
        setState: (nextState) => {
          state = nextState;
        },
        resetDetailForm,
        setExistingTags: (tags) => {
          detailExistingTags = tags;
        },
        loadExistingAedNode: (candidateId) => {
          void loadExistingAedNode(candidateId);
        },
        currentDetailPlan,
        updateDetailFooter,
      }),
    developmentWrite: () =>
      handleDevelopmentWriteAction(action, {
        state,
        setState: (nextState) => {
          state = nextState;
        },
        developmentSession,
        developmentWriteAvailable,
        developmentWriteOwnerHash,
        productionWriteAvailable: productionWriteAvailable && accountState === "signed-in" && !developmentSession,
        productionWriteOwnerHash,
        productionNewAedsAvailable: productionNewAedsAvailable && accountState === "signed-in" && !developmentSession,
        productionCorrectionsAvailable:
          developmentCorrectionsAvailable &&
          productionWriteAvailable &&
          accountState === "signed-in" &&
          !developmentSession,
        // Für eine Neuanlage am echten OSM muss der Standort echt sein (Foto-GPS oder Handy), kein Kartenpunkt.
        realLocationAvailable:
          photoSession.searchLocationSource !== undefined && photoSession.searchLocationSource !== "map",
        locale: language,
        accountSignedIn: accountState === "signed-in",
        pendingDevelopmentWrite,
        ...(crypto.randomUUID ? { createOperationId: () => crypto.randomUUID() } : {}),
        prepareSuccessSound: () => successSound.prepare(),
        hasUnresolvedSave,
        clearTimers,
        releasePhoto,
        redirectToDevelopmentLogin: () => window.location.assign("/api/auth/osm/development/start"),
        confirmNewNode: () => app.querySelector<HTMLInputElement>("#new-aed-absence-confirmed")?.checked === true,
        confirmCorrections: () => app.querySelector<HTMLInputElement>("#correction-confirmed")?.checked === true,
        persistPendingWrite: (request) => persistPendingDevelopmentWrite(request),
        render,
        submit: (request) => {
          void submitDevelopmentWrite(request);
        },
        isRecoveryOwnerMismatch,
        openAccount: openAccountFromLamp,
        focusRecoveryLogin: () => {
          // Ein Vorgang am echten OSM braucht die Anmeldung bei OpenStreetMap, einer am Testserver die Testanmeldung.
          const login =
            pendingDevelopmentWrite && isProductionWrite(pendingDevelopmentWrite) ? "#osm-sign-in" : "#osm-dev-sign-in";
          const target = app.querySelector<HTMLElement>(`${login}, #osm-session-retry, #login-title`);
          // Defer until the click's default focus handling has finished.
          window.requestAnimationFrame(() => target?.focus());
        },
        refreshAccountState: () => refreshAccountState(),
        readPendingWrite: readPendingDevelopmentWrite,
      }),
  });
  if (result === "stop") return;
  render(true);
}

function clearTimers(): void {
  if (searchRetryTimer) window.clearTimeout(searchRetryTimer);
  searchRetryTimer = undefined;
}

async function runNearbySearch(photoUrl: string, providedLocation?: SearchLocation): Promise<void> {
  newAedPositionOverride = undefined;
  // Eine neue Suche beginnt eine neue Neuanlage: Angaben der vorherigen sind veraltet.
  resetDetailForm();
  if (searchRetryTimer) window.clearTimeout(searchRetryTimer);
  searchRetryTimer = undefined;
  if (accountState !== "signed-in") {
    accountState = "signed-out";
    render(true);
    return;
  }

  state = { kind: "candidate-searching", photoUrl };
  render(true);
  try {
    const location = providedLocation ?? (await getPhoneLocation());
    photoSession.searchLocation = location;
    const search = await requestNearbyCandidates(location);
    const { assessment } = assessCandidateSearch(location, search, {
      nearbyRadiusMeters: NEARBY_RADIUS_METERS,
      maximumAccuracyMeters: MAX_LOCATION_ACCURACY_METERS,
    });
    // Keep coordinates only in the active in-memory photo flow so a later preview can stay tied to
    // the exact search location. They are discarded when the photo is replaced and never persisted.
    const retryAvailableAt =
      search.status === "partial" ? Date.now() + (search.retryAfterSeconds ?? 30) * 1_000 : undefined;
    state = {
      kind: "candidate-result",
      photoUrl,
      search,
      assessment,
      location,
      ...(retryAvailableAt === undefined ? {} : { retryAvailableAt }),
    };
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
      source_unavailable: "service-unavailable",
      source_timeout: "service-unavailable",
      coverage_unavailable: "service-unavailable",
      outside_coverage: "outside-coverage",
      search_unavailable: "service-unavailable",
      session_unavailable: "service-unavailable",
      network_error: "service-unavailable",
      invalid_response: "invalid-response",
      search_failed: "failed",
    } as const;
    const retryAfterSeconds = error instanceof CandidateSearchError ? error.retryAfterSeconds : undefined;
    const retryAvailableAt = retryAfterSeconds === undefined ? undefined : Date.now() + retryAfterSeconds * 1_000;
    state = {
      kind: "candidate-error",
      photoUrl,
      reason: reasons[code as keyof typeof reasons] ?? "failed",
      ...(retryAvailableAt === undefined ? {} : { retryAvailableAt }),
    };
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
  const waitText = app.querySelector<HTMLElement>(".search-wait");
  if (waitText) waitText.textContent = tv("searchWait", { seconds: remainingSeconds });
  searchRetryTimer = window.setTimeout(
    () => scheduleSearchRetryCountdown(retryAvailableAt),
    Math.min(1_000, retryAvailableAt - Date.now()),
  );
}

function getPhoneLocation(): Promise<SearchLocation> {
  if (!navigator.geolocation) return Promise.reject(new CandidateSearchError("location_unavailable"));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy }),
      (error) =>
        reject(
          new CandidateSearchError(error.code === error.PERMISSION_DENIED ? "location_denied" : "location_unavailable"),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
}

/**
 * Lädt den aktuellen Stand des gewählten AED frisch aus OSM und zeigt dann das Ergänzen-Formular.
 *
 * Die Antwort zählt nur, wenn die Person noch bei genau diesem AED im Ladezustand ist. Ist sie inzwischen
 * zurückgegangen, weitergegangen oder hat das Foto verworfen, wird das späte Ergebnis ignoriert.
 */
async function loadExistingAedNode(candidateId: string): Promise<void> {
  try {
    // Echtes OSM oder Testserver: Die Sitzung bestimmt die Route; der Server prüft das zusätzlich.
    const node = await requestExistingNode(candidateId, fetch, developmentSession ? "development" : "production");
    // Echtes OSM: Die Zuordnung (bis 10 m) beruht auf Position und Version aus der frischen Suche. Hat sich die Version
    // seitdem geändert, kann jemand den AED verschoben haben; dann gilt der Treffer als veraltet, und die Person sucht
    // neu. Die neue Version wird nie ungeprüft übernommen.
    const searched =
      state.kind === "existing-aed-details"
        ? state.returnState.search.candidates.find((item) => item.id === candidateId)
        : undefined;
    if (!developmentSession && searched?.version !== node.version) {
      throw new ExistingNodeError("node_unavailable");
    }
    if (state.kind !== "existing-aed-details" || state.candidateId !== candidateId || state.load.status !== "loading")
      return;
    detailExistingTags = node.tags;
    // Mit freigegebenen Korrekturen ist das Formular mit den bestehenden Werten vorbelegt; Nicht-Darstellbares bleibt gesperrt.
    detailCorrectMode = developmentCorrectionsAvailable;
    if (detailCorrectMode) {
      const prefill = formFromExistingTags(node.tags);
      detailForm = prefill.form;
      detailLockedKeys = prefill.locked;
    } else {
      detailLockedKeys = new Set();
    }
    state = { ...state, load: { status: "ready", node } };
  } catch (error) {
    if (state.kind !== "existing-aed-details" || state.candidateId !== candidateId || state.load.status !== "loading")
      return;
    detailExistingTags = undefined;
    state = {
      ...state,
      load: { status: "error", code: error instanceof ExistingNodeError ? error.code : "service_unavailable" },
    };
  }
  render(true);
}

/**
 * Geht nach bestätigter Sichtbarkeit weiter: erst ggf. die Datumsfrage, dann Standort und Suche.
 * Beide Wege (Selbstbestätigung und bestandene Fotoprüfung) nutzen dieselbe Fortsetzung, damit
 * die Datums- und Standortregeln überall gleich gelten.
 */
function proceedAfterSighting(photoUrl: string): void {
  if (photoSession.dateRequiresConfirmation) {
    state = { kind: "photo-date", photoUrl, suggestedDate: photoSession.observedOn };
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
  const file = photoSession.file;
  const requestId = photoSession.checkRequestId;
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
  if (state.kind !== "photo-checking" || state.photoUrl !== photoUrl || photoSession.file !== file) return;
  if (outcome === "recognized") {
    proceedAfterSighting(photoUrl);
  } else if (outcome === "unavailable") {
    state = {
      kind: "photo",
      photoUrl,
      photoCheck: "unavailable",
      ...(failureCode ? { photoCheckCode: failureCode } : {}),
    };
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
  return error instanceof Error && /^[A-Za-z]{1,40}$/u.test(error.name)
    ? `unexpected_error (${error.name})`
    : "unexpected_error";
}

function continueAfterSighting(photoUrl: string): void {
  if (photoSession.locationFromPhoto) {
    photoSession.searchLocation = photoSession.locationFromPhoto;
    photoSession.searchLocationSource = "photo";
    void runNearbySearch(photoUrl, photoSession.locationFromPhoto);
  } else if (
    phoneLocationPermission === "granted" &&
    phoneLocationFitsPhoto({ fromCamera: photoSession.fromCamera, capturedAtMs: photoSession.capturedAtMs })
  ) {
    // Das iPhone liefert Kamerafotos aus dem Browser oft ohne Ortsangabe. Die Person steht gerade am AED und
    // hat dem Handy den Standort einmal erlaubt: Der Handy-Standort ersetzt das fehlende Foto-GPS, ohne
    // Zwischenfrage. Die Anzeige nennt „Handy-Standort verwendet“. Bei Galerie-Fotos und älteren Aufnahmen
    // bleibt die ausdrückliche Wahl (siehe else), weil das Handy dort woanders sein kann.
    // „phone-auto“ merkt, dass die App den Standort selbst eingesetzt hat: Beim Wiederholen wird die Frische neu geprüft.
    photoSession.searchLocation = undefined;
    photoSession.searchLocationSource = "phone-auto";
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
    onGranted: () => {
      phoneLocationPermission = "granted";
    },
  });
}

function releasePhoto(): void {
  newAedPositionOverride = undefined;
  resetDetailForm();
  photoSession.selectionError = false;
  const photoUrl = getPhotoUrl(state);
  if (photoUrl?.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
  photoSession.locationFromPhoto = undefined;
  photoSession.fromCamera = false;
  photoSession.capturedAtMs = undefined;
  photoSession.file = undefined;
  photoSession.checkRequestId = undefined;
  photoSession.dateRequiresConfirmation = false;
  photoSession.observedOn = localCalendarDate();
  photoSession.searchLocation = undefined;
  photoSession.searchLocationSource = undefined;
  photoSession.mapLocationOverride = undefined;
}

render();
void refreshAccountState();
// Hält die Erlaubnis aktuell, auch wenn die Person sie später in den Systemeinstellungen ändert.
void watchLocationPermission((permission) => {
  phoneLocationPermission = permission;
});
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // Every build gets a new worker URL, including deployments that only change the HTML, manifest or icon.
    const workerUrl = new URL("/sw.js", window.location.origin);
    workerUrl.searchParams.set("revision", __AEDJAEGER_BUILD_REVISION__);
    navigator.serviceWorker.register(workerUrl).catch(() => undefined);
    // Merkt, wenn nach dem Start eine neuere Version veröffentlicht wird, und zeigt dann das Banner.
    startUpdateWatcher({
      runningRevision: __AEDJAEGER_BUILD_REVISION__,
      onUpdate: () => {
        updateAvailable = true;
        renderUpdateBanner();
      },
    });
  });
}
