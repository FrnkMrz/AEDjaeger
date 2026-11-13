import { UNKNOWN_PHOTO_GPS_ACCURACY_METERS as UNKNOWN_PHOTO_GPS_ACCURACY_METERS_SHARED } from "../domain/matchPolicy";
import exifr from "exifr";
import { gps } from "exifr/dist/mini.esm.mjs";
import type { SearchLocation } from "../osm/candidateSearch";

// The browser position API accepts only an accuracy estimate. EXIF normally stores a
// coordinate without that estimate, so use the route's maximum accepted uncertainty.
// This deliberately searches a broader, bounded area; it does not claim meter-level accuracy.
// Die Entfernungsstufen stehen in src/domain/matchPolicy.ts.
const UNKNOWN_PHOTO_GPS_ACCURACY_METERS = UNKNOWN_PHOTO_GPS_ACCURACY_METERS_SHARED;
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

/** Aufnahmezeitpunkt eines Fotos: Kalendertag für OSM und genaue Zeit für die „gerade eben“-Prüfung. */
export type PhotoCapture = { date: string; timeMs: number };

/**
 * Liest nur den Aufnahmezeitpunkt lokal aus den EXIF-Daten. Nichts davon verlässt das Gerät.
 * `date` ist der Kalendertag, den die Kamera angezeigt hat. `timeMs` ist derselbe Zeitpunkt in
 * Millisekunden; damit erkennt die App, ob das Foto erst vor wenigen Minuten entstanden ist.
 */
export async function readPhotoCapture(file: File): Promise<PhotoCapture | undefined> {
  try {
    const metadata = await exifr.parse(file, ["DateTimeOriginal"]);
    const value = metadata?.DateTimeOriginal;
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return undefined;
    // EXIF dates have no timezone. Keep the camera's displayed calendar day instead of shifting it to UTC.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return { date: `${year}-${month}-${day}`, timeMs: value.getTime() };
  } catch {
    return undefined;
  }
}

/** Read only the capture date locally; it prevents an old or undated photo from silently becoming today's check. */
export async function readPhotoDate(file: File): Promise<string | undefined> {
  return (await readPhotoCapture(file))?.date;
}
