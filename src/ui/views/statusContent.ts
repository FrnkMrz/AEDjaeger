import { levelLeftBehindByIndoorChange } from "../../contracts/aedDetails";
import { formatCalendarDate } from "../../domain/localDate";
import type { FlowState } from "../../domain/workflow";
import type { FlowMessageKey } from "../../i18n/flowTranslations";
import type { Language, TranslationKey } from "../../i18n/translations";
import type { Coordinate } from "../../map/positionPicker";
import type { SearchLocationSource } from "../../state/photoSession";
import { defibrillatorMark, displayCandidateLabel } from "../markup";
import { renderCandidateResult } from "./candidateResult";
import { renderPhotoState } from "./photoStates";

type Translate = (key: TranslationKey, values?: Record<string, number | string>) => string;
type TranslateFlow = (key: FlowMessageKey, values?: Record<string, number | string>) => string;
type DevelopmentWriteStatus = Extract<FlowState, { kind: "development-write-recovery" }>["writeStatus"];

export type StatusContentContext = {
  state: FlowState;
  t: Translate;
  tv: TranslateFlow;
  escapeHtml: (value: string) => string;
  photoMarkup: string;
  photoCheckAvailable: boolean;
  selectedPhotoFileAvailable: boolean;
  mapLocationOverride?: Coordinate;
  minimumMapSearchZoom: number;
  defibrillatorPath: string;
  developmentSession: boolean;
  developmentWriteAvailable: boolean;
  developmentWriteOwnerHash?: string;
  developmentCorrectionsAvailable: boolean;
  newAedPositionOverride?: Coordinate;
  searchLocationSource?: SearchLocationSource;
  language: Language;
  developmentWriteStatusKeys: Record<DevelopmentWriteStatus, FlowMessageKey>;
  newEntryPanelOpen: (state: FlowState) => boolean;
  isRecoveryOwnerMismatch: () => boolean;
  detailEverythingPresent: () => boolean;
  detailFormMarkup: () => string;
  detailFooterMarkup: () => string;
};

/** Render a workflow state from explicit view data; mutations and browser access stay in main.ts. */
export function renderStatusContent(context: StatusContentContext): string {
  const {
    state,
    t,
    tv,
    escapeHtml,
    photoCheckAvailable,
    selectedPhotoFileAvailable,
    mapLocationOverride,
    minimumMapSearchZoom,
    defibrillatorPath,
    developmentSession,
    developmentWriteAvailable,
    developmentWriteOwnerHash,
    developmentCorrectionsAvailable,
    searchLocationSource,
    language,
    developmentWriteStatusKeys,
    isRecoveryOwnerMismatch,
    detailEverythingPresent,
    detailFormMarkup,
    detailFooterMarkup,
  } = context;
  const photoMarkup = context.photoMarkup;
  const photoSession = { searchLocationSource };

  if (
    state.kind === "photo" ||
    state.kind === "photo-checking" ||
    state.kind === "photo-rejected" ||
    state.kind === "photo-date" ||
    state.kind === "location-choice" ||
    state.kind === "location-map" ||
    state.kind === "candidate-searching"
  )
    return renderPhotoState(state, {
      t,
      tv,
      escapeHtml,
      photoMarkup,
      photoCheckAvailable,
      selectedPhotoFileAvailable,
      mapLocationOverride,
      minimumMapSearchZoom,
    });

  switch (state.kind) {
    case "ready":
      return `<div class="empty-illustration" aria-hidden="true"><span class="device-card">${defibrillatorMark(defibrillatorPath)}</span><span class="scan-corner corner-a"></span><span class="scan-corner corner-b"></span><span class="scan-corner corner-c"></span><span class="scan-corner corner-d"></span></div>`;
    case "candidate-result":
      return renderCandidateResult({ ...context, state });
    case "new-aed-details": {
      // Kleines Foto oben, damit das Formular Platz hat. Die eigentliche Arbeit passiert in #detail-form (siehe bindDetailForm).
      const thumbnail = photoMarkup.replace('class="photo-preview"', 'class="photo-preview photo-thumb"');
      return `<div class="detail-form-root">${thumbnail}<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><h2>${tv("detailsTitle")}</h2><p>${tv("detailsIntro")}</p></div></div><div id="detail-form">${detailFormMarkup()}</div>${detailFooterMarkup()}</div>`;
    }
    case "new-aed-preview": {
      const point = state.result.kind === "ready" ? state.result.position : state.returnState.location;
      const latitude = point.latitude.toFixed(5);
      const longitude = point.longitude.toFixed(5);
      const content =
        state.result.kind === "ready"
          ? `<p>${tv("newPreviewCoordinates", { latitude, longitude })}</p><strong>${tv("newPreviewTags")}</strong><ul>${Object.entries(
              state.result.tags,
            )
              .map(([key, value]) => `<li><code>${escapeHtml(key)}=${escapeHtml(value)}</code></li>`)
              .join(
                "",
              )}</ul><p>${state.result.confirmedDifferentCandidateIds.length > 0 ? tv("newPreviewReviewedCandidates") : tv("newPreviewCaution")}</p>`
          : `<p>${tv(state.result.reason === "position-not-confirmed" ? "newPositionRequired" : state.result.reason === "search-found-candidate" ? "newPreviewFoundCandidate" : "newPreviewSearchInvalid")}</p>`;
      const canCreate =
        developmentSession &&
        developmentWriteAvailable &&
        Boolean(developmentWriteOwnerHash) &&
        state.result.kind === "ready";
      const statusCopy =
        state.writeStatus === "complete"
          ? tv("developmentCreated")
          : state.writeStatus
            ? tv(developmentWriteStatusKeys[state.writeStatus])
            : "";
      const blockedRecovery =
        state.writeStatus === "uncertain" &&
        (isRecoveryOwnerMismatch() || !developmentSession || !developmentWriteAvailable)
          ? `<p class="simulation-note" role="status">${tv(isRecoveryOwnerMismatch() ? "recoveryWrongAccount" : !developmentSession ? "recoveryNeedSignIn" : "recoveryWritesDisabled")}</p>`
          : "";
      const writeStatus = state.writeStatus
        ? `<p role="status" class="simulation-note ${state.writeStatus === "complete" ? "save-status-success" : ""}">${statusCopy}</p>${blockedRecovery}`
        : "";
      // Zweite von zwei Bestätigungen für eine Neuanlage: Ohne diesen Haken bleibt der
      // Speichern-Knopf gesperrt. Der Klick-Handler prüft den Haken zusätzlich noch einmal.
      const writeAction =
        canCreate && !state.writeStatus
          ? `<div class="position-confirmation"><label for="new-aed-absence-confirmed"><input id="new-aed-absence-confirmed" type="checkbox" /><span>${tv("newAbsenceConfirm")}</span></label></div><button class="button button-primary" data-action="create-development-node" disabled>${tv("developmentCreateAction")}</button>`
          : state.writeStatus === "uncertain" && state.operationId && !isRecoveryOwnerMismatch()
            ? `<button class="button button-secondary" data-action="retry-development-write">${developmentSession && developmentWriteAvailable ? tv("developmentRetry") : tv("recoveryContinue")}</button>`
            : "";
      // Der Hinweis „nur eine Vorschau“ steht nur, wenn es nichts zu speichern gibt. Mit Speichern-Knopf sagt dessen
      // Beschriftung („Testserver: AED eintragen“) schon, wohin die Änderung geht.
      // Der Hinweis „nur eine Vorschau“ gilt nur, wenn gar nichts gespeichert werden kann und kein Vorgang läuft. Nach einem
      // Speichern (oder währenddessen) wäre er falsch; dann sagt die Statusmeldung, was passiert ist.
      const noWriteNotice =
        !canCreate && !state.writeStatus ? `<p class="simulation-note">${tv("previewNoWrite")}</p>` : "";
      // „Zurück“ bleibt hier immer: Es führt zur Positionsbestätigung bzw. zur Suche, nicht nur zu Treffern.
      // Kommt die Vorschau aus dem Detailformular, führt „Zurück“ dorthin (die Eingaben bleiben erhalten). Sonst zur Suche.
      const backButton = state.detailsPosition
        ? `<button class="button button-quiet" data-action="back-to-details">${tv("detailsBackToForm")}</button>`
        : `<button class="button button-quiet" data-action="back-to-search">${tv("previewBack")}</button>`;
      const navigation =
        state.writeStatus === "sending" || state.writeStatus === "uncertain"
          ? ""
          : state.writeStatus === "complete"
            ? `<button class="button button-primary" data-action="retake">${tv("nextAed")}</button>`
            : `${backButton}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
      const successful = state.writeStatus === "complete";
      return `${photoMarkup}<div class="result-message"><span class="status-icon ${successful ? "status-good" : "status-warn"}" aria-hidden="true">${successful ? "✓" : "!"}</span><div><h2>${tv("newPreviewTitle")}</h2>${content}${noWriteNotice}${writeStatus}</div></div>${writeAction}${navigation}`;
    }
    case "osm-preview": {
      const { result } = state;
      const candidateId = state.candidateId;
      const candidate = state.returnState.search.candidates.find((item) => item.id === candidateId);
      // Ein AED aus dem Archiv des echten OSM gibt es auf dem Testserver nicht. Dafür gibt es dort keinen Speichern-Knopf.
      const archiveOnly = developmentSession && developmentWriteAvailable && candidate?.source === "archive";
      const canWrite =
        developmentSession &&
        developmentWriteAvailable &&
        Boolean(developmentWriteOwnerHash) &&
        candidate?.osmType === "node" &&
        result.kind === "ready" &&
        !archiveOnly;
      // Nur das Wesentliche: das neue Prüfdatum. Der bisherige Wert steht nur da, wenn es einen gibt.
      const content =
        result.kind === "ready"
          ? `<p><strong>${tv("previewNewDate", { date: formatCalendarDate(result.changes[0].after, language) })}</strong></p>${result.changes[0].before ? `<p>${tv("previewOldDate", { date: escapeHtml(formatCalendarDate(result.changes[0].before, language)) })}</p>` : ""}`
          : result.reason === "newer-check-date-exists" && result.existingDate
            ? `<p>${tv("previewNewerDate", { date: escapeHtml(formatCalendarDate(result.existingDate, language)) })}</p>`
            : `<p>${tv("previewUnsupported")}</p>`;
      // Kommt die Vorschau aus dem Ergänzen-Formular, stehen hier die neuen Tags. Sie werden vor dem Speichern genau gezeigt.
      const corrections = state.corrections ?? [];
      const correctedKeys = new Set<string>(corrections.map((correction) => correction.key));
      const addedTags = state.details ? Object.entries(state.details).filter(([key]) => !correctedKeys.has(key)) : [];
      const addedList =
        addedTags.length > 0
          ? `<p><strong>${tv("detailsAddedTitle")}</strong></p><ul>${addedTags.map(([key, value]) => `<li><code>${escapeHtml(key)}=${escapeHtml(value)}</code></li>`).join("")}</ul>`
          : "";
      // Korrekturen als „alt → neu“: Der alte Wert steht durchgestrichen davor. Alle Werte stammen aus OSM oder der Eingabe und werden maskiert.
      const changedList =
        corrections.length > 0
          ? `<p><strong>${tv("detailsChangedTitle")}</strong></p><ul>${corrections.map((correction) => `<li><code>${escapeHtml(correction.key)}=<span class="detail-old">${escapeHtml(correction.before)}</span> → ${escapeHtml(correction.after)}</code></li>`).join("")}</ul>`
          : "";
      // Bleibt nach „draußen“ eine alte Ebene stehen, sagt die Vorschau es offen (AEDjaeger löscht nie etwas).
      const levelLeft =
        state.details && state.node ? levelLeftBehindByIndoorChange(state.node.tags, state.details) : null;
      const levelLeftNote =
        levelLeft === null
          ? ""
          : `<p class="detail-hint">${escapeHtml(tv("detailLevelStays", { level: levelLeft }))}</p>`;
      const completeText =
        corrections.length > 0
          ? tv("developmentChangesComplete")
          : addedTags.length > 0
            ? tv("developmentDetailsComplete")
            : tv("developmentComplete");
      const statusText =
        state.writeStatus === "complete"
          ? completeText
          : state.writeStatus
            ? tv(developmentWriteStatusKeys[state.writeStatus])
            : "";
      const blockedRecovery =
        state.writeStatus === "uncertain" &&
        (isRecoveryOwnerMismatch() || !developmentSession || !developmentWriteAvailable)
          ? `<p class="simulation-note" role="status">${tv(isRecoveryOwnerMismatch() ? "recoveryWrongAccount" : !developmentSession ? "recoveryNeedSignIn" : "recoveryWritesDisabled")}</p>`
          : "";
      const writeStatus = state.writeStatus
        ? `<p role="status" class="simulation-note ${state.writeStatus === "complete" ? "save-status-success" : ""}">${statusText}</p>${blockedRecovery}`
        : "";
      // Der zweite Weg neben dem Ein-Tipp-Speichern: fehlende Angaben ergänzen. Nur beim einfachen Prüfdatum-Vorschlag.
      const addDetailsButton =
        canWrite && !state.writeStatus && !state.node
          ? `<button class="button button-secondary" data-action="open-existing-details">${tv(developmentCorrectionsAvailable ? "detailsCorrectAction" : "detailsAddAction")}</button>`
          : "";
      // Zweite Bestätigung bei Korrekturen: Ohne den Haken „alter Wert stimmt nicht“ bleibt der Speichern-Knopf gesperrt.
      // Der Klick-Handler prüft den Haken zusätzlich noch einmal.
      const correctionConfirmation =
        canWrite && !state.writeStatus && corrections.length > 0
          ? `<div class="position-confirmation"><label for="correction-confirmed"><input id="correction-confirmed" type="checkbox" /><span>${tv("detailsCorrectionConfirm")}</span></label></div>`
          : "";
      const saveLabel =
        corrections.length > 0
          ? tv("developmentChangesAction")
          : addedTags.length > 0
            ? tv("developmentDetailsAction")
            : tv("developmentWriteAction");
      const writeAction =
        canWrite && !state.writeStatus
          ? `${correctionConfirmation}<button class="button button-primary" data-action="save-development-check"${corrections.length > 0 ? " disabled" : ""}>${saveLabel}</button>`
          : state.writeStatus === "uncertain" && state.operationId && !isRecoveryOwnerMismatch()
            ? `<button class="button button-secondary" data-action="retry-development-write">${developmentSession && developmentWriteAvailable ? tv("developmentRetry") : tv("recoveryContinue")}</button>`
            : "";
      // Nur wenn nichts gespeichert werden kann und kein Vorgang läuft; sonst wäre „nur eine Vorschau“ nach einem Speichern falsch.
      // Bei einem neueren Datum in OSM sagt die Meldung selbst, dass nichts geändert wird; „nur eine Vorschau“ wäre doppelt.
      const newerDateInOsm = result.kind === "blocked" && result.reason === "newer-check-date-exists";
      const noWriteNotice =
        !canWrite && !state.writeStatus && !newerDateInOsm
          ? `<p class="simulation-note">${archiveOnly ? tv("previewArchiveNotice") : tv("previewNoWrite")}</p>`
          : "";
      const recoverableWrite = state.writeStatus === "sending" || state.writeStatus === "uncertain";
      // „Zurück“ gibt es nur, wenn es mehrere Treffer zur Auswahl gab. Bei einem einzigen Treffer hätte es keine Bedeutung.
      // Gezählt wird wie in der Trefferliste: Bei „candidate-review“ die bewerteten Treffer, sonst alle Suchtreffer.
      const shownCandidates =
        state.returnState.assessment.kind === "candidate-review"
          ? state.returnState.assessment.candidates.length
          : state.returnState.search.candidates.length;
      const hasOtherCandidates = shownCandidates > 1;
      // Aus dem Ergänzen-Formular führt „Zurück“ dorthin (die Eingaben bleiben), sonst zur Trefferliste.
      const backButton = state.node
        ? `<button class="button button-quiet" data-action="back-to-existing-details">${tv("detailsBackToForm")}</button>`
        : hasOtherCandidates
          ? `<button class="button button-quiet" data-action="back-to-candidates">${tv("previewBack")}</button>`
          : "";
      const navigation = recoverableWrite
        ? ""
        : state.writeStatus === "complete"
          ? `<button class="button button-primary" data-action="retake">${tv("nextAed")}</button>`
          : `${backButton}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
      const successful = state.writeStatus === "complete";
      return `${photoMarkup}<div class="result-message"><span class="status-icon ${successful ? "status-good" : "status-warn"}" aria-hidden="true">${successful ? "✓" : "!"}</span><div><h2>${tv("previewTitle")}</h2><p><strong>${escapeHtml(displayCandidateLabel(state.candidateLabel, tv("unnamedAed")))}</strong></p>${content}${changedList}${addedList}${levelLeftNote}${noWriteNotice}${writeStatus}</div></div>${writeAction}${addDetailsButton}${navigation}`;
    }
    case "existing-aed-details": {
      const label = escapeHtml(displayCandidateLabel(state.candidateLabel, tv("unnamedAed")));
      const header = `<div class="result-message"><span class="status-icon status-good" aria-hidden="true">✓</span><div><h2>${tv(developmentCorrectionsAvailable ? "detailsCorrectTitle" : "detailsExistingTitle")}</h2><p><strong>${label}</strong></p><p>${tv(developmentCorrectionsAvailable ? "detailsCorrectIntro" : "detailsExistingIntro")}</p></div></div>`;
      if (state.load.status === "loading") {
        return `${photoMarkup}${header}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${tv("detailLoading")}</span></div>`;
      }
      if (state.load.status === "error") {
        const message =
          state.load.code === "node_unavailable"
            ? tv("detailLoadChanged")
            : state.load.code === "authentication_required"
              ? tv("errorSignIn")
              : tv("detailLoadFailed");
        // Ist der Eintrag weg, hilft Wiederholen nicht; dann bleibt nur der Rückweg.
        const retry =
          state.load.code === "node_unavailable"
            ? ""
            : `<button class="button button-secondary" data-action="existing-details-retry">${tv("detailLoadRetry")}</button>`;
        return `${photoMarkup}${header}<p class="simulation-note" role="alert">${message}</p>${retry}<button class="button button-quiet" data-action="back-from-existing-details">${tv("previewBack")}</button>`;
      }
      const thumbnail = photoMarkup.replace('class="photo-preview"', 'class="photo-preview photo-thumb"');
      const allPresent = detailEverythingPresent() ? `<p class="simulation-note">${tv("detailsAllPresent")}</p>` : "";
      // Das bisherige Prüfdatum aus OSM, damit die Person sieht, wie aktuell der Eintrag ist, bevor sie etwas ändert.
      const lastCheck = state.load.node.tags.check_date
        ? `<p class="supporting-copy">${tv("previewOldDate", { date: escapeHtml(formatCalendarDate(state.load.node.tags.check_date, language)) })}</p>`
        : "";
      return `<div class="detail-form-root">${thumbnail}${header}${lastCheck}${allPresent}<div id="detail-form">${detailFormMarkup()}</div>${detailFooterMarkup()}</div>`;
    }
    case "development-write-recovery": {
      const blockedReason =
        state.writeStatus === "uncertain" &&
        (isRecoveryOwnerMismatch() || !developmentSession || !developmentWriteAvailable)
          ? tv(
              isRecoveryOwnerMismatch()
                ? "recoveryWrongAccount"
                : !developmentSession
                  ? "recoveryNeedSignIn"
                  : "recoveryWritesDisabled",
            )
          : "";
      // Bei einer Neuanlage steht die Position da; bei einem Prüfdatum genügt die Bezeichnung des AED.
      const targetLink =
        state.request.kind === "check-date"
          ? ""
          : `<p>${state.request.latitude.toFixed(5)}, ${state.request.longitude.toFixed(5)}</p>`;
      const recoveryMessage =
        state.request.kind === "create-node" && state.writeStatus === "complete"
          ? tv("developmentCreated")
          : tv(developmentWriteStatusKeys[state.writeStatus]);
      const action =
        state.writeStatus === "uncertain" && isRecoveryOwnerMismatch()
          ? ""
          : state.writeStatus === "uncertain" || state.writeStatus === "sending"
            ? `<button class="button button-primary" data-action="continue-recovery"${state.writeStatus === "sending" ? " disabled" : ""}>${state.writeStatus === "sending" ? tv("developmentSending") : developmentSession && developmentWriteAvailable ? tv("developmentRetry") : tv("recoveryContinue")}</button>`
            : `<button class="button button-primary" data-action="retake">${state.writeStatus === "complete" ? tv("nextAed") : tv("recoveryContinue")}</button>`;
      const successful = state.writeStatus === "complete";
      return `<div class="result-message"><span class="status-icon ${successful ? "status-good" : "status-warn"}" aria-hidden="true">${successful ? "✓" : "!"}</span><div><h2>${tv("previewTitle")}</h2><p><strong>${escapeHtml(displayCandidateLabel(state.request.candidateLabel, tv("unnamedAed")))}</strong></p>${targetLink}<p class="simulation-note ${successful ? "save-status-success" : ""}" role="status">${recoveryMessage}</p>${blockedReason ? `<p class="simulation-note" role="status">${blockedReason}</p>` : ""}</div></div>${action}`;
    }
    case "candidate-error": {
      const errorKey: Record<typeof state.reason, FlowMessageKey> = {
        "location-unavailable": "locationUnavailable",
        "location-denied": "locationDenied",
        "location-uncertain": "locationUncertain",
        "sign-in": "errorSignIn",
        "rate-limited": "searchRateLimited",
        "service-unavailable": "searchUnavailable",
        "outside-coverage": "outsideCoverage",
        failed: "searchFailed",
        "invalid-response": "errorInvalidResponse",
      };
      const retryWaitSeconds =
        state.retryAvailableAt === undefined ? 0 : Math.max(0, Math.ceil((state.retryAvailableAt - Date.now()) / 1000));
      const retry =
        state.reason === "sign-in" || state.reason === "outside-coverage"
          ? ""
          : retryWaitSeconds > 0
            ? `<p class="simulation-note search-wait" aria-live="off">${tv("searchWait", { seconds: retryWaitSeconds })}</p>`
            : `<button class="button button-secondary" data-action="retry-search">${tv("searchRetry")}</button>`;
      const locationSource =
        photoSession.searchLocationSource === "photo"
          ? "locationSourcePhoto"
          : photoSession.searchLocationSource === "map"
            ? "locationSourceMap"
            : "locationSourcePhone";
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv("searchTitle")}</h2><p>${tv(errorKey[state.reason])}</p><p class="supporting-copy">${tv(locationSource)}</p></div></div>${retry}<button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    }
  }
}
