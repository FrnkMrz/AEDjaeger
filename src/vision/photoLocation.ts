import { gps } from "exifr/dist/mini.esm.mjs";
import type { SearchLocation } from "../osm/candidateSearch";

// The browser position API accepts only an accuracy estimate. EXIF normally stores a
// coordinate without that estimate, so use the route's maximum accepted uncertainty.
// This deliberately searches a broader, bounded area; it does not claim meter-level accuracy.
const UNKNOWN_PHOTO_GPS_ACCURACY_METERS = 100;
type GpsCoordinates = { latitude: number; longitude: number };
type GpsReader = (file: File) => Promise<GpsCoordinates | undefined>;

/** Read only GPS coordinates locally; never return or transmit any other EXIF fields. */
export async function readPhotoLocation(file: File, readGps: GpsReader = gps): Promise<SearchLocation | undefined> {
  try {
    // Passing the File lets exifr read only the metadata segments it needs on mobile devices.
    const coordinates = await readGps(file);
    if (!coordinates
      || !Number.isFinite(coordinates.latitude)
      || Math.abs(coordinates.latitude) > 90
      || !Number.isFinite(coordinates.longitude)
      || Math.abs(coordinates.longitude) > 180) return undefined;

    return {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      accuracyMeters: UNKNOWN_PHOTO_GPS_ACCURACY_METERS,
    };
  } catch {
    // Missing, stripped, or malformed metadata must not prevent the photo workflow.
    return undefined;
  }
}
