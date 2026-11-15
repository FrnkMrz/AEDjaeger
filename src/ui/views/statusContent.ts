import type { FlowState } from "../../domain/workflow";
import type { FlowMessageKey } from "../../i18n/flowTranslations";
import type { Language, TranslationKey } from "../../i18n/translations";
import type { Coordinate } from "../../map/positionPicker";
import type { SearchLocationSource } from "../../state/photoSession";
import { defibrillatorMark, displayCandidateLabel } from "../markup";
import { renderCandidateResult } from "./candidateResult";
import { renderPhotoState } from "./photoStates";
import { renderPreviewState } from "./previewStates";

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
    searchLocationSource,
    developmentWriteStatusKeys,
    isRecoveryOwnerMismatch,
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
    case "new-aed-preview":
    case "osm-preview":
    case "existing-aed-details":
      return renderPreviewState({ ...context, state });
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
