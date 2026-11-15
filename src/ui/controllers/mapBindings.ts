import type { FlowState } from "../../domain/workflow";
import type { FlowMessageKey } from "../../i18n/flowTranslations";
import { createPositionPicker, zoomToFitMarkers, type Coordinate, type MapMarker } from "../../map/positionPicker";
import type { PhotoSessionState } from "../../state/photoSession";

type TranslateFlow = (key: FlowMessageKey, values?: Record<string, number | string>) => string;

type MapBindingContext = {
  app: HTMLElement;
  state: FlowState;
  photoSession: Pick<PhotoSessionState, "mapLocationOverride">;
  minimumMapSearchZoom: number;
  newEntryPanelOpen: (state: FlowState) => boolean;
  newAedPositionOverride?: Coordinate;
  setNewAedPositionOverride: (position: Coordinate) => void;
  tv: TranslateFlow;
};

/**
 * Attach the map that belongs to the current workflow state and return its cleanup handle.
 * Location selection is still written only to the active, in-memory photo session.
 */
export function bindWorkflowMap(context: MapBindingContext): ReturnType<typeof createPositionPicker> | undefined {
  const { app, state, photoSession, minimumMapSearchZoom, newEntryPanelOpen, tv } = context;

  if (state.kind === "location-map") {
    const mapContainer = app.querySelector<HTMLDivElement>("#search-location-map");
    if (!mapContainer) return undefined;

    const picker = createPositionPicker(mapContainer, photoSession.mapLocationOverride ?? state.center, {
      mapLabel: tv("chooseMapLocation"),
      zoomInLabel: tv("newPositionMapZoomIn"),
      zoomOutLabel: tv("newPositionMapZoomOut"),
      tileErrorLabel: tv("newPositionMapTileError"),
      initialZoom: state.initialZoom,
      onPositionChange(position) {
        photoSession.mapLocationOverride = position;
        const coordinates = app.querySelector<HTMLParagraphElement>("#search-location-coordinates");
        if (coordinates)
          coordinates.textContent = tv("mapLocationCoordinates", {
            latitude: position.latitude.toFixed(5),
            longitude: position.longitude.toFixed(5),
          });
        updateMapSearchButton();
      },
      onZoomChange(zoom) {
        if (state.kind === "location-map") state.initialZoom = zoom;
        updateMapSearchButton();
      },
    });

    function updateMapSearchButton(): void {
      const confirmButton = app.querySelector<HTMLButtonElement>('[data-action="confirm-map-location"]');
      if (confirmButton)
        confirmButton.disabled =
          photoSession.mapLocationOverride === undefined ||
          (state.kind === "location-map" && (state.initialZoom ?? 19) < minimumMapSearchZoom);
    }

    return picker;
  }

  if (state.kind === "candidate-result" && !newEntryPanelOpen(state)) {
    // This overview is read-only: dragging it never changes the confirmed search point.
    const overviewContainer = app.querySelector<HTMLDivElement>("#candidate-overview-map");
    if (!overviewContainer) return undefined;
    const markers = reviewedCandidateMarkers(state);
    const bounds = overviewContainer.getBoundingClientRect();
    return createPositionPicker(overviewContainer, state.location, {
      mapLabel: tv("overviewMapLabel"),
      zoomInLabel: tv("newPositionMapZoomIn"),
      zoomOutLabel: tv("newPositionMapZoomOut"),
      tileErrorLabel: tv("newPositionMapTileError"),
      // Zoom out enough to keep the search point and every visible candidate in view.
      initialZoom: zoomToFitMarkers(state.location, markers, bounds.width || 300, bounds.height || 225),
      markers: [{ position: state.location, label: "", kind: "origin" }, ...markers],
      hideCrosshair: true,
      onPositionChange() {},
    });
  }

  if (context.newEntryPanelOpen(state) && state.kind === "candidate-result") {
    const mapContainer = app.querySelector<HTMLDivElement>("#new-aed-position-map");
    if (!mapContainer) return undefined;

    return createPositionPicker(mapContainer, context.newAedPositionOverride ?? state.location, {
      // Existing AEDs remain visible while the person confirms the proposed new location.
      markers: reviewedCandidateMarkers(state),
      mapLabel: tv("newPositionMapLabel"),
      zoomInLabel: tv("newPositionMapZoomIn"),
      zoomOutLabel: tv("newPositionMapZoomOut"),
      tileErrorLabel: tv("newPositionMapTileError"),
      onPositionChange(position) {
        context.setNewAedPositionOverride(position);
        const confirmation = app.querySelector<HTMLInputElement>("#new-aed-position-confirmed");
        if (confirmation) confirmation.checked = false;
        const coordinates = app.querySelector<HTMLParagraphElement>("#new-aed-position-coordinates");
        if (coordinates)
          coordinates.textContent = tv("newPreviewCoordinates", {
            latitude: position.latitude.toFixed(5),
            longitude: position.longitude.toFixed(5),
          });
        const label = app.querySelector<HTMLSpanElement>("#new-aed-position-label");
        if (label)
          label.textContent = tv("newPositionConfirm", {
            latitude: position.latitude.toFixed(5),
            longitude: position.longitude.toFixed(5),
          });
      },
    });
  }

  return undefined;
}

function reviewedCandidateMarkers(state: Extract<FlowState, { kind: "candidate-result" }>): MapMarker[] {
  if (state.assessment.kind !== "candidate-review") return [];
  const markers: MapMarker[] = [];
  state.assessment.candidates.forEach((ranked, index) => {
    const candidate = state.search.candidates.find((item) => item.id === ranked.id);
    if (candidate) markers.push({ position: candidate.position, label: String(index + 1) });
  });
  return markers;
}
