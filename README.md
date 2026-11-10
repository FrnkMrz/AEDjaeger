# AEDjaeger

Sammlung von Informationen, Links und Ideen für eine sehr einfache mobile App, mit der Menschen Defibrillatoren (AEDs) in OpenStreetMap erfassen und bestehende Einträge verbessern können.

**Stand:** 10. November 2026 · **Phase:** Manueller Fotoablauf mit AED-Suche im PMTiles-Archiv · **Sprache:** Deutsch

Vorbild ist [Hydrantenjäger](https://hydrantenjaeger.de), insbesondere die einfache Bedienung unterwegs. Die App läuft als kleiner Pilot auf Cloudflare; Vorschau und lokale Entwicklung bleiben verfügbar. Der Produktname lautet in allen Sprachen **AEDjaeger**.

## Einstieg

- [Recherche und kommentierte Linksammlung](docs/recherche.md)
- [Produktkonzept: Foto, Sichtbestätigung und OSM-Abgleich](docs/konzept.md)
- [Architektur, Bedienung, Hosting und Schwachstellen](docs/architektur.md)
- [Umsetzungsplan für den programmierenden AI-Agenten](docs/umsetzungsplan.md)
- [Gamification-Konzept: das AED-Signalnetz](docs/gamification.md)
- [OSM-Datenmodell und technische Grundlagen](docs/osm.md)
- [Anknüpfung an Hydrantenjäger](docs/hydrantenjaeger.md)
- [Offene Fragen und nächste Schritte](docs/offene-fragen.md)
- [Pilot-Abnahme: Handytest, Live-Check, OSM-Dev-Test und Release](docs/pilot-abnahme.md)
- [Übergabe für neuen Chat oder Coding-Agenten](docs/uebergabe.md)

## Festgelegte Produktrichtung

**Foto machen → Sichtbarkeit von AED oder Gehäuse selbst bestätigen → regionale AED-Daten prüfen → vorhandenen AED bestätigen oder neuen Eintrag vorbereiten.**

Absolute Einfachheit ist das oberste Ziel. Die Person bestätigt selbst, dass AED oder Gehäuse im Foto zu sehen ist; die App unterstützt danach bei Standortsuche und Zuordnung. Nur notwendige offene Fragen werden gestellt; vorhandene Einträge müssen nicht erst vervollständigt werden. Details stehen im [Produktkonzept](docs/konzept.md).

## Technische Richtung

PWA mit kleinem Serverdienst; Code auf GitHub, gemeinsames Hosting von Oberfläche und API auf Cloudflare Workers mit Static Assets. Im Pilot bleibt das Foto samt EXIF auf dem Gerät und es gibt keinen externen Bilddienst. Die Umgebungssuche liest die AED-Ebene direkt aus dem bestehenden OpenFireMap-PMTiles-Archiv und fragt nur die Kacheln am bestätigten Foto-Standort ab. Overpass ist kein Laufzeitbestandteil. AEDjaeger liest die Datei nur; es startet oder betreibt keine Datenpipeline. Die Implementierung und Prüfgrenzen stehen in [OSM-Datenzugriff](docs/osm.md) und [Architektur](docs/architektur.md).

## Sprachen und Gamification

Die erste Version soll Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch unterstützen. Im Pilot bleibt Gamification vollständig unsichtbar; intern werden nur erfolgreiche Vor-Ort-Prüfungen gezählt. Teilen und öffentliche Fortschrittsanzeigen kommen frühestens nach dem Pilot als separate Entscheidung infrage. Details und Grenzen: [Gamification-Konzept](docs/gamification.md).

## Erste Erkenntnisse

Hydrantenjäger besitzt bereits einen AED-Erfassungsablauf. Das ist ein konkreter Ausgangspunkt für eine vereinfachte, eigenständige Oberfläche. OpenAEDMap und MapComplete sind wichtige Vergleichsangebote. Das vom Projektinitiator verlinkte Forschungsprojekt AEDHunter liefert Anregungen für spielerisches Entdecken und wiederholte Ortsbesuche. Quellen und Grenzen dieser Aussagen stehen in den verlinkten Dokumenten.

## Sammlung weiterführen

Neue Quellen mit URL, Abrufdatum, kurzer Einordnung und offenen Fragen ergänzen. Belegte Funktionen, eigene Vorschläge und noch ungeprüfte Annahmen unterscheiden. Entscheidungen erst dann als beschlossen kennzeichnen, wenn sie tatsächlich getroffen wurden.

Das Repository ist öffentlich. Der Produktname steht auf **AEDjaeger** fest; die Lizenz ist noch offen.

## Lokaler Prototyp

Voraussetzung: Node.js und npm. Unterstützt werden Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`, wie in `package.json` eingetragen. Mit `npm install` und `npm run dev` lässt sich der Prototyp lokal starten. `npm test` prüft die Fachlogik; `npm run build` prüft Typen und erstellt die PWA. Für die mobile Browserprüfung einmalig `npx playwright install chromium` ausführen, danach `npm run test:e2e`. Die End-to-End-Prüfung startet die gebaute Vorschau selbst und prüft den Ablauf auf einem emulierten schmalen Android-Bildschirm, sechs Info-Übersetzungen und den Offline-Cache für App-Shell und gebündelte Dateien. Sie ersetzt keine Kamera- oder Berechtigungsprüfung am echten Handy. Unter „Vorschau testen“ können bestehende und neue AEDs, Mehrfachtreffer sowie unklare oder fehlgeschlagene Suchen simuliert werden. Alle Speicheraktionen sind ausdrücklich nur Vorschau; es wird nichts an OpenStreetMap gesendet. Der lesende Live-Check des AED-Archivs startet mit `npm run check:live-search` (optional `-- --lat 49.4456 --lon 11.0825`). Er lief am 10.11.2026 erfolgreich (nur Standardkoordinate); er gehört nicht zu `npm test` und verändert nichts. Details: [Pilot-Abnahme](docs/pilot-abnahme.md).
