/**
 * Standort-Erlaubnis des Handys: lesen, beobachten und einmal anfragen.
 *
 * Hintergrund: Safari auf dem iPhone liefert Fotos, die über ein Dateifeld in die App kommen, oft ohne
 * Ortsangabe. Damit die Person bei einem frisch aufgenommenen Foto nicht jedes Mal den Handy-Standort
 * bestätigen muss, fragt die App ein einziges Mal nach der Erlaubnis. Danach nutzt sie den Standort ohne
 * Zwischenfrage, aber nur für ein Foto, das gerade eben mit der App aufgenommen wurde (siehe main.ts).
 *
 * Diese Datei kennt weder das Foto noch die Suche. Sie liest nur den Erlaubnis-Zustand und löst höchstens
 * einmal die Systemabfrage des Browsers aus. Die dabei ermittelte Position wird sofort verworfen: Sie wird
 * weder gespeichert noch gesendet.
 */

import { isFreshCapture } from "../domain/localDate";

/** „unknown“: Der Browser kann den Zustand nicht abfragen (Permissions API fehlt). Dann nie automatisch nutzen. */
export type LocationPermission = "granted" | "denied" | "prompt" | "unknown";

/** Merkt sich im Browser, dass die einmalige Anfrage schon gestellt wurde. Enthält keine Personendaten. */
export const LOCATION_PROMPTED_KEY = "aedjaeger-location-prompted";

type PermissionsApi = {
  query(descriptor: { name: "geolocation" }): Promise<{ state: string; addEventListener?: (type: "change", listener: () => void) => void; removeEventListener?: (type: "change", listener: () => void) => void }>;
};

function toPermission(state: string): LocationPermission {
  return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
}

/** Liest den aktuellen Zustand, ohne etwas anzufragen. Jeder Fehler ergibt „unknown“. */
export async function readLocationPermission(permissions: PermissionsApi | undefined = globalThis.navigator?.permissions): Promise<LocationPermission> {
  if (!permissions) return "unknown";
  try {
    return toPermission((await permissions.query({ name: "geolocation" })).state);
  } catch {
    // Manche Browser kennen „geolocation“ in der Permissions API nicht und werfen einen Fehler.
    return "unknown";
  }
}

/**
 * Meldet jede Änderung der Erlaubnis (zum Beispiel nach dem Tippen auf „Erlauben“ im Systemdialog).
 * Der Rückgabewert beendet die Beobachtung. Ohne Unterstützung des Browsers passiert nichts.
 */
export async function watchLocationPermission(
  onChange: (permission: LocationPermission) => void,
  permissions: PermissionsApi | undefined = globalThis.navigator?.permissions,
): Promise<() => void> {
  if (!permissions) return () => undefined;
  try {
    const status = await permissions.query({ name: "geolocation" });
    onChange(toPermission(status.state));
    const listener = (): void => onChange(toPermission(status.state));
    status.addEventListener?.("change", listener);
    return () => status.removeEventListener?.("change", listener);
  } catch {
    return () => undefined;
  }
}

/**
 * Passt der Handy-Standort jetzt zum Foto?
 *
 * Nur bei einem Foto, das mit der Kamera der App entstand UND höchstens fünf Minuten alt ist. Die Frage
 * wird bei jeder Fortsetzung neu gestellt, nicht nur bei der Fotoauswahl: Wer die App nach der Aufnahme
 * zehn Minuten im Hintergrund lässt und erst dann bestätigt, steht vielleicht schon woanders.
 * Ist die Aufnahmezeit unbekannt, passt der Standort nicht.
 *
 * @param nowMs Aktuelle Zeit; nur für Tests überschreibbar.
 */
export function phoneLocationFitsPhoto(options: { fromCamera: boolean; capturedAtMs: number | undefined; nowMs?: number }): boolean {
  return options.fromCamera && isFreshCapture(options.capturedAtMs, options.nowMs ?? Date.now());
}

export type AskOnceOptions = {
  permission: LocationPermission;
  storage: Pick<Storage, "getItem" | "setItem">;
  geolocation: Pick<Geolocation, "getCurrentPosition"> | undefined;
  /** Wird mit „granted“ aufgerufen, wenn die Person im Systemdialog erlaubt hat. */
  onGranted?: () => void;
};

/**
 * Löst höchstens EINMAL pro Gerät die Standortabfrage des Browsers aus.
 *
 * Gefragt wird nur, wenn der Browser noch nicht entschieden hat („prompt“ oder „unknown“). Hat die Person
 * schon erlaubt oder abgelehnt, bleibt es dabei. Wer den Systemdialog wegwischt, wird beim nächsten Start
 * nicht erneut bedrängt: Die Anfrage gilt als gestellt, und die ausdrückliche Wahl in der App bleibt möglich.
 * Kann der Merker nicht gelesen oder geschrieben werden (zum Beispiel im privaten Modus), wird nicht
 * gefragt, damit die Anfrage nicht bei jedem Start wiederkehrt.
 *
 * @returns true, wenn die Abfrage jetzt ausgelöst wurde.
 */
export function askForLocationOnce(options: AskOnceOptions): boolean {
  const { permission, storage, geolocation, onGranted } = options;
  if (!geolocation || (permission !== "prompt" && permission !== "unknown")) return false;
  try {
    if (storage.getItem(LOCATION_PROMPTED_KEY) !== null) return false;
    // Zuerst merken, dann fragen: Auch bei einem Absturz mitten in der Abfrage kommt sie nicht wieder.
    storage.setItem(LOCATION_PROMPTED_KEY, "1");
  } catch {
    return false;
  }
  geolocation.getCurrentPosition(
    // Die Position wird verworfen. Es zählt nur, ob erlaubt wurde.
    () => onGranted?.(),
    () => undefined,
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
  );
  return true;
}
