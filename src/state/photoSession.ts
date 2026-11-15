import type { Coordinate } from "../map/positionPicker";
import type { SearchLocation } from "../osm/candidateSearch";

export type SearchLocationSource = "photo" | "phone" | "phone-auto" | "map";

/**
 * Ephemeral state that belongs to the currently selected photo and its nearby search.
 *
 * This is intentionally an in-memory object, not browser storage: photos, their local
 * metadata, coordinates, and the draft observation date must not persist beyond the active
 * workflow. The `photoUrl` itself stays in the workflow state; this object stores only the
 * associated file and decision metadata needed while that state is active.
 */
export type PhotoSessionState = {
  file?: File;
  checkRequestId?: string;
  fromCamera: boolean;
  capturedAtMs?: number;
  locationFromPhoto?: SearchLocation;
  observedOn: string;
  dateRequiresConfirmation: boolean;
  searchLocation?: SearchLocation;
  searchLocationSource?: SearchLocationSource;
  selectionVersion: number;
  selectionPending: boolean;
  selectionError: boolean;
  mapLocationOverride?: Coordinate;
};

/** Build a fresh photo session with no photo or inherited location state. */
export function createPhotoSessionState(initialObservedOn: string): PhotoSessionState {
  return {
    fromCamera: false,
    observedOn: initialObservedOn,
    dateRequiresConfirmation: false,
    selectionVersion: 0,
    selectionPending: false,
    selectionError: false,
  };
}
