/**
 * Die Entfernungen, nach denen die App einen vorhandenen AED einem Foto zuordnet.
 *
 * Entscheidung des Projektinhabers (13.11.2026, nach dem Android-Test): Ein AED in 170 m Entfernung ist kein Treffer.
 * Es gelten zwei Stufen, gemessen vom gemeldeten oder auf der Karte gesetzten Punkt:
 *   - bis CONFIRM_RADIUS_METERS (10 m): Treffer zum Bestätigen ("noch vorhanden").
 *   - bis NEARBY_RADIUS_METERS (50 m): nur ein Hinweis mit Entfernung. Der AED lässt sich nicht bestätigen, muss aber
 *     vor einer Neuanlage geprüft werden, damit keine Doppelten entstehen.
 *   - weiter weg: wird nicht angezeigt und nicht geprüft.
 * Dieselbe Reichweite nutzen die Suche (Server) und der Schutz vor Doppelten beim Anlegen. Läge der Schutz weiter
 * als die Suche, würde er wegen eines AED blockieren, den die Suche nie gezeigt hat.
 *
 * Weil die Stufen von einem brauchbaren Standort ausgehen, gilt eine Genauigkeit über MAX_LOCATION_ACCURACY_METERS
 * als zu ungenau. Dann fragt die App nach der Kartenposition.
 */
export const CONFIRM_RADIUS_METERS = 10;
export const NEARBY_RADIUS_METERS = 50;
export const MAX_LOCATION_ACCURACY_METERS = 50;

/** Ein von Hand auf der Karte gesetzter Punkt gilt als recht genau, weil die Person ihn bewusst bei hohem Zoom setzt. */
export const MAP_PIN_ACCURACY_METERS = 10;

/** Ein GPS-Punkt aus den Foto-Metadaten enthält keine Genauigkeitsangabe. Handy-GPS liegt meist bei 5 bis 30 m. */
export const UNKNOWN_PHOTO_GPS_ACCURACY_METERS = 25;
