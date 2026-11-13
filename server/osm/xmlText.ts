/**
 * Entfernt die XML-Kopfzeile (<?xml version="1.0" encoding="UTF-8"?>) am Anfang einer OSM-Antwort.
 *
 * Warum? Die echten Antworten der OSM-API beginnen mit dieser Zeile, zum Beispiel
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <diffResult version="0.6" ...> ... </diffResult>
 * Unsere Muster zur Prüfung der Antwort erwarten den Wurzel-Tag direkt am Anfang. Ohne diese Vorbereitung
 * erkennt die App eine erfolgreiche Anlage nicht, obwohl der Knoten existiert, und meldet "Ergebnis unklar".
 * Es wird nur die Kopfzeile entfernt; alles Weitere prüfen die Aufrufer weiterhin streng.
 */
export function withoutXmlDeclaration(value: string): string {
  return value.replace(/^\s*<\?xml\b[^?]*\?>\s*/u, "");
}
