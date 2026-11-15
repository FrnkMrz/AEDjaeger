import { MAP_PIN_ACCURACY_METERS } from "../../domain/matchPolicy";
import type { FlowState } from "../../domain/workflow";
import type { Coordinate } from "../../map/positionPicker";
import type { SearchLocation } from "../../osm/candidateSearch";
import type { PhotoSessionState } from "../../state/photoSession";

export type PhotoLocationActionResult = "unhandled" | "handled" | "stop";

export type PhotoLocationActionContext = {
  getState(): FlowState;
  setState(state: FlowState): void;
  photoSession: PhotoSessionState;
  accountSignedIn: boolean;
  photoCheckAvailable: boolean;
  phoneLocationPermission: "unknown" | "prompt" | "denied" | "granted";
  phoneLocationFitsPhoto(): boolean;
  readObservedDate(): string | undefined;
  isValidObservedDate(value: string): boolean;
  runPhotoCheck(photoUrl: string): void;
  proceedAfterSighting(photoUrl: string): void;
  continueAfterSighting(photoUrl: string): void;
  runNearbySearch(photoUrl: string, location?: SearchLocation): void;
  clearSearchRetryTimer(): void;
  render(restoreFocus?: boolean): void;
};

/**
 * Route photo and location actions to the small set of transitions that own that session.
 *
 * The dispatcher receives state and effects from `main.ts` rather than importing application
 * globals. The return value distinguishes an unrelated action, an action whose ordinary render
 * should continue in the caller, and an invalid date action that the old handler stops silently.
 * This keeps the action contract explicit without moving OSM write-confirmation transitions.
 */
export function dispatchPhotoLocationAction(
  action: string | undefined,
  context: PhotoLocationActionContext,
): PhotoLocationActionResult {
  const state = context.getState();

  if (action === "confirm-sighting") {
    if (state.kind === "photo" && context.accountSignedIn) context.proceedAfterSighting(state.photoUrl);
    return "handled";
  }
  if (action === "check-photo") {
    if (state.kind === "photo" && context.accountSignedIn && context.photoCheckAvailable)
      context.runPhotoCheck(state.photoUrl);
    return "handled";
  }
  if (action === "start-photo-override") {
    if (state.kind === "photo-rejected" && state.overrideStep === undefined && context.accountSignedIn) {
      // Erste Bestätigung der Ausnahme; die zweite Nachfrage bleibt ein eigener Folgeschritt.
      context.setState({ ...state, overrideStep: "confirm" });
      context.render(true);
    }
    return "handled";
  }
  if (action === "confirm-photo-override") {
    if (state.kind === "photo-rejected" && state.overrideStep === "confirm" && context.accountSignedIn)
      context.proceedAfterSighting(state.photoUrl);
    return "handled";
  }
  if (action === "confirm-photo-date") {
    if (state.kind !== "photo-date" || !context.accountSignedIn) return "handled";
    const observedOn = context.readObservedDate();
    if (!observedOn || !context.isValidObservedDate(observedOn)) return "stop";
    context.photoSession.observedOn = observedOn;
    context.photoSession.dateRequiresConfirmation = false;
    context.continueAfterSighting(state.photoUrl);
    return "handled";
  }
  if (action === "use-phone-location") {
    if (state.kind === "location-choice") {
      context.photoSession.searchLocation = undefined;
      context.photoSession.searchLocationSource = "phone";
      context.runNearbySearch(state.photoUrl);
    }
    return "handled";
  }
  if (action === "choose-map-location") {
    if (state.kind === "location-choice") {
      // Eine Kartenwahl bleibt auch ohne Handy-Ortsfreigabe möglich und startet neutral.
      context.photoSession.mapLocationOverride = undefined;
      context.photoSession.searchLocationSource = "map";
      context.setState({
        kind: "location-map",
        photoUrl: state.photoUrl,
        center: { latitude: 50, longitude: 10, accuracyMeters: 1_000 },
        initialZoom: 6,
      });
    }
    return "handled";
  }
  if (action === "confirm-map-location") {
    if (state.kind === "location-map") {
      const position: Coordinate = context.photoSession.mapLocationOverride ?? state.center;
      context.photoSession.searchLocationSource = "map";
      context.runNearbySearch(state.photoUrl, { ...position, accuracyMeters: MAP_PIN_ACCURACY_METERS });
    }
    return "handled";
  }
  if (action === "retry-search") {
    const canRetry =
      state.kind === "candidate-error" ||
      (state.kind === "candidate-result" &&
        (state.search.status === "partial" || state.assessment.kind === "search-incomplete"));
    if (!canRetry) return "unhandled";

    // Photo GPS and a chosen map point are stable. Phone GPS is reacquired on retry because
    // the user may have moved; an automatically substituted point expires with a stale photo.
    const autoLocationExpired =
      context.photoSession.searchLocationSource === "phone-auto" &&
      !(context.phoneLocationPermission === "granted" && context.phoneLocationFitsPhoto());
    if (autoLocationExpired) {
      context.clearSearchRetryTimer();
      context.photoSession.searchLocation = undefined;
      context.photoSession.searchLocationSource = undefined;
      context.setState({ kind: "location-choice", photoUrl: state.photoUrl });
      context.render(true);
    } else {
      const retryLocation =
        context.photoSession.searchLocationSource === "photo" || context.photoSession.searchLocationSource === "map"
          ? context.photoSession.searchLocation
          : undefined;
      context.runNearbySearch(state.photoUrl, retryLocation);
    }
    return "handled";
  }

  return "unhandled";
}
