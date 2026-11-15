import type { FlowState } from "../../domain/workflow";
import { localCalendarDate } from "../../domain/localDate";
import type { Coordinate } from "../../map/positionPicker";
import type { FlowMessageKey } from "../../i18n/flowTranslations";
import type { TranslationKey } from "../../i18n/translations";

type Translate = (key: TranslationKey, values?: Record<string, number | string>) => string;
type TranslateFlow = (key: FlowMessageKey, values?: Record<string, number | string>) => string;

export type PhotoStateViewContext = {
  t: Translate;
  tv: TranslateFlow;
  escapeHtml: (value: string) => string;
  photoMarkup: string;
  photoCheckAvailable: boolean;
  selectedPhotoFileAvailable: boolean;
  mapLocationOverride?: Coordinate;
  minimumMapSearchZoom: number;
};

type PhotoFlowState = Extract<
  FlowState,
  {
    kind:
      | "photo"
      | "photo-checking"
      | "photo-rejected"
      | "photo-date"
      | "location-choice"
      | "location-map"
      | "candidate-searching";
  }
>;

/** Zeichnet die Foto-, Ortswahl- und Suchladezustände ohne DOM- oder App-Zustandszugriff. */
export function renderPhotoState(current: PhotoFlowState, context: PhotoStateViewContext): string {
  const { photoMarkup, t, tv, escapeHtml } = context;
  switch (current.kind) {
    case "photo": {
      // Ist der optionale Foto-Filter freigeschaltet, erklärt die Ansicht den Upload vor der Aktion.
      const useCheck =
        context.photoCheckAvailable && current.photoCheck !== "unavailable" && context.selectedPhotoFileAvailable;
      const photoAction = useCheck
        ? `<button class="button button-primary" data-action="check-photo">${tv("photoCheckAction")}</button>`
        : `<button class="button button-primary" data-action="confirm-sighting">${tv("sightingConfirm")}</button>`;
      // Nach einem gescheiterten Prüfversuch kann der Upload bereits erfolgt sein. Daher nie behaupten,
      // das Foto sei lokal geblieben; nur der feste Hinweis auf den nicht verfügbaren Filter erscheint.
      const photoNote = useCheck
        ? `<p class="supporting-copy">${tv("photoCheckNotice")}</p>`
        : current.photoCheck === "unavailable"
          ? `<p class="supporting-copy">${tv("photoCheckUnavailable")}</p>${current.photoCheckCode ? `<p class="supporting-copy photo-check-code">${escapeHtml(tv("photoCheckCode", { code: current.photoCheckCode }))}</p>` : ""}`
          : `<p class="supporting-copy">${tv("photoStaysLocal")}</p>`;
      return `${photoMarkup}${photoAction}${photoNote}<button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
    }
    case "photo-checking":
      return `${photoMarkup}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${tv("photoChecking")}</span></div>`;
    case "photo-rejected":
      // Der normale Weg ist ein neues Foto; eine irrtümliche Ablehnung kann nur mit zwei ausdrücklichen
      // Bestätigungen übergangen werden. Diese Ansicht bietet dieselben zwei Aktionen wie zuvor.
      if (current.overrideStep === "confirm") {
        return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("photoOverrideTitle")}</h2><p>${tv("photoOverrideBody")}</p></div></div><button class="button button-primary" data-action="confirm-photo-override">${tv("photoOverrideConfirm")}</button><button class="button button-quiet" data-action="retake">${t("retake")}</button>`;
      }
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">!</span><div><h2>${tv(current.reason === "unclear" ? "photoUnclearTitle" : "photoRejectedTitle")}</h2><p>${tv(current.reason === "unclear" ? "photoUnclearBody" : "photoRejectedBody")}</p></div></div><button class="button button-primary" data-action="retake">${t("retake")}</button><button class="button button-secondary" data-action="start-photo-override">${tv("photoOverrideAction")}</button>`;
    case "photo-date":
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("photoDateTitle")}</h2><p>${tv("photoDateHelp")}</p><label for="photo-observed-on">${tv("photoDateLabel")}</label><input id="photo-observed-on" type="date" value="${escapeHtml(current.suggestedDate)}" max="${localCalendarDate()}" /></div></div><button class="button button-primary" data-action="confirm-photo-date">${tv("photoDateConfirm")}</button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    case "location-choice":
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">?</span><div><h2>${tv("locationTitle")}</h2><p>${tv("photoLocationMissing")}</p></div></div><button class="button button-primary" data-action="use-phone-location">${tv("usePhoneLocation")}</button><button class="button button-secondary" data-action="choose-map-location">${tv("chooseMapLocation")}</button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    case "location-map": {
      const selectedPosition = context.mapLocationOverride ?? current.center;
      const mapHasSelection =
        context.mapLocationOverride !== undefined && (current.initialZoom ?? 19) >= context.minimumMapSearchZoom;
      const mapPositionLabel = mapHasSelection
        ? tv("mapLocationCoordinates", {
            latitude: selectedPosition.latitude.toFixed(5),
            longitude: selectedPosition.longitude.toFixed(5),
          })
        : tv("mapLocationInitial");
      return `${photoMarkup}<div class="result-message"><span class="status-icon status-warn" aria-hidden="true">◎</span><div><h2>${tv("chooseMapLocation")}</h2><p>${tv("mapLocationHelp")}</p></div></div><div id="search-location-map" class="position-map" role="application" tabindex="0" aria-label="${tv("chooseMapLocation")}" aria-describedby="search-map-instructions"></div><p class="sr-only" id="search-map-instructions">${tv("mapNavigationHelp")}</p><p class="position-map-coordinates" id="search-location-coordinates" aria-live="polite">${mapPositionLabel}</p><button class="button button-primary" data-action="confirm-map-location"${mapHasSelection ? "" : " disabled"}>${tv("searchAction")}</button><button class="button button-quiet" data-action="retake">${tv("return")}</button>`;
    }
    case "candidate-searching":
      return `${photoMarkup}<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${tv("searchProgress")}</span></div>`;
    default: {
      const unreachableState: never = current;
      return unreachableState;
    }
  }
}
