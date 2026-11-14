import "./styles.css";
import { endOSMSession, loadOSMSession } from "./auth/osmSession";
import type { CandidateResultState, DevelopmentWriteRequest, FlowState } from "./domain/workflow";
import { translate, translations, type Language, type TranslationKey } from "./i18n/translations";
import { translateFlow, type FlowMessageKey } from "./i18n/flowTranslations";
import { readPhotoCapture, readPhotoLocation } from "./vision/photoLocation";
import { createVisionRequestId, preparePhotoForAnalysis, requestVisionObservation, VisionClientError } from "./vision/analyzePhoto";
import { isAedRecognized } from "./contracts/visionObservation";
import { formatBuildTime } from "./pwa/buildInfo";
import { CONFIRM_RADIUS_METERS, MAP_PIN_ACCURACY_METERS, MAX_LOCATION_ACCURACY_METERS, NEARBY_RADIUS_METERS } from "./domain/matchPolicy";
import { successSound } from "./sound/successSound";
import { readStoredValue, removeStoredValue, writeStoredValue } from "./storage/safeStorage";
import { startUpdateWatcher } from "./pwa/updateCheck";
import { askForLocationOnce, phoneLocationFitsPhoto, readLocationPermission, watchLocationPermission, type LocationPermission } from "./location/phoneLocationPermission";
import { assessCandidateSearch } from "./domain/assessCandidateSearch";
import { createPositionPicker, zoomToFitMarkers, type Coordinate, type MapMarker } from "./map/positionPicker";
import { previewExistingAedCheck, previewNewAed } from "./domain/osmChangeProposal";
import {
  ACCESS_VALUES, DETAIL_LIMITS, EMPTY_DETAIL_FORM, INDOOR_VALUES, buildDetailTags, formFromExistingTags, isDetailKey, levelLeftBehindByIndoorChange, planDetailChanges, validateDetailTags,
  type AedDetailForm, type DetailCorrection, type DetailKey, type DetailPlanResult, type DetailTags,
} from "./contracts/aedDetails";
import { CandidateSearchError, requestNearbyCandidates, type SearchLocation } from "./osm/candidateSearch";
import { ExistingNodeError, requestExistingNode } from "./osm/existingNode";
import { formatCalendarDate, isCalendarDate, isFreshCapture, isValidObservedDate, localCalendarDate, photoDateNeedsConfirmation } from "./domain/localDate";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root element was not found.");

const languageNames: Record<Language, string> = { de: "Deutsch", en: "English", pl: "Polski", ja: "日本語", fr: "Français", es: "Español" };
// Exact Maki defibrillator path (CC0 1.0); the Info dialog and SVG assets keep its source visible.
const defibrillatorPath = "m1.54995 7.33811c-2.386799-4.5965 3.63-7.660899 5.952-3.0644 2.3215-4.596499 8.33875-1.5322 5.95235 3.0644-.0869.1671-.2028.3456-.3114.5212h-1.8079l-1.81455-2.7216c-.06321-.09473-.1511-.1704-.25417-.21884-.10308-.04843-.21743-.06779-.3307-.05599-.11327.01181-.22117.05433-.31205.12298-.09087.06865-.16126.16082-.20358.26655l-1.6484 4.12-1.33-1.33c-.11716-.11707-.27597-.18288-.4416-.183h-3.1389c-.1086-.1757-.2245-.3542-.3111-.5213zm9.45005 1.7713c-.103-.00003-.2044-.02545-.2951-.07399-.0908-.04854-.1682-.11871-.2254-.20431l-1.34085-2.0111-1.5587 3.89679c-.03839.096-.10002.181-.17936.2474-.07935.0663-.17393.1119-.27524.1326-.04125.0086-.08327.0128-.1254.0126-.16568.0001-.32462-.0656-.4419-.1826l-1.8169-1.81739h-2.0054c1.36645 1.66819 2.85739 3.23039 4.46 4.67319.08531.077.19616.1197.3111.1197s.22579-.0427.3111-.1197c1.59778-1.4447 3.08545-3.0068 4.45055-4.67319z";
const developmentWriteCopy: Record<Language, { action: string; createAction: string; detailsAction: string; detailsComplete: string; changesAction: string; changesComplete: string; retry: string; sending: string; complete: string; unchanged: string; notFound: string; created: string; uncertain: string; conflict: string; failed: string; }> = {
  de: { action: "Testserver: Prüfdatum speichern", createAction: "Testserver: AED eintragen", detailsAction: "Testserver: Angaben speichern", detailsComplete: "Testserver: Prüfdatum und neue Angaben gespeichert.", changesAction: "Testserver: Änderungen speichern", changesComplete: "Testserver: Prüfdatum und Änderungen gespeichert.", retry: "Testserver: Status erneut prüfen", sending: "Testserver: Änderung wird gesendet…", complete: "Testserver: Vor-Ort-Prüfung gespeichert.", unchanged: "Testserver: Schon aktuell. Es wurde nichts geändert.", notFound: "Testserver: Dieser AED stammt aus dem echten OSM und existiert auf dem Testserver nicht. Es wurde nichts geändert.", created: "Testserver: Neuer AED wurde eingetragen.", uncertain: "Testserver: Ergebnis unklar. Mit derselben Anfrage erneut prüfen; keine neue Änderung wird blind gesendet.", conflict: "Testserver: Nichts wurde geändert. In der Nähe gibt es einen AED, den du noch nicht geprüft hast, oder der Eintrag hat sich geändert. Bitte suche erneut.", failed: "Testserver: Änderung fehlgeschlagen. Bitte Eintrag erneut prüfen." },
  en: { action: "Test server: Save visit date", createAction: "Test server: Add AED", detailsAction: "Test server: Save details", detailsComplete: "Test server: Visit date and new details saved.", changesAction: "Test server: Save changes", changesComplete: "Test server: Visit date and changes saved.", retry: "Test server: Check status again", sending: "Test server: Sending update…", complete: "Test server: Visit confirmation saved.", unchanged: "Test server: Already up to date. Nothing was changed.", notFound: "Test server: This AED comes from the real OSM and does not exist on the test server. Nothing was changed.", created: "Test server: New AED added.", uncertain: "Test server: Result is unclear. Check again using the same request; no new edit will be sent blindly.", conflict: "Test server: Nothing was changed. There is an AED nearby that you have not reviewed yet, or the entry has changed. Please search again.", failed: "Test server: Update failed. Please check the entry again." },
  pl: { action: "Serwer testowy: zapisz datę kontroli", createAction: "Serwer testowy: dodaj AED", detailsAction: "Serwer testowy: zapisz dane", detailsComplete: "Serwer testowy: zapisano datę kontroli i nowe dane.", changesAction: "Serwer testowy: zapisz zmiany", changesComplete: "Serwer testowy: zapisano datę kontroli i zmiany.", retry: "Serwer testowy: sprawdź ponownie stan", sending: "Serwer testowy: wysyłanie zmiany…", complete: "Serwer testowy: zapisano potwierdzenie kontroli.", unchanged: "Serwer testowy: Już aktualne. Nic nie zmieniono.", notFound: "Serwer testowy: Ten AED pochodzi z prawdziwego OSM i nie istnieje na serwerze testowym. Nic nie zmieniono.", created: "Serwer testowy: dodano nowy AED.", uncertain: "Serwer testowy: wynik jest niepewny. Sprawdź ponownie to samo żądanie; nie wyślemy w ciemno nowej zmiany.", conflict: "Serwer testowy: Nic nie zmieniono. W pobliżu jest AED, którego jeszcze nie sprawdzono, albo wpis się zmienił. Wyszukaj ponownie.", failed: "Serwer testowy: nie udało się zapisać zmiany. Sprawdź ponownie wpis." },
  ja: { action: "テストサーバー：確認日を保存", createAction: "テストサーバー：AEDを登録", detailsAction: "テストサーバー：情報を保存", detailsComplete: "テストサーバー：確認日と新しい情報を保存しました。", changesAction: "テストサーバー：変更を保存", changesComplete: "テストサーバー：確認日と変更を保存しました。", retry: "テストサーバー：状態を再確認", sending: "テストサーバー：変更を送信中…", complete: "テストサーバー：現地確認を保存しました。", unchanged: "テストサーバー：すでに最新です。変更はありません。", notFound: "テストサーバー：このAEDは本番のOSMのもので、テストサーバーには存在しません。変更はありません。", created: "テストサーバー：新しいAEDを登録しました。", uncertain: "テストサーバー：結果を確認できません。同じリクエストで再確認してください。新しい変更を無確認で送信しません。", conflict: "テストサーバー：変更はありません。近くに未確認のAEDがあるか、登録内容が変わりました。もう一度検索してください。", failed: "テストサーバー：変更に失敗しました。項目を再確認してください。" },
  fr: { action: "Serveur de test : enregistrer la date", createAction: "Serveur de test : ajouter un DAE", detailsAction: "Serveur de test : enregistrer les informations", detailsComplete: "Serveur de test : date de visite et nouvelles informations enregistrées.", changesAction: "Serveur de test : enregistrer les modifications", changesComplete: "Serveur de test : date de visite et modifications enregistrées.", retry: "Serveur de test : vérifier à nouveau", sending: "Serveur de test : envoi de la modification…", complete: "Serveur de test : visite confirmée.", unchanged: "Serveur de test : déjà à jour. Rien n'a été modifié.", notFound: "Serveur de test : ce DAE provient du vrai OSM et n'existe pas sur le serveur de test. Rien n'a été modifié.", created: "Serveur de test : nouveau DAE ajouté.", uncertain: "Serveur de test : résultat incertain. Vérifiez à nouveau avec la même requête ; aucune nouvelle modification ne sera envoyée à l’aveugle.", conflict: "Serveur de test : rien n'a été modifié. Un DAE à proximité n'a pas encore été vérifié, ou l'entrée a changé. Veuillez relancer la recherche.", failed: "Serveur de test : échec de la modification. Vérifiez à nouveau la fiche." },
  es: { action: "Servidor de pruebas: guardar fecha", createAction: "Servidor de pruebas: añadir DEA", detailsAction: "Servidor de pruebas: guardar datos", detailsComplete: "Servidor de pruebas: fecha de visita y nuevos datos guardados.", changesAction: "Servidor de pruebas: guardar cambios", changesComplete: "Servidor de pruebas: fecha de visita y cambios guardados.", retry: "Servidor de pruebas: comprobar estado", sending: "Servidor de pruebas: enviando cambio…", complete: "Servidor de pruebas: visita confirmada.", unchanged: "Servidor de pruebas: ya está actualizado. No se cambió nada.", notFound: "Servidor de pruebas: este DEA procede del OSM real y no existe en el servidor de pruebas. No se cambió nada.", created: "Servidor de pruebas: se añadió un DEA.", uncertain: "Servidor de pruebas: resultado incierto. Comprueba de nuevo con la misma solicitud; no enviaremos otro cambio a ciegas.", conflict: "Servidor de pruebas: no se cambió nada. Hay un DEA cercano que aún no se ha revisado, o la entrada cambió. Busca de nuevo.", failed: "Servidor de pruebas: no se pudo guardar. Comprueba de nuevo la ficha." },
};
const supportedLanguages = Object.keys(translations) as Language[];
const minimumMapSearchZoom = 15;
const PENDING_DEVELOPMENT_WRITE_KEY_PREFIX = "aedjaeger-pending-osm-development-write:";
const LEGACY_PENDING_DEVELOPMENT_WRITE_KEY = "aedjaeger-pending-osm-development-write";
const PENDING_DEVELOPMENT_WRITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
let language = readLanguage();
let pendingDevelopmentWriteOwnerHash: string | undefined;
let developmentWriteOwnerHash: string | undefined;
let pendingDevelopmentWrite = readPendingDevelopmentWrite();
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
let photoSelectionError = false;
let activePositionPicker: { destroy(): void } | undefined;
let newAedPositionOverride: Coordinate | undefined;
let mapLocationOverride: Coordinate | undefined;
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

type StoredDevelopmentWrite = { version: 1; savedAt: number; expiresAt: number; ownerHash?: string; request: DevelopmentWriteRequest };

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
  } catch { /* Browser storage is optional; legacy session storage remains a best-effort fallback. */ }
  for (const entry of entries) {
    try {
      const envelope: unknown = JSON.parse(entry.value);
      if (isRecord(envelope) && envelope.version === 1 && Number.isSafeInteger(envelope.savedAt)
        && Number.isSafeInteger(envelope.expiresAt) && (envelope.savedAt as number) <= Date.now() + 60_000
        && (envelope.expiresAt as number) > Date.now()
        && (envelope.expiresAt as number) - (envelope.savedAt as number) <= PENDING_DEVELOPMENT_WRITE_LIFETIME_MS) {
        const request = parseDevelopmentWriteRequest(JSON.stringify(envelope.request) ?? "");
        const keyOperationId = entry.key.slice(PENDING_DEVELOPMENT_WRITE_KEY_PREFIX.length);
        if (request && request.operationId === keyOperationId && (!operationId || request.operationId === operationId)) {
          pendingDevelopmentWriteOwnerHash = typeof envelope.ownerHash === "string" && /^[a-f0-9]{64}$/u.test(envelope.ownerHash) ? envelope.ownerHash : undefined;
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
    if (!isRecord(value) || typeof value.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.operationId)
      || typeof value.candidateLabel !== "string" || value.candidateLabel.length > 255 || !isCalendarDate(value.observedOn)) return undefined;
    const kind = legacyCheck ? "check-date" : value.kind;
    if (kind === "check-date" && typeof value.target === "string" && /^node\/[1-9]\d{0,15}$/u.test(value.target)
      && (value.expectedVersion === undefined || Number.isSafeInteger(value.expectedVersion) && (value.expectedVersion as number) > 0)
      && (value.expectedCheckDate === null || isCalendarDate(value.expectedCheckDate))) {
      if (value.details !== undefined) {
        const checkedDetails = validateDetailTags(value.details);
        if (!checkedDetails.ok || Object.keys(checkedDetails.tags).length === 0 || value.expectedVersion === undefined) return undefined;
        value.details = checkedDetails.tags;
      }
      if (value.expectedBefore !== undefined || value.confirmedCorrections !== undefined) {
        const before = value.expectedBefore;
        if (value.details === undefined || value.confirmedCorrections !== true || !isRecord(before) || Object.keys(before).length === 0
          || Object.values(before).some((old) => typeof old !== "string" || old.length === 0 || old.length > 255)) return undefined;
      }
      return { ...value, kind: "check-date" } as unknown as DevelopmentWriteRequest;
    }
    if (kind === "create-node" && typeof value.latitude === "number" && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
      && typeof value.longitude === "number" && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180) {
      const confirmedIds = value.confirmedDifferentCandidateIds ?? [];
      if (!Array.isArray(confirmedIds) || confirmedIds.length > 100
        || confirmedIds.some((id) => typeof id !== "string" || !/^(node|way|relation)\/[1-9]\d{0,15}$/u.test(id))
        || new Set(confirmedIds).size !== confirmedIds.length) return undefined;
      let rawDetails: unknown = value.details;
      if (rawDetails === undefined) {
        if (value.locationDescription === null || value.locationDescription === undefined) rawDetails = {};
        else if (typeof value.locationDescription === "string") rawDetails = { "defibrillator:location": value.locationDescription };
        else return undefined;
      }
      const checkedDetails = validateDetailTags(rawDetails);
      if (!checkedDetails.ok) return undefined;
      return {
        kind: "create-node", operationId: value.operationId, candidateLabel: value.candidateLabel,
        latitude: value.latitude, longitude: value.longitude, observedOn: value.observedOn,
        details: checkedDetails.tags, confirmedDifferentCandidateIds: confirmedIds,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function pendingDevelopmentWriteKey(operationId: string): string { return `${PENDING_DEVELOPMENT_WRITE_KEY_PREFIX}${operationId}`; }

function persistPendingDevelopmentWrite(request: DevelopmentWriteRequest, updateRuntimeState = true, ownerHash = developmentWriteOwnerHash): void {
  const savedAt = Date.now();
  const stored: StoredDevelopmentWrite = {
    version: 1, savedAt, expiresAt: savedAt + PENDING_DEVELOPMENT_WRITE_LIFETIME_MS,
    ...(ownerHash ? { ownerHash } : {}), request,
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
  } catch { /* Die migrierte Kopie in localStorage bleibt maßgeblich. */ }
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
function tv(key: FlowMessageKey, values?: Record<string, number | string>): string { return translateFlow(language, key, values); }
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
  const pendingRecovery = pendingDevelopmentWrite
    ? `<div class="login-status-wrap"><p class="login-status" role="status">${tv("recoveryNeedSignIn")}</p><button class="button button-secondary" data-action="continue-recovery">${tv("recoveryContinue")}</button></div>`
    : "";

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
    <div class="empty-illustration" aria-hidden="true"><span class="device-card">${defibrillatorMark()}</span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>
    <p class="hero-kicker"><span></span>${t("eyebrow")}</p>
    <h1 id="login-title" tabindex="-1">${t("accountGateTitle")}</h1>
    <p class="login-intro">${t("accountGateIntro")}</p>
    <p class="login-requirement">${t("accountRequired")}</p>
    ${status ? `<div class="login-status-wrap">${status}</div>` : ""}
    ${actions ? `<div class="login-actions">${actions}</div>` : ""}
    ${pendingRecovery}
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

/** Bezeichnung eines AED für die Anzeige: Ist keine bekannt (leer), steht ein lesbarer Ersatz da, in der gewählten Sprache. */
function displayCandidateLabel(label: string): string {
  return label.trim() === "" ? tv("unnamedAed") : label;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function getPhotoUrl(current: FlowState): string | undefined {
  return "photoUrl" in current ? current.photoUrl : undefined;
}

function hasUnresolvedSave(current: FlowState): boolean {
  return current.kind === "candidate-searching"
    || (current.kind === "new-aed-preview" && (current.writeStatus === "sending" || current.writeStatus === "uncertain"))
    || (current.kind === "osm-preview" && (current.writeStatus === "sending" || current.writeStatus === "uncertain"));
}

function hasActivePhotoDraft(current: FlowState): boolean {
  return current.kind !== "ready";
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
    confirmedDifferentCandidateIds: current.noneOfTheseConfirmed && current.assessment.kind === "candidate-review"
      ? current.assessment.candidates.map((candidate) => candidate.id)
      : [],
    positionConfirmed,
    observedOn,
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

/** Die Textfelder des Formulars. Sie entsprechen den gleichnamigen Feldern von AedDetailForm. */
type DetailTextField = "location" | "hoursText" | "operator" | "phone" | "description" | "ref";
const DETAIL_TEXT_FIELDS: readonly DetailTextField[] = ["location", "hoursText", "operator", "phone", "description", "ref"];

/** Prüft, ob ein Text aus dem DOM der Name eines Textfelds ist (statt einem Attribut blind zu vertrauen). */
function isDetailTextField(value: string | undefined): value is DetailTextField {
  return value !== undefined && (DETAIL_TEXT_FIELDS as readonly string[]).includes(value);
}

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
  "defibrillator:cabinet": "more",
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

/** Wählt aus einer festen Werteliste den passenden Wert oder `null` („Weiß ich nicht“). */
function pickAllowed<T extends string>(allowed: readonly T[], raw: string): T | null {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/**
 * Eine Auswahl-Kachel. Technisch ein echtes Radio-Feld (versteckt) mit sichtbarem Etikett. Dadurch funktionieren
 * Tastatur (Pfeiltasten), Screenreader und Fokus ohne eigenen Code; die Kachel ist 48 px hoch (siehe styles.css).
 */
function detailRadio(field: "access" | "hoursMode" | "indoor", value: string, label: string, checked: boolean, isUnknown = false): string {
  const id = `detail-${field}-${value === "" ? "unknown" : value}`;
  return `<span class="chip-wrap"><input class="chip-input" type="radio" name="detail-${field}" id="${id}" value="${escapeHtml(value)}" data-detail-radio="${field}"${checked ? " checked" : ""} /><label class="chip${isUnknown ? " chip-unknown" : ""}" for="${id}">${escapeHtml(label)}</label></span>`;
}

/** Ein Textfeld des Formulars; Änderungen landen über den `input`-Handler in `detailForm`. */
function detailTextInput(field: DetailTextField, id: string, maxLength: number, extraAttributes = ""): string {
  return `<input class="field" id="${id}" type="text" maxlength="${maxLength}" value="${escapeHtml(detailForm[field])}" data-detail-text="${field}" autocomplete="off" ${extraAttributes} />`;
}

/** Ein Abschnitt: Überschrift, Hinweis, Inhalt und ein (zunächst verborgener) Platz für die Fehlermeldung. */
function detailGroup(id: string, title: string, hint: string, body: string): string {
  // Ein <div role="group"> statt <fieldset>: Die Überschrift liegt dann sauber IM Kasten (bei <legend> läuft der Rahmen
  // durch sie hindurch). Für Screenreader ist die Gruppe über aria-labelledby genauso benannt.
  return `<div class="detail-group" id="detail-group-${id}" role="group" aria-labelledby="detail-legend-${id}"><p class="detail-legend" id="detail-legend-${id}">${escapeHtml(title)}</p>${hint ? `<p class="detail-hint">${escapeHtml(hint)}</p>` : ""}${body}<p class="detail-was" data-detail-was="${id}" hidden></p><p class="detail-error" role="alert" data-detail-error="${id}" hidden>${tv("detailInvalid")}</p></div>`;
}

/** Text für den Zähler an „Mehr Angaben“: wie viele der seltenen Angaben schon gesetzt sind. */
function detailMoreCountText(): string {
  const set = [detailForm.operator, detailForm.phone, detailForm.description, detailForm.ref].filter((text) => text.trim() !== "").length;
  return set === 0 ? tv("detailMoreOptional") : tv("detailMoreCount", { count: set });
}

/** Beschriftung des Hauptknopfs: nennt, wie viele Angaben mitgehen. */
function detailContinueLabel(count: number): string {
  if (count === 0) return tv("detailContinueNone");
  return count === 1 ? tv("detailContinueOne") : tv("detailContinueMany", { count });
}

/** Ist dieser Schlüssel am bestehenden AED schon eingetragen? (Nur beim Ergänzen; bei einer Neuanlage immer false.) */
function detailHas(key: DetailKey): boolean {
  return detailExistingTags !== undefined && Object.prototype.hasOwnProperty.call(detailExistingTags, key);
}

/**
 * Ist das Feld zu diesem Schlüssel gesperrt?
 *  - Neuanlage: nie.
 *  - Ergänzen (nur Fehlendes): alles, was in OSM schon steht.
 *  - Korrigieren: nur, was sich im Formular nicht darstellen lässt. Alles andere ist vorbelegt und änderbar.
 */
function detailLocked(key: DetailKey): boolean {
  if (detailExistingTags === undefined) return false;
  return detailCorrectMode ? detailLockedKeys.has(key) : detailHas(key);
}

/** Zeigt einen bestehenden OSM-Wert in der Sprache der Person, soweit er einer unserer Auswahlwerte ist. */
function existingValueLabel(key: DetailKey, value: string): string {
  if (key === "access") return ({ yes: tv("detailAccessYes"), customers: tv("detailAccessCustomers"), private: tv("detailAccessPrivate") } as Record<string, string>)[value] ?? value;
  if (key === "indoor") return ({ yes: tv("detailIndoorYes"), no: tv("detailIndoorNo") } as Record<string, string>)[value] ?? value;
  if (key === "opening_hours" && value === "24/7") return tv("detailHoursAlways");
  return value;
}

/** Zeile „Schon eingetragen: …“ für einen gesperrten Wert. Der Wert kommt aus OSM und wird wie jeder fremde Text maskiert. */
function detailLockedLine(key: DetailKey): string {
  const value = detailExistingTags?.[key] ?? "";
  // Im Korrekturmodus ist ein gesperrter Wert einer, den das Formular nicht darstellen kann: Das sagt ein kurzer Hinweis.
  const note = detailCorrectMode ? `<p class="detail-hint">${tv("detailNotEditable")}</p>` : "";
  return `<p class="detail-locked">${escapeHtml(tv("detailExistingValue", { value: existingValueLabel(key, value) }))}</p>${note}`;
}

/**
 * Sind beim bestehenden AED alle Angaben schon eingetragen, die das Formular erfassen kann?
 * Dann gibt es nichts zu ergänzen, und die Oberfläche sagt es.
 */
function detailEverythingPresent(): boolean {
  // Im Korrekturmodus gibt es immer etwas zu tun (vorhandene Werte lassen sich ändern).
  if (detailExistingTags === undefined || detailCorrectMode) return false;
  const keys: DetailKey[] = ["defibrillator:location", "access", "opening_hours", "indoor", "operator", "phone", "description", "ref"];
  if (!keys.every(detailHas)) return false;
  // Die Ebene fehlt nur dann nicht, wenn sie schon da ist oder der AED nicht im Gebäude hängt.
  return detailHas("level") || detailExistingTags.indoor !== "yes";
}

/**
 * Der Formularteil (alles außer Fußleiste). Wird bei Auswahländerungen komplett neu geschrieben.
 * Beim Ergänzen eines bestehenden AED (detailExistingTags gesetzt) erscheint jedes schon eingetragene Feld nur als
 * gesperrte Zeile „Schon eingetragen: …“. Nur Fehlendes lässt sich ausfüllen.
 */
function detailFormMarkup(): string {
  const f = detailForm;
  const unknown = tv("detailUnknown");
  // Im Korrekturmodus ist bei einem vorhandenen Wert „Weiß ich nicht“ überflüssig: Den alten Wert wählt die Person einfach wieder an.
  const hasValue = (key: DetailKey): boolean => detailCorrectMode && detailHas(key);

  // 1. Wo genau? Textfeld plus Schnellwahl-Wörter, die ans Ende des Textes angehängt werden.
  const quickWords = [tv("detailLocEntrance"), tv("detailLocFoyer"), tv("detailLocOutside"), tv("detailLocReception"), tv("detailLocStairs")];
  const location = detailGroup("location", tv("detailLocationLabel"), detailLocked("defibrillator:location") ? "" : tv("detailLocationHint"),
    detailLocked("defibrillator:location")
      ? detailLockedLine("defibrillator:location")
      : `<input class="field" id="detail-location" type="text" maxlength="${DETAIL_LIMITS.location}" value="${escapeHtml(f.location)}" data-detail-text="location" autocomplete="off" placeholder="${escapeHtml(tv("detailLocationPlaceholder"))}" aria-label="${escapeHtml(tv("detailLocationLabel"))}" />`
        + `<div class="chip-row">${quickWords.map((word) => `<button type="button" class="chip chip-small" data-detail-addloc="${escapeHtml(word)}">${escapeHtml(word)}</button>`).join("")}</div>`);

  // 2. Wer kommt ran? Die Frage meint das Gerät, nicht das Gebäude.
  const access = detailGroup("access", tv("detailAccessLabel"), detailLocked("access") ? "" : tv("detailAccessHint"),
    detailLocked("access")
      ? detailLockedLine("access")
      : `<div class="chip-row">${detailRadio("access", "yes", tv("detailAccessYes"), f.access === "yes")}${detailRadio("access", "customers", tv("detailAccessCustomers"), f.access === "customers")}${detailRadio("access", "private", tv("detailAccessPrivate"), f.access === "private")}${hasValue("access") ? "" : detailRadio("access", "", unknown, f.access === null, true)}</div>`);

  // 3. Wann erreichbar? „Rund um die Uhr“ nur nach ausdrücklicher Wahl; das Zeiten-Feld erscheint bei „Zu bestimmten Zeiten“.
  const timesField = f.hoursMode === "times"
    ? `<div class="detail-sub"><label class="detail-hint" for="detail-hours-text">${tv("detailHoursTextLabel")}</label>${detailTextInput("hoursText", "detail-hours-text", DETAIL_LIMITS.openingHours, 'placeholder="Mo-Fr 08:00-18:00" autocapitalize="off" spellcheck="false"')}<div class="chip-row"><button type="button" class="chip chip-small" data-detail-hours-preset="Mo-Fr 08:00-18:00">Mo-Fr 08:00-18:00</button><button type="button" class="chip chip-small" data-detail-hours-preset="Mo-Sa 07:00-20:00">Mo-Sa 07:00-20:00</button></div></div>`
    : "";
  const hours = detailGroup("hours", tv("detailHoursLabel"), detailLocked("opening_hours") ? "" : tv("detailHoursHint"),
    detailLocked("opening_hours")
      ? detailLockedLine("opening_hours")
      : `<div class="chip-row">${detailRadio("hoursMode", "always", tv("detailHoursAlways"), f.hoursMode === "always")}${detailRadio("hoursMode", "times", tv("detailHoursTimes"), f.hoursMode === "times")}${hasValue("opening_hours") ? "" : detailRadio("hoursMode", "", unknown, f.hoursMode === null, true)}</div>${timesField}`);

  // 4. Drinnen oder draußen? Die Ebene erscheint nur bei „Drinnen“ (gewählt oder in OSM schon eingetragen).
  // Der erste Tipp auf + oder − setzt 0 (Erdgeschoss).
  const effectiveIndoor = detailLocked("indoor") ? detailExistingTags?.indoor : f.indoor;
  const levelField = effectiveIndoor === "yes"
    ? (detailLocked("level")
      ? detailLockedLine("level")
      : `<div class="detail-sub"><span class="detail-hint" id="detail-level-label">${tv("detailLevelLabel")}</span><div class="stepper" role="group" aria-labelledby="detail-level-label"><button type="button" class="step-button" id="detail-level-down" data-detail-step="-1" aria-label="${escapeHtml(tv("detailLevelLower"))}">−</button><output class="step-value" id="detail-level-value" aria-live="polite">${f.level === null ? "–" : f.level}</output><button type="button" class="step-button" id="detail-level-up" data-detail-step="1" aria-label="${escapeHtml(tv("detailLevelHigher"))}">+</button>${hasValue("level") ? "" : `<button type="button" class="chip chip-small chip-unknown" id="detail-level-clear" data-detail-level-clear="1">${unknown}</button>`}</div></div>`)
    : "";
  const indoor = detailGroup("indoor", tv("detailIndoorLabel"), "",
    (detailLocked("indoor")
      ? detailLockedLine("indoor")
      : `<div class="chip-row">${detailRadio("indoor", "yes", tv("detailIndoorYes"), f.indoor === "yes")}${detailRadio("indoor", "no", tv("detailIndoorNo"), f.indoor === "no")}${hasValue("indoor") ? "" : detailRadio("indoor", "", unknown, f.indoor === null, true)}</div>`) + levelField);

  // 5. Seltene Angaben, eingeklappt. Gehäuse bleibt vorerst draußen (offene Entscheidung, siehe docs/offene-fragen.md).
  // Jedes Feld ist entweder gesperrt (schon eingetragen) oder ein Eingabefeld.
  const moreField = (key: "operator" | "phone" | "description" | "ref", label: string, maxLength: number, extra = "", note = ""): string => detailLocked(key)
    ? `<div><span class="detail-hint">${label}</span>${detailLockedLine(key)}</div>`
    : `<div><label class="detail-hint" for="detail-${key}">${label}</label>${detailTextInput(key, `detail-${key}`, maxLength, extra)}${note}</div>`;
  const more = `<details class="detail-more" id="detail-more"${detailMoreOpen ? " open" : ""}><summary><span>${tv("detailMoreTitle")}</span><span class="detail-more-count" id="detail-more-count">${detailMoreCountText()}</span></summary><div class="detail-more-body">`
    + moreField("operator", tv("detailOperatorLabel"), DETAIL_LIMITS.operator)
    + moreField("phone", tv("detailPhoneLabel"), DETAIL_LIMITS.phone, 'inputmode="tel" autocomplete="off"', `<p class="detail-hint">${tv("detailPhoneHint")}</p>`)
    + moreField("description", tv("detailDescriptionLabel"), DETAIL_LIMITS.description)
    + moreField("ref", tv("detailRefLabel"), DETAIL_LIMITS.ref)
    + `<p class="detail-hint">${tv("detailNoCode")}</p><p class="detail-was" data-detail-was="more" hidden></p><p class="detail-error" role="alert" data-detail-error="more" hidden>${tv("detailInvalid")}</p></div></details>`;

  return `${location}${access}${hours}${indoor}${more}`;
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
  const button = app!.querySelector<HTMLButtonElement>("#detail-continue");
  if (button) {
    button.disabled = !built.ok;
    button.textContent = detailContinueLabel(built.ok ? Object.keys(built.tags).length : 0);
  }
  const failingGroup = !built.ok && isDetailKey(built.key) ? DETAIL_GROUP_OF_KEY[built.key] : undefined;
  app!.querySelectorAll<HTMLElement>("[data-detail-error]").forEach((slot) => { slot.hidden = slot.dataset.detailError !== failingGroup; });
  // Steckt der Fehler in „Mehr Angaben“, muss der Abschnitt offen sein, sonst sieht ihn niemand.
  if (failingGroup === "more") {
    const details = app!.querySelector<HTMLDetailsElement>("#detail-more");
    if (details) details.open = true;
  }
  const moreCount = app!.querySelector<HTMLElement>("#detail-more-count");
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
  indoor: "detailIndoorLabel", level: "detailLevelLabel", operator: "detailOperatorLabel", phone: "detailPhoneLabel", description: "detailDescriptionLabel", ref: "detailRefLabel",
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
    const was = tv("detailWas", { value: existingValueLabel(correction.key, correction.before) });
    linesByGroup.set(group, [...(linesByGroup.get(group) ?? []), label ? `${tv(label)}: ${was}` : was]);
  }
  app!.querySelectorAll<HTMLElement>("[data-detail-was]").forEach((slot) => {
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
  const host = app!.querySelector<HTMLElement>("#detail-form");
  if (!host) return;
  host.innerHTML = detailFormMarkup();
  updateDetailFooter();
  if (focusId) document.getElementById(focusId)?.focus();
}

/** Setzt den Wert des Ebenen-Zählers in der Anzeige (ohne Neuzeichnen). */
function showDetailLevel(): void {
  const output = app!.querySelector<HTMLOutputElement>("#detail-level-value");
  if (output) output.textContent = detailForm.level === null ? "–" : String(detailForm.level);
}

/**
 * Verbindet das Formular mit seinen Eingaben. Die Abhörer hängen am äußeren Behälter #detail-form, der beim
 * Neuzeichnen des Inhalts bestehen bleibt: So gibt es nie doppelte Abhörer und keine verlorenen.
 * Wird von render() aufgerufen, nachdem die Seite neu geschrieben wurde.
 */
function bindDetailForm(): void {
  const host = app!.querySelector<HTMLElement>("#detail-form");
  if (!host) return;

  // Auswahlfelder (Radio): Wert speichern, bei Bedarf Folgefelder ein- oder ausblenden.
  host.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "radio") return;
    const field = target.dataset.detailRadio;
    if (field === "access") {
      detailForm.access = pickAllowed(ACCESS_VALUES, target.value);
    } else if (field === "indoor") {
      detailForm.indoor = pickAllowed(INDOOR_VALUES, target.value);
      // Die Ebene gehört nur zu einem Gerät im Gebäude.
      if (detailForm.indoor !== "yes") detailForm.level = null;
    } else if (field === "hoursMode") {
      detailForm.hoursMode = pickAllowed(["always", "times"] as const, target.value);
    } else {
      return;
    }
    refreshDetailForm(target.id);
  });

  // Textfelder: nur das Modell und die Fußleiste aktualisieren, das Feld selbst bleibt unangetastet.
  host.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const field = target.dataset.detailText;
    if (!isDetailTextField(field)) return;
    detailForm[field] = target.value;
    updateDetailFooter();
  });

  // Knöpfe im Formular: Schnellwahl für den Standort, Zeiten-Vorlagen, Ebenen-Zähler.
  host.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button");
    if (!button) return;
    if (button.dataset.detailAddloc !== undefined) {
      const base = detailForm.location.trim();
      const next = base === "" ? button.dataset.detailAddloc : `${base}, ${button.dataset.detailAddloc}`;
      if (next.length > DETAIL_LIMITS.location) return;
      detailForm.location = next;
      const input = host.querySelector<HTMLInputElement>("#detail-location");
      if (input) input.value = next;
      updateDetailFooter();
    } else if (button.dataset.detailHoursPreset !== undefined) {
      detailForm.hoursText = button.dataset.detailHoursPreset;
      const input = host.querySelector<HTMLInputElement>("#detail-hours-text");
      if (input) input.value = detailForm.hoursText;
      updateDetailFooter();
    } else if (button.dataset.detailStep !== undefined) {
      const step = Number(button.dataset.detailStep) < 0 ? -1 : 1;
      // Der erste Tipp landet auf 0 (Erdgeschoss), egal in welche Richtung: Das ist der häufigste Fall.
      detailForm.level = detailForm.level === null ? 0 : Math.max(DETAIL_LIMITS.levelMin, Math.min(DETAIL_LIMITS.levelMax, detailForm.level + step));
      showDetailLevel();
      updateDetailFooter();
    } else if (button.dataset.detailLevelClear !== undefined) {
      detailForm.level = null;
      showDetailLevel();
      updateDetailFooter();
    }
  });

  // Aufklappen merken, damit „Mehr Angaben“ beim Neuzeichnen offen bleibt. Das Ereignis „toggle“ bubbelt nicht,
  // deshalb wird es in der Aufnahmephase am Behälter abgefangen.
  host.addEventListener("toggle", (event) => {
    if (event.target instanceof HTMLDetailsElement && event.target.id === "detail-more") detailMoreOpen = event.target.open;
  }, true);

  // Stand von Knopf, Fehlermeldungen und „Vorher“-Zeilen sofort herstellen (wichtig beim Zurückkehren aus der Vorschau).
  updateDetailFooter();
}

function statusContent(): string {
  const photoUrl = getPhotoUrl(state);
  const photoMarkup = photoUrl ? `<img class="photo-preview" src="${escapeHtml(photoUrl)}" alt="${t("photoAlt")}" />` : "";
  switch (state.kind) {
    case "ready":
      return `<div class="empty-illustration" aria-hidden="true"><span class="device-card">${defibrillatorMark()}</span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>`;
    case "photo": {
      // The first pilot deliberately relies on the person's on-site confirmation, not a model.
      // The image and its remaining metadata stay in this browser; only selected coordinates
      // leave it later when the person explicitly starts a location search.
      //
      // Neu: Gibt der Server die Fotoprüfung für dieses Konto frei, ersetzt „AED gesehen – Foto
      // prüfen“ die reine Selbstbestätigung. Dann ehrlich anzeigen, dass das Foto (ohne Standort und
      // Metadaten) das Gerät verlässt. Ist die Prüfung gescheitert (photoCheck „unavailable“),
      // gilt wieder die Selbstbestätigung samt Hinweis, damit die App nicht an OpenAI hängt.
      const useCheck = photoCheckAvailable && state.photoCheck !== "unavailable" && selectedPhotoFile !== undefined;
      const photoAction = useCheck
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
      return `${photoMarkup}${photoAction}${photoNote}<button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
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
          const name = displayCandidateLabel(candidate.tags.name || candidate.tags["defibrillator:location"] || "");
          const label = numbered ? `${index + 1}. ${name}` : name;
          const distance = distanceMeters === undefined ? "" : `<span>${escapeHtml(tv("distance", { distance: Math.round(distanceMeters) }))}</span>`;
          // Zwei Stufen (siehe src/domain/matchPolicy.ts): Bis 10 m ist es ein Treffer zum Bestätigen. Zwischen 10 und
          // 50 m steht nur ein Hinweis mit der Entfernung; der AED muss vor einer Neuanlage geprüft werden, lässt sich
          // aber nicht als "noch vorhanden" bestätigen.
          const tooFarToConfirm = distanceMeters !== undefined && distanceMeters > CONFIRM_RADIUS_METERS;
          // Zweiter Weg direkt aus der Liste: Angaben ansehen und ergänzen (bzw. ändern), bevor das Datum bestätigt wird. Das
          // Datum folgt am Ende mit einem Speichern für alles. Nur für AEDs, die es auf dem Testserver gibt: Ein AED aus dem
          // Archiv des echten OSM existiert dort nicht und lässt sich nicht bearbeiten.
          const detailsAction = developmentSession && developmentWriteAvailable && developmentWriteOwnerHash && candidate.source !== "archive"
            ? `<button class="button button-secondary" data-action="open-candidate-details" data-candidate-id="${escapeHtml(candidate.id)}">${tv(developmentCorrectionsAvailable ? "candidateDetailsChange" : "candidateDetailsView")}</button>`
            : "";
          const reviewAction = candidate.osmType !== "node"
            ? `<span class="supporting-copy">${tv("previewUnsupportedShort")}</span>`
            : tooFarToConfirm
              ? `<span class="supporting-copy">${tv("candidateTooFar", { meters: CONFIRM_RADIUS_METERS })}</span>`
              : `<button class="button button-secondary" data-action="preview-candidate" data-candidate-id="${escapeHtml(candidate.id)}">${tv("selectCandidate")}</button>${detailsAction}`;
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
    case "new-aed-details": {
      // Kleines Foto oben, damit das Formular Platz hat. Die eigentliche Arbeit passiert in #detail-form (siehe bindDetailForm).
      const thumbnail = photoMarkup.replace('class="photo-preview"', 'class="photo-preview photo-thumb"');
      return `<div class="detail-form-root">${thumbnail}<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><h2>${tv("detailsTitle")}</h2><p>${tv("detailsIntro")}</p></div></div><div id="detail-form">${detailFormMarkup()}</div>${detailFooterMarkup()}</div>`;
    }
    case "new-aed-preview": {
      const point = state.result.kind === "ready" ? state.result.position : state.returnState.location;
      const latitude = point.latitude.toFixed(5);
      const longitude = point.longitude.toFixed(5);
      const content = state.result.kind === "ready"
        ? `<p>${tv("newPreviewCoordinates", { latitude, longitude })}</p><strong>${tv("newPreviewTags")}</strong><ul>${Object.entries(state.result.tags).map(([key, value]) => `<li><code>${escapeHtml(key)}=${escapeHtml(value)}</code></li>`).join("")}</ul><p>${state.result.confirmedDifferentCandidateIds.length > 0 ? tv("newPreviewReviewedCandidates") : tv("newPreviewCaution")}</p>`
        : `<p>${tv(state.result.reason === "position-not-confirmed" ? "newPositionRequired" : state.result.reason === "search-found-candidate" ? "newPreviewFoundCandidate" : "newPreviewSearchInvalid")}</p>`;
      const copy = developmentWriteCopy[language];
      const canCreate = developmentSession && developmentWriteAvailable && Boolean(developmentWriteOwnerHash) && state.result.kind === "ready";
      const statusCopy = state.writeStatus === "complete" ? copy.created : state.writeStatus ? copy[state.writeStatus] : "";
      const blockedRecovery = state.writeStatus === "uncertain" && (isRecoveryOwnerMismatch() || !developmentSession || !developmentWriteAvailable)
        ? `<p class="simulation-note" role="status">${tv(isRecoveryOwnerMismatch() ? "recoveryWrongAccount" : !developmentSession ? "recoveryNeedSignIn" : "recoveryWritesDisabled")}</p>` : "";
      const writeStatus = state.writeStatus ? `<p role="status" class="simulation-note ${state.writeStatus === "complete" ? "save-status-success" : ""}">${statusCopy}</p>${blockedRecovery}` : "";
      // Zweite von zwei Bestätigungen für eine Neuanlage: Ohne diesen Haken bleibt der
      // Speichern-Knopf gesperrt. Der Klick-Handler prüft den Haken zusätzlich noch einmal.
      const writeAction = canCreate && !state.writeStatus
        ? `<div class="position-confirmation"><label for="new-aed-absence-confirmed"><input id="new-aed-absence-confirmed" type="checkbox" /><span>${tv("newAbsenceConfirm")}</span></label></div><button class="button button-primary" data-action="create-development-node" disabled>${copy.createAction}</button>`
        : state.writeStatus === "uncertain" && state.operationId && !isRecoveryOwnerMismatch()
          ? `<button class="button button-secondary" data-action="retry-development-write">${developmentSession && developmentWriteAvailable ? copy.retry : tv("recoveryContinue")}</button>`
          : "";
      // Der Hinweis „nur eine Vorschau“ steht nur, wenn es nichts zu speichern gibt. Mit Speichern-Knopf sagt dessen
      // Beschriftung („Testserver: AED eintragen“) schon, wohin die Änderung geht.
      // Der Hinweis „nur eine Vorschau“ gilt nur, wenn gar nichts gespeichert werden kann und kein Vorgang läuft. Nach einem
      // Speichern (oder währenddessen) wäre er falsch; dann sagt die Statusmeldung, was passiert ist.
      const noWriteNotice = !canCreate && !state.writeStatus ? `<p class="simulation-note">${tv("previewNoWrite")}</p>` : "";
      // „Zurück“ bleibt hier immer: Es führt zur Positionsbestätigung bzw. zur Suche, nicht nur zu Treffern.
      // Kommt die Vorschau aus dem Detailformular, führt „Zurück“ dorthin (die Eingaben bleiben erhalten). Sonst zur Suche.
      const backButton = state.detailsPosition
        ? `<button class="button button-quiet" data-action="back-to-details">${tv("detailsBackToForm")}</button>`
        : `<button class="button button-quiet" data-action="back-to-search">${tv("previewBack")}</button>`;
      const navigation = state.writeStatus === "sending" || state.writeStatus === "uncertain" ? ""
        : state.writeStatus === "complete" ? `<button class="button button-primary" data-action="retake">${tv("nextAed")}</button>`
          : `${backButton}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
      const successful = state.writeStatus === "complete";
      return `${photoMarkup}<div class="result-message"><span class="status-icon ${successful ? "status-good" : "status-warn"}" aria-hidden="true">${successful ? "✓" : "?"}</span><div><h2>${tv("newPreviewTitle")}</h2>${content}${noWriteNotice}${writeStatus}</div></div>${writeAction}${navigation}`;
    }
    case "osm-preview": {
      const { result } = state;
      const candidateId = state.candidateId;
      const candidate = state.returnState.search.candidates.find((item) => item.id === candidateId);
      // Ein AED aus dem Archiv des echten OSM gibt es auf dem Testserver nicht. Dafür gibt es dort keinen Speichern-Knopf.
      const archiveOnly = developmentSession && developmentWriteAvailable && candidate?.source === "archive";
      const canWrite = developmentSession && developmentWriteAvailable && Boolean(developmentWriteOwnerHash) && candidate?.osmType === "node" && result.kind === "ready" && !archiveOnly;
      // Nur das Wesentliche: das neue Prüfdatum. Der bisherige Wert steht nur da, wenn es einen gibt.
      const content = result.kind === "ready"
        ? `<p><strong>${tv("previewNewDate", { date: formatCalendarDate(result.changes[0].after, language) })}</strong></p>${result.changes[0].before ? `<p>${tv("previewOldDate", { date: escapeHtml(formatCalendarDate(result.changes[0].before, language)) })}</p>` : ""}`
        : result.reason === "newer-check-date-exists" && result.existingDate
          ? `<p>${tv("previewNewerDate", { date: escapeHtml(formatCalendarDate(result.existingDate, language)) })}</p>`
          : `<p>${tv("previewUnsupported")}</p>`;
      // Kommt die Vorschau aus dem Ergänzen-Formular, stehen hier die neuen Tags. Sie werden vor dem Speichern genau gezeigt.
      const corrections = state.corrections ?? [];
      const correctedKeys = new Set<string>(corrections.map((correction) => correction.key));
      const addedTags = state.details ? Object.entries(state.details).filter(([key]) => !correctedKeys.has(key)) : [];
      const addedList = addedTags.length > 0
        ? `<p><strong>${tv("detailsAddedTitle")}</strong></p><ul>${addedTags.map(([key, value]) => `<li><code>${escapeHtml(key)}=${escapeHtml(value)}</code></li>`).join("")}</ul>`
        : "";
      // Korrekturen als „alt → neu“: Der alte Wert steht durchgestrichen davor. Alle Werte stammen aus OSM oder der Eingabe und werden maskiert.
      const changedList = corrections.length > 0
        ? `<p><strong>${tv("detailsChangedTitle")}</strong></p><ul>${corrections.map((correction) => `<li><code>${escapeHtml(correction.key)}=<span class="detail-old">${escapeHtml(correction.before)}</span> → ${escapeHtml(correction.after)}</code></li>`).join("")}</ul>`
        : "";
      // Bleibt nach „draußen“ eine alte Ebene stehen, sagt die Vorschau es offen (AEDjaeger löscht nie etwas).
      const levelLeft = state.details && state.node ? levelLeftBehindByIndoorChange(state.node.tags, state.details) : null;
      const levelLeftNote = levelLeft === null ? "" : `<p class="detail-hint">${escapeHtml(tv("detailLevelStays", { level: levelLeft }))}</p>`;
      const copy = developmentWriteCopy[language];
      const completeText = corrections.length > 0 ? copy.changesComplete : addedTags.length > 0 ? copy.detailsComplete : copy.complete;
      const statusText = state.writeStatus === "complete" ? completeText : state.writeStatus ? copy[state.writeStatus] : "";
      const blockedRecovery = state.writeStatus === "uncertain" && (isRecoveryOwnerMismatch() || !developmentSession || !developmentWriteAvailable)
        ? `<p class="simulation-note" role="status">${tv(isRecoveryOwnerMismatch() ? "recoveryWrongAccount" : !developmentSession ? "recoveryNeedSignIn" : "recoveryWritesDisabled")}</p>` : "";
      const writeStatus = state.writeStatus ? `<p role="status" class="simulation-note ${state.writeStatus === "complete" ? "save-status-success" : ""}">${statusText}</p>${blockedRecovery}` : "";
      // Der zweite Weg neben dem Ein-Tipp-Speichern: fehlende Angaben ergänzen. Nur beim einfachen Prüfdatum-Vorschlag.
      const addDetailsButton = canWrite && !state.writeStatus && !state.node
        ? `<button class="button button-secondary" data-action="open-existing-details">${tv(developmentCorrectionsAvailable ? "detailsCorrectAction" : "detailsAddAction")}</button>`
        : "";
      // Zweite Bestätigung bei Korrekturen: Ohne den Haken „alter Wert stimmt nicht“ bleibt der Speichern-Knopf gesperrt.
      // Der Klick-Handler prüft den Haken zusätzlich noch einmal.
      const correctionConfirmation = canWrite && !state.writeStatus && corrections.length > 0
        ? `<div class="position-confirmation"><label for="correction-confirmed"><input id="correction-confirmed" type="checkbox" /><span>${tv("detailsCorrectionConfirm")}</span></label></div>`
        : "";
      const saveLabel = corrections.length > 0 ? copy.changesAction : addedTags.length > 0 ? copy.detailsAction : copy.action;
      const writeAction = canWrite && !state.writeStatus
        ? `${correctionConfirmation}<button class="button button-primary" data-action="save-development-check"${corrections.length > 0 ? " disabled" : ""}>${saveLabel}</button>`
        : state.writeStatus === "uncertain" && state.operationId && !isRecoveryOwnerMismatch()
          ? `<button class="button button-secondary" data-action="retry-development-write">${developmentSession && developmentWriteAvailable ? copy.retry : tv("recoveryContinue")}</button>`
          : "";
      // Nur wenn nichts gespeichert werden kann und kein Vorgang läuft; sonst wäre „nur eine Vorschau“ nach einem Speichern falsch.
      // Bei einem neueren Datum in OSM sagt die Meldung selbst, dass nichts geändert wird; „nur eine Vorschau“ wäre doppelt.
      const newerDateInOsm = result.kind === "blocked" && result.reason === "newer-check-date-exists";
      const noWriteNotice = !canWrite && !state.writeStatus && !newerDateInOsm ? `<p class="simulation-note">${archiveOnly ? tv("previewArchiveNotice") : tv("previewNoWrite")}</p>` : "";
      const recoverableWrite = state.writeStatus === "sending" || state.writeStatus === "uncertain";
      // „Zurück“ gibt es nur, wenn es mehrere Treffer zur Auswahl gab. Bei einem einzigen Treffer hätte es keine Bedeutung.
      // Gezählt wird wie in der Trefferliste: Bei „candidate-review“ die bewerteten Treffer, sonst alle Suchtreffer.
      const shownCandidates = state.returnState.assessment.kind === "candidate-review" ? state.returnState.assessment.candidates.length : state.returnState.search.candidates.length;
      const hasOtherCandidates = shownCandidates > 1;
      // Aus dem Ergänzen-Formular führt „Zurück“ dorthin (die Eingaben bleiben), sonst zur Trefferliste.
      const backButton = state.node
        ? `<button class="button button-quiet" data-action="back-to-existing-details">${tv("detailsBackToForm")}</button>`
        : hasOtherCandidates ? `<button class="button button-quiet" data-action="back-to-candidates">${tv("previewBack")}</button>` : "";
      const navigation = recoverableWrite ? ""
        : state.writeStatus === "complete" ? `<button class="button button-primary" data-action="retake">${tv("nextAed")}</button>`
          : `${backButton}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
      const successful = state.writeStatus === "complete";
      return `${photoMarkup}<div class="result-message"><span class="status-icon ${successful ? "status-good" : "status-warn"}" aria-hidden="true">${successful ? "✓" : "?"}</span><div><h2>${tv("previewTitle")}</h2><p><strong>${escapeHtml(displayCandidateLabel(state.candidateLabel))}</strong></p>${content}${changedList}${addedList}${levelLeftNote}${noWriteNotice}${writeStatus}</div></div>${writeAction}${addDetailsButton}${navigation}`;
    }
    case "existing-aed-details": {
      const label = escapeHtml(displayCandidateLabel(state.candidateLabel));
      const header = `<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><h2>${tv(developmentCorrectionsAvailable ? "detailsCorrectTitle" : "detailsExistingTitle")}</h2><p><strong>${label}</strong></p><p>${tv(developmentCorrectionsAvailable ? "detailsCorrectIntro" : "detailsExistingIntro")}</p></div></div>`;
      if (state.load.status === "loading") {
        return `${photoMarkup}${header}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${tv("detailLoading")}</span></div>`;
      }
      if (state.load.status === "error") {
        const message = state.load.code === "node_unavailable" ? tv("detailLoadChanged") : state.load.code === "authentication_required" ? tv("errorSignIn") : tv("detailLoadFailed");
        // Ist der Eintrag weg, hilft Wiederholen nicht; dann bleibt nur der Rückweg.
        const retry = state.load.code === "node_unavailable" ? "" : `<button class="button button-secondary" data-action="existing-details-retry">${tv("detailLoadRetry")}</button>`;
        return `${photoMarkup}${header}<p class="simulation-note" role="alert">${message}</p>${retry}<button class="button button-quiet" data-action="back-from-existing-details">${tv("previewBack")}</button>`;
      }
      const thumbnail = photoMarkup.replace('class="photo-preview"', 'class="photo-preview photo-thumb"');
      const allPresent = detailEverythingPresent() ? `<p class="simulation-note">${tv("detailsAllPresent")}</p>` : "";
      // Das bisherige Prüfdatum aus OSM, damit die Person sieht, wie aktuell der Eintrag ist, bevor sie etwas ändert.
      const lastCheck = state.load.node.tags.check_date ? `<p class="supporting-copy">${tv("previewOldDate", { date: escapeHtml(formatCalendarDate(state.load.node.tags.check_date, language)) })}</p>` : "";
      return `<div class="detail-form-root">${thumbnail}${header}${lastCheck}${allPresent}<div id="detail-form">${detailFormMarkup()}</div>${detailFooterMarkup()}</div>`;
    }
    case "development-write-recovery": {
      const copy = developmentWriteCopy[language];
      const blockedReason = state.writeStatus === "uncertain" && (isRecoveryOwnerMismatch() || !developmentSession || !developmentWriteAvailable)
        ? tv(isRecoveryOwnerMismatch() ? "recoveryWrongAccount" : !developmentSession ? "recoveryNeedSignIn" : "recoveryWritesDisabled") : "";
      // Bei einer Neuanlage steht die Position da; bei einem Prüfdatum genügt die Bezeichnung des AED.
      const targetLink = state.request.kind === "check-date" ? "" : `<p>${state.request.latitude.toFixed(5)}, ${state.request.longitude.toFixed(5)}</p>`;
      const recoveryMessage = state.request.kind === "create-node" && state.writeStatus === "complete" ? copy.created : copy[state.writeStatus];
      const action = state.writeStatus === "uncertain" && isRecoveryOwnerMismatch()
        ? ""
        : state.writeStatus === "uncertain" || state.writeStatus === "sending"
        ? `<button class="button button-primary" data-action="continue-recovery"${state.writeStatus === "sending" ? " disabled" : ""}>${state.writeStatus === "sending" ? copy.sending : developmentSession && developmentWriteAvailable ? copy.retry : tv("recoveryContinue")}</button>`
        : `<button class="button button-primary" data-action="retake">${state.writeStatus === "complete" ? tv("nextAed") : tv("recoveryContinue")}</button>`;
      const successful = state.writeStatus === "complete";
      return `<div class="result-message"><span class="status-icon ${successful ? "status-good" : "status-warn"}" aria-hidden="true">${successful ? "✓" : "!"}</span><div><h2>${tv("previewTitle")}</h2><p><strong>${escapeHtml(displayCandidateLabel(state.request.candidateLabel))}</strong></p>${targetLink}<p class="simulation-note ${successful ? "save-status-success" : ""}" role="status">${recoveryMessage}</p>${blockedReason ? `<p class="simulation-note" role="status">${blockedReason}</p>` : ""}</div></div>${action}`;
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

function defibrillatorMark(): string {
  return `<svg class="device-mark" viewBox="0 0 15 15" fill="currentColor" aria-hidden="true"><path d="${defibrillatorPath}" /></svg>`;
}

function render(restoreFlowFocus = false, preserveOpenInfoDialog = false): void {
  const infoDialogWasOpen = preserveOpenInfoDialog && (document.querySelector<HTMLDialogElement>("#info-dialog")?.open ?? false);
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
        <section class="hero ${isReady ? "" : "hero-compact"}"><div class="hero-kicker"><span></span>${t("eyebrow")}</div><h1>${isReady ? t("title") : state.kind === "photo-checking" || state.kind === "candidate-searching" ? t("checking") : t("tagline")}</h1>${isReady ? `<p>${t("intro")}</p>` : ""}</section>
        <section class="capture-card" aria-live="polite" aria-atomic="false">
          <div class="capture-content">${isReady ? `${photoSelectionError ? `<p class="photo-selection-error" role="alert" tabindex="-1">${t("cameraError")}</p>` : ""}<div class="empty-illustration" aria-hidden="true"><span class="device-card">${defibrillatorMark()}</span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>` : statusContent()}</div>
          ${isReady ? `<div class="capture-actions"><label class="button button-primary camera-label">${icon("camera")}<span>${t("camera")}</span><input id="camera-input" type="file" accept="image/*" capture="environment" /></label><label class="button button-secondary camera-label">${t("choosePhoto")}<input id="file-input" type="file" accept="image/*" /></label><p class="supporting-copy">${photoCheckAvailable ? tv("photoCheckNotice") : t("privacy")}</p></div>` : ""}
        </section>
      </main>${accountPanel()}` : `<main class="login-main">${loginEntry()}</main>`}
      <footer><span>${t("sourceNote")}</span><span class="build-mark" id="build-mark">${escapeHtml(buildVersionText())}</span></footer>
      <dialog class="info-dialog" id="info-dialog" aria-labelledby="info-title" aria-describedby="info-intro">
        <div class="info-dialog-content">
          <div class="info-dialog-header"><div><p class="eyebrow">${t("appName")}</p><h2 id="info-title">${t("aboutTitle")}</h2></div><form method="dialog"><button class="dialog-close" aria-label="${t("closeInfo")}">×</button></form></div>
          <p class="info-intro" id="info-intro">${t("aboutIntro")}</p>
          <section class="info-section"><h3>${t("infoHowTitle")}</h3><p>${t("infoHowBody")}</p><h3>${t("infoLimitsTitle")}</h3><p>${t("infoLimitsBody")}</p></section>
          <section class="info-section icon-credits"><h3>${t("iconCreditsTitle")}</h3><p>${t("iconCreditsBody")} <a href="https://github.com/mapbox/maki/blob/main/icons/defibrillator.svg" target="_blank" rel="noopener noreferrer">${t("iconCreditsSource")}</a> · <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">${t("iconCreditsLicense")}</a>.</p></section>
          ${authenticated ? `<section class="info-section account-section"><h3>${developmentSession ? t("accountDevSignedIn") : t("accountSignedIn")}</h3><p>${developmentSession ? t("accountDevNotice") : t("accountIdentityOnly")}</p><button class="account-button" id="osm-sign-out" type="button">${t("accountSignOut")}</button></section>` : ""}
          <label class="sound-toggle"><input type="checkbox" id="success-sound-toggle" ${successSound.isEnabled() ? "checked" : ""} /><span>${tv("soundToggle")}</span></label>
          <p class="build-version" id="build-version">${escapeHtml(buildVersionText())}</p>
        </div>
      </dialog>
    </div>`;

  if (infoDialogWasOpen) document.querySelector<HTMLDialogElement>("#info-dialog")?.showModal();

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

  // Detailformular: Eingaben mit dem gemerkten Formularzustand verbinden.
  if (state.kind === "new-aed-details" || (state.kind === "existing-aed-details" && state.load.status === "ready")) bindDetailForm();

  // Zweite Bestätigung bei Korrekturen: Der Speichern-Knopf wird erst aktiv, wenn „alter Wert stimmt nicht“ angehakt ist.
  const correctionConfirmation = app!.querySelector<HTMLInputElement>("#correction-confirmed");
  correctionConfirmation?.addEventListener("change", () => {
    const saveButton = app!.querySelector<HTMLButtonElement>('[data-action="save-development-check"]');
    if (saveButton) saveButton.disabled = !correctionConfirmation.checked;
  });

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
    focusCurrentState();
  });
  document.querySelector<HTMLSelectElement>("#language")?.addEventListener("change", (event) => {
    language = (event.currentTarget as HTMLSelectElement).value as Language;
    // Scheitert das Merken, gilt die Sprache trotzdem für die offene Seite.
    writeStoredValue("aedjaeger-language", language);
    render();
    // Rendering replaces the select node, so return keyboard focus to its translated replacement.
    app!.querySelector<HTMLSelectElement>("#language")?.focus();
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
    developmentWriteOwnerHash = status.developmentWriteOwnerHash;
    developmentCorrectionsAvailable = status.developmentCorrectionsAvailable;
    photoCheckAvailable = status.photoCheckAvailable;
    if (pendingDevelopmentWrite && !pendingDevelopmentWriteOwnerHash && developmentSession && developmentWriteOwnerHash) {
      // Upgrade a same-session pre-owner marker as soon as the Worker confirms the development account.
      persistPendingDevelopmentWrite(pendingDevelopmentWrite, true, developmentWriteOwnerHash);
    }
    const stillSignedInAfterLogout = afterLogout && status.authenticated;
    if (status.authenticated && !stillSignedInAfterLogout) void askForLocationOnceAfterSignIn();
    accountState = stillSignedInAfterLogout ? "logout-error" : status.authenticated ? "signed-in" : !productionLoginAvailable && !developmentLoginAvailable ? "not-configured" : failedOAuthReturn ? "login-error" : "signed-out";
  } catch {
    // Local Vite previews and an unavailable Worker must not imply that an OSM session exists.
    accountState = "connection-error";
  }
  // Rendering the whole app here enforces the gate after sign-in, expiry, and logout.
  render();
  if (pendingDevelopmentWrite && accountState === "signed-out") {
    // The restored request needs the test-server session to reconcile safely; point directly at that login.
    app!.querySelector<HTMLElement>("#osm-dev-sign-in")?.focus();
  } else if (focusSelector === "next-action") {
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
        recovery_identity: developmentWriteOwnerHash, operation_id: requestBody.operationId, confirmed: true, target: requestBody.target,
        expected_version: requestBody.expectedVersion, expected_check_date: requestBody.expectedCheckDate, observed_on: requestBody.observedOn,
        // Nur mit ergänzten Angaben; ohne sie bleibt die Anfrage (und ihr Abgleichswert) wie früher.
        ...(requestBody.details && Object.keys(requestBody.details).length > 0 ? { details: requestBody.details } : {}),
        // Nur bei Korrekturen: die alten Werte und die ausdrückliche Bestätigung der Person.
        ...(requestBody.expectedBefore && requestBody.confirmedCorrections === true ? { expected_before: requestBody.expectedBefore, confirmed_corrections: true } : {}),
      } : {
        recovery_identity: developmentWriteOwnerHash, operation_id: requestBody.operationId, confirmed: true, latitude: requestBody.latitude, longitude: requestBody.longitude,
        observed_on: requestBody.observedOn, details: requestBody.details,
        confirmed_different_candidate_ids: requestBody.confirmedDifferentCandidateIds,
      }),
    });
    const payload: unknown = await response.json();
    const matchesCurrentRequest = (state.kind === "new-aed-preview" && state.operationId === requestBody.operationId)
      || (state.kind === "osm-preview" && state.operationId === requestBody.operationId)
      || (state.kind === "development-write-recovery" && state.request.operationId === requestBody.operationId);
    if (!matchesCurrentRequest) return;
    if (response.ok && isDevelopmentWriteResponse(payload, "complete")) {
      // "already_current": Das Datum stand schon so auf dem Knoten. Der Server hat bewusst nichts geschrieben (kein neuer
      // Änderungssatz). Das ist ein Erfolg im Sinne von "der Stand stimmt", aber kein Speichern. Darum eine eigene
      // Meldung ("Schon aktuell. Es wurde nichts geändert.") und kein Ton: Ein Ton für nichts wäre eine Belohnung ohne Leistung.
      const unchanged = isCheckDate && payload.already_current === true;
      setDevelopmentWriteStatus(requestBody.operationId, unchanged ? "unchanged" : "complete");
      clearPendingDevelopmentCheck(requestBody.operationId);
      // Nur bei einem vom Server bestätigten, echten Schreibvorgang erklingt der Ton. Er ändert nichts am Ablauf.
      if (!unchanged) successSound.play();
    } else if (response.status === 409) {
      setDevelopmentWriteStatus(requestBody.operationId, "conflict");
      clearPendingDevelopmentCheck(requestBody.operationId);
    } else if (response.status === 404 && isRecord(payload) && payload.error === "target_not_found") {
      // Eindeutig: Den Knoten gibt es auf dem Testserver nicht (zum Beispiel ein AED aus dem Archiv des echten OSM).
      // Nichts wurde geschrieben; ein erneutes Prüfen würde dasselbe ergeben. Darum kein "unklar" und kein Prüfen-Knopf.
      setDevelopmentWriteStatus(requestBody.operationId, "notFound");
      clearPendingDevelopmentCheck(requestBody.operationId);
    } else if (isRecord(payload) && payload.error === "write_failed") {
      // Der Server hat den Vorgang endgültig als gescheitert festgehalten. Wiederholen liefert dieselbe Antwort,
      // darum "fehlgeschlagen" (neuer Versuch von vorn) statt "unklar".
      setDevelopmentWriteStatus(requestBody.operationId, "failed");
      clearPendingDevelopmentCheck(requestBody.operationId);
    } else if (response.status === 202 || response.status >= 500 || !response.ok && !isRecord(payload)) {
      setDevelopmentWriteStatus(requestBody.operationId, "uncertain");
    } else {
      setDevelopmentWriteStatus(requestBody.operationId, "failed");
      clearPendingDevelopmentCheck(requestBody.operationId);
    }
  } catch {
    setDevelopmentWriteStatus(requestBody.operationId, "uncertain");
  }
  if ((state.kind === "new-aed-preview" && state.operationId === requestBody.operationId)
    || (state.kind === "osm-preview" && state.operationId === requestBody.operationId)
    || (state.kind === "development-write-recovery" && state.request.operationId === requestBody.operationId)) render(true, true);
}

function setDevelopmentWriteStatus(operationId: string, writeStatus: "uncertain" | "sending" | "complete" | "unchanged" | "notFound" | "conflict" | "failed"): void {
  if (state.kind === "new-aed-preview" && state.operationId === operationId) {
    // Eine Neuanlage kennt kein "schon aktuell"; der Server meldet es dort nie. Sicherheitshalber gilt es als erstellt.
    state = { ...state, writeStatus: writeStatus === "unchanged" ? "complete" : writeStatus === "notFound" ? "failed" : writeStatus };
  } else if (state.kind === "osm-preview" && state.operationId === operationId) {
    state = { ...state, writeStatus };
  } else if (state.kind === "development-write-recovery" && state.request.operationId === operationId) {
    state = { ...state, writeStatus };
  }
}

function isDevelopmentWriteResponse(value: unknown, expectedStatus: string): value is { status: string; version: number; already_current?: unknown } {
  return isRecord(value) && value.status === expectedStatus && Number.isSafeInteger(value.version) && (value.version as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecoveryOwnerMismatch(): boolean {
  return Boolean(pendingDevelopmentWriteOwnerHash && developmentWriteOwnerHash
    && pendingDevelopmentWriteOwnerHash !== developmentWriteOwnerHash);
}

function focusCurrentState(): void {
  if (accountState !== "signed-in") {
    const loginControl = app!.querySelector<HTMLElement>("#osm-dev-sign-in, #osm-session-retry, #osm-sign-in, #login-title");
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
    if (selectionVersion === photoSelectionVersion) {
      photoSelectionPending = false;
      showPhotoSelectionError();
    }
    return;
  }
  if (selectionVersion !== photoSelectionVersion) {
    URL.revokeObjectURL(photoUrl);
    return;
  }

  photoSelectionPending = false;
  photoSelectionError = false;
  clearTimers();
  releasePhoto();
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
  state = { kind: "photo", photoUrl };
  render(true);
}

function showPhotoSelectionError(): void {
  photoSelectionError = true;
  render();
  app?.querySelector<HTMLElement>(".photo-selection-error")?.focus();
}

async function handleAction(action: string | undefined, source?: HTMLElement): Promise<void> {
  if (action === "continue-recovery" && pendingDevelopmentWrite && accountState !== "signed-in") {
    // A pending write can only be reconciled under the same test-server session that created it.
    // Continue starts that OAuth flow directly, even if session status has not finished loading yet.
    window.location.assign("/api/auth/osm/development/start");
    return;
  }
  if (action === "retake") {
    if (hasUnresolvedSave(state)) return;
    clearTimers();
    releasePhoto();
    state = pendingDevelopmentWrite
      ? { kind: "development-write-recovery", request: pendingDevelopmentWrite, writeStatus: "uncertain" }
      : { kind: "ready" };
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
    void runNearbySearch(state.photoUrl, { ...position, accuracyMeters: MAP_PIN_ACCURACY_METERS });
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
    // Ohne Name und Ortsangabe bleibt die Bezeichnung leer. Beim Anzeigen steht dann "AED (ohne Namen)" da (siehe
    // displayCandidateLabel), in der gerade gewählten Sprache und nie die technische Kennung (node/123…).
    const candidateLabel = candidate.tags.name || candidate.tags["defibrillator:location"] || "";
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
    if (positionConfirmed) {
      // Ein eventuell übrig gebliebener Stand eines bestehenden AED darf das Neuanlage-Formular nie sperren.
      detailExistingTags = undefined;
      // Erste Bestätigung (Position) ist da: weiter zu den freiwilligen Angaben. Die Vorschau folgt erst danach.
      const confirmedPosition = newAedPositionOverride ?? state.location;
      state = { kind: "new-aed-details", photoUrl: state.photoUrl, returnState: state, position: { latitude: confirmedPosition.latitude, longitude: confirmedPosition.longitude } };
    } else {
      // Position nicht bestätigt: Die gesperrte Vorschau erklärt, was fehlt. Das Formular erscheint noch nicht.
      const result = computeNewAedPreview(state, false);
      state = { kind: "new-aed-preview", photoUrl: state.photoUrl, result, returnState: state };
    }
  } else if (action === "details-continue" && state.kind === "new-aed-details") {
    // Die Angaben laufen durch denselben Vertrag wie später beim Server. Ist etwas ungültig, bleibt die Person
    // im Formular (der Knopf ist dann ohnehin gesperrt; das hier ist die zweite Sicherung gegen erzwungene Klicks).
    const built = buildDetailTags(detailForm);
    if (!built.ok) {
      updateDetailFooter();
      return;
    }
    const result = computeNewAedPreview(state.returnState, true, built.tags);
    state = { kind: "new-aed-preview", photoUrl: state.photoUrl, result, returnState: state.returnState, detailsPosition: state.position };
  } else if (action === "back-from-details" && state.kind === "new-aed-details") {
    // Zurück zur Positionsbestätigung. Die Angaben bleiben im Speicher, falls die Person gleich wieder weitergeht.
    state = state.returnState;
  } else if (action === "back-to-details" && state.kind === "new-aed-preview" && state.detailsPosition) {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return;
    state = { kind: "new-aed-details", photoUrl: state.photoUrl, returnState: state.returnState, position: state.detailsPosition };
  } else if (action === "back-to-search" && state.kind === "new-aed-preview") {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return;
    state = state.returnState;
  } else if (action === "create-development-node" && state.kind === "new-aed-preview") {
    successSound.prepare(); // Beim Tippen: Ton freischalten, er erklingt erst bei bestätigtem Erfolg.
    if (!developmentSession || !developmentWriteAvailable || !developmentWriteOwnerHash || !crypto.randomUUID || state.result.kind !== "ready" || state.writeStatus) return;
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
      observedOn: preview.result.tags.check_date,
      // Nur die Detailtags gehen als `details` an den Server. `emergency` und `check_date` setzt der Server selbst.
      details: Object.fromEntries(Object.entries(preview.result.tags).filter(([key]) => isDetailKey(key))) as DetailTags,
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
  } else if (action === "open-existing-details" && state.kind === "osm-preview" && !state.node) {
    // Zweiter Weg neben „noch vorhanden“: fehlende Angaben ergänzen. Erst wird der AED frisch aus OSM gelesen.
    const candidateId = state.candidateId;
    const candidate = state.returnState.search.candidates.find((item) => item.id === candidateId);
    if (!developmentSession || !developmentWriteAvailable || !developmentWriteOwnerHash || candidate?.osmType !== "node") return;
    resetDetailForm();
    state = { kind: "existing-aed-details", photoUrl: state.photoUrl, candidateId, candidateLabel: state.candidateLabel, returnState: state.returnState, load: { status: "loading" } };
    void loadExistingAedNode(candidateId);
  } else if (action === "open-candidate-details" && state.kind === "candidate-result") {
    // Direkt aus der Trefferliste zu den Tags (vor der Datumsseite). Gleiche Voraussetzungen wie beim Ergänzen: Testserver-Sitzung,
    // Schreiben an, ein Knoten, der nicht nur im Archiv des echten OSM steht.
    const candidateId = source?.dataset.candidateId;
    const candidate = state.search.candidates.find((item) => item.id === candidateId);
    if (!candidate || !candidateId || !developmentSession || !developmentWriteAvailable || !developmentWriteOwnerHash || candidate.osmType !== "node" || candidate.source === "archive") return;
    resetDetailForm();
    const candidateLabel = candidate.tags.name || candidate.tags["defibrillator:location"] || "";
    state = { kind: "existing-aed-details", photoUrl: state.photoUrl, candidateId, candidateLabel, returnState: state, load: { status: "loading" }, fromList: true };
    void loadExistingAedNode(candidateId);
  } else if (action === "existing-details-retry" && state.kind === "existing-aed-details" && state.load.status === "error") {
    const candidateId = state.candidateId;
    state = { ...state, load: { status: "loading" } };
    void loadExistingAedNode(candidateId);
  } else if (action === "existing-details-continue" && state.kind === "existing-aed-details" && state.load.status === "ready") {
    // Die Eingaben laufen durch denselben Vertrag wie später beim Server. Bestehende Werte bleiben (gesperrt), nur Fehlendes geht mit.
    const built = currentDetailPlan();
    if (!built.ok) {
      updateDetailFooter();
      return;
    }
    const node = state.load.node;
    // Das Prüfdatum wird gegen den FRISCH gelesenen Stand vorbereitet, nicht gegen den alten Treffer aus dem Archiv.
    const result = previewExistingAedCheck({ id: state.candidateId, osmType: "node", tags: node.tags }, true, observedOn);
    state = {
      kind: "osm-preview", photoUrl: state.photoUrl, candidateId: state.candidateId, candidateLabel: state.candidateLabel,
      result, returnState: state.returnState, node,
      ...(state.fromList ? { fromList: true as const } : {}),
      ...(Object.keys(built.tags).length > 0 ? { details: built.tags } : {}),
      ...(built.corrections.length > 0 ? { corrections: built.corrections } : {}),
    };
  } else if (action === "back-from-existing-details" && state.kind === "existing-aed-details") {
    // Zurück zur einfachen Bestätigung. Die Eingaben werden verworfen, denn der Stand in OSM kann sich inzwischen ändern.
    const { candidateId, candidateLabel, returnState, photoUrl } = state;
    const candidate = returnState.search.candidates.find((item) => item.id === candidateId);
    const cameFromList = state.fromList === true;
    resetDetailForm();
    if (!candidate || cameFromList) {
      // Aus der Trefferliste gekommen: zurück zur Liste (die Datumsseite war nie dran).
      state = returnState;
    } else {
      state = { kind: "osm-preview", photoUrl, candidateId, candidateLabel, result: previewExistingAedCheck(candidate, true, observedOn), returnState };
    }
  } else if (action === "back-to-existing-details" && state.kind === "osm-preview" && state.node) {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return;
    // Der gelesene Stand und die Eingaben bleiben erhalten (detailForm liegt im Speicher).
    detailExistingTags = state.node.tags;
    state = {
      kind: "existing-aed-details", photoUrl: state.photoUrl, candidateId: state.candidateId, candidateLabel: state.candidateLabel,
      returnState: state.returnState, load: { status: "ready", node: state.node }, ...(state.fromList ? { fromList: true as const } : {}),
    };
  } else if (action === "back-to-candidates" && state.kind === "osm-preview") {
    if (state.writeStatus === "sending" || state.writeStatus === "uncertain") return;
    state = state.returnState;
  } else if (action === "save-development-check" && state.kind === "osm-preview") {
    successSound.prepare(); // Beim Tippen: Ton freischalten, er erklingt erst bei bestätigtem Erfolg.
    if (!developmentSession || !developmentWriteAvailable || !developmentWriteOwnerHash || !crypto.randomUUID || state.writeStatus === "sending" || state.writeStatus === "complete" || state.writeStatus === "unchanged") return;
    const preview = state;
    const candidateId = preview.candidateId;
    const candidate = preview.returnState.search.candidates.find((item) => item.id === candidateId);
    if (!candidate || candidate.osmType !== "node" || candidate.source === "archive" || preview.result.kind !== "ready") return;
    // Korrekturen brauchen die zweite, ausdrückliche Bestätigung. Ohne Haken wird nichts gesendet, auch wenn der Knopf
    // (zum Beispiel per Tastatur oder Skript) trotzdem ausgelöst wurde.
    const corrections = preview.corrections ?? [];
    if (corrections.length > 0 && app!.querySelector<HTMLInputElement>("#correction-confirmed")?.checked !== true) return;
    const operationId = preview.operationId ?? crypto.randomUUID();
    const change = preview.result.changes[0];
    const request: DevelopmentWriteRequest = {
      kind: "check-date", operationId,
      target: candidate.id,
      candidateLabel: preview.candidateLabel,
      // Kommt die Vorschau aus dem Ergänzen-Formular, zählt die Version, die die Person frisch gesehen hat.
      ...(preview.node ? { expectedVersion: preview.node.version } : candidate.version === undefined ? {} : { expectedVersion: candidate.version }),
      expectedCheckDate: change.before,
      observedOn: change.after,
      ...(preview.details && Object.keys(preview.details).length > 0 ? { details: preview.details } : {}),
      // Korrekturen: die alten Werte, genau wie die Person sie gesehen hat. Der Server schreibt nur, wenn sie noch so dastehen.
      ...(corrections.length > 0 ? { expectedBefore: Object.fromEntries(corrections.map((correction) => [correction.key, correction.before])), confirmedCorrections: true as const } : {}),
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
  } else if ((action === "continue-recovery" || action === "retry-development-write")
    && (state.kind === "development-write-recovery" || state.kind === "new-aed-preview" || state.kind === "osm-preview")) {
    if (state.writeStatus !== "uncertain") return;
    if (isRecoveryOwnerMismatch()) return;
    if (!developmentSession) {
      if (accountState === "signed-in") {
        // The pending request belongs to the test-server session; a production login cannot reconcile it.
        openAccountFromLamp();
      } else {
        const target = app!.querySelector<HTMLElement>("#osm-dev-sign-in, #osm-session-retry, #login-title");
        // Defer until the click's default focus handling has finished.
        window.requestAnimationFrame(() => target?.focus());
      }
      return;
    }
    if (!developmentWriteAvailable || !developmentWriteOwnerHash) {
      // Recheck the server switch so the same button works after an operator enables writes.
      await refreshAccountState();
      return;
    }
    successSound.prepare();
    const request = state.kind === "development-write-recovery" ? state.request : readPendingDevelopmentWrite(state.operationId);
    if (!request) return;
    state = { ...state, writeStatus: "sending" };
    render(true);
    void submitDevelopmentWrite(request);
  }
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
    const location = providedLocation ?? await getPhoneLocation();
    activeSearchLocation = location;
    const search = await requestNearbyCandidates(location);
    const { assessment } = assessCandidateSearch(location, search, { nearbyRadiusMeters: NEARBY_RADIUS_METERS, maximumAccuracyMeters: MAX_LOCATION_ACCURACY_METERS });
    // Keep coordinates only in the active in-memory photo flow so a later preview can stay tied to
    // the exact search location. They are discarded when the photo is replaced and never persisted.
    const retryAvailableAt = search.status === "partial"
      ? Date.now() + (search.retryAfterSeconds ?? 30) * 1_000
      : undefined;
    state = { kind: "candidate-result", photoUrl, search, assessment, location, ...(retryAvailableAt === undefined ? {} : { retryAvailableAt }) };
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
 * Lädt den aktuellen Stand des gewählten AED frisch aus OSM und zeigt dann das Ergänzen-Formular.
 *
 * Die Antwort zählt nur, wenn die Person noch bei genau diesem AED im Ladezustand ist. Ist sie inzwischen
 * zurückgegangen, weitergegangen oder hat das Foto verworfen, wird das späte Ergebnis ignoriert.
 */
async function loadExistingAedNode(candidateId: string): Promise<void> {
  try {
    const node = await requestExistingNode(candidateId);
    if (state.kind !== "existing-aed-details" || state.candidateId !== candidateId || state.load.status !== "loading") return;
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
    if (state.kind !== "existing-aed-details" || state.candidateId !== candidateId || state.load.status !== "loading") return;
    detailExistingTags = undefined;
    state = { ...state, load: { status: "error", code: error instanceof ExistingNodeError ? error.code : "service_unavailable" } };
  }
  render(true);
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
  resetDetailForm();
  photoSelectionError = false;
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
