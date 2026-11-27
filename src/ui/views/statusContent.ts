import type { FlowState } from "../../domain/workflow";
import type { FlowMessageKey } from "../../i18n/flowTranslations";
import type { Language, TranslationKey } from "../../i18n/translations";
import type { Coordinate } from "../../map/positionPicker";
import type { SearchLocationSource } from "../../state/photoSession";
import { defibrillatorMark } from "../markup";
import { renderCandidateError } from "./candidateError";
import { renderCandidateResult } from "./candidateResult";
import { renderPhotoState } from "./photoStates";
import { renderPreviewState } from "./previewStates";
import { renderWriteRecovery } from "./writeRecovery";

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
  /** Echtes OSM (Etappe Q3): Der Server erlaubt dieser Sitzung, das Prüfdatum zu speichern. */
  productionWriteAvailable: boolean;
  productionWriteStatusKeys: Record<DevelopmentWriteStatus, FlowMessageKey>;
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
    detailFormMarkup,
    detailFooterMarkup,
  } = context;
  const photoMarkup = context.photoMarkup;
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
    case "development-write-recovery":
      return renderWriteRecovery({ ...context, state });
    case "candidate-error":
      return renderCandidateError({ ...context, state });
  }
}
