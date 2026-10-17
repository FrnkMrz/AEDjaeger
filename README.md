# AEDjäger

Sammlung von Informationen, Links und Ideen für eine sehr einfache mobile App, mit der Menschen Defibrillatoren (AEDs) in OpenStreetMap erfassen und bestehende Einträge verbessern können.

**Stand:** 17. Oktober 2026 · **Phase:** Recherche und Konzept · **Sprache:** Deutsch

Vorbild ist [Hydrantenjäger](https://hydrantenjaeger.de), insbesondere die einfache Bedienung unterwegs. Dieses Repository enthält zunächst Dokumentation; eine App ist noch nicht implementiert. „AEDjäger“ ist ein Arbeitsname.

## Einstieg

- [Recherche und kommentierte Linksammlung](docs/recherche.md)
- [Produktkonzept: Foto, KI und OSM-Abgleich](docs/konzept.md)
- [Architektur, Bedienung, Hosting und Schwachstellen](docs/architektur.md)
- [Umsetzungsplan für den programmierenden AI-Agenten](docs/umsetzungsplan.md)
- [Gamification-Konzept: das AED-Signalnetz](docs/gamification.md)
- [OSM-Datenmodell und technische Grundlagen](docs/osm.md)
- [Anknüpfung an Hydrantenjäger](docs/hydrantenjaeger.md)
- [Offene Fragen und nächste Schritte](docs/offene-fragen.md)

## Festgelegte Produktrichtung

**Foto machen → KI erkennt den AED und liest sichtbare Angaben → Abgleich mit OpenStreetMap → neu eintragen oder „noch vorhanden“ bestätigen.**

Absolute Einfachheit ist das oberste Ziel. Die App übernimmt Erkennung und Zuordnung. Nur notwendige offene Fragen werden gestellt; vorhandene Einträge müssen nicht erst vervollständigt werden. Im eindeutigen Fall reicht nach dem Foto ein Tippen zum Speichern. Details stehen im [Produktkonzept](docs/konzept.md).

## Technische Richtung

PWA mit kleinem Serverdienst; Code auf GitHub, gemeinsames Hosting von Oberfläche und API auf Cloudflare Workers mit Static Assets. Cloudflare ist als Richtung gewählt, Implementierung und Deployment haben noch nicht begonnen. Die KI liefert Bildbeobachtungen, feste Regeln prüfen die Zuordnung, und erst eine kurze Benutzerbestätigung löst die konkrete OSM-Änderung aus. Gemini, OpenAI und Claude werden vor der Auswahl eines produktiven Anbieters mit denselben geeigneten Testbildern verglichen. Begründung, Alternativen und Prüfschritte stehen im [Architekturentwurf](docs/architektur.md).

## Sprachen und Gamification

Die erste Version soll Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch unterstützen. Im Pilot bleibt Gamification vollständig unsichtbar; intern werden nur erfolgreiche Vor-Ort-Prüfungen gezählt. Teilen und öffentliche Fortschrittsanzeigen kommen frühestens nach dem Pilot als separate Entscheidung infrage. Details und Grenzen: [Gamification-Konzept](docs/gamification.md).

## Erste Erkenntnisse

Hydrantenjäger besitzt bereits einen AED-Erfassungsablauf. Das ist ein konkreter Ausgangspunkt für eine vereinfachte, eigenständige Oberfläche. OpenAEDMap und MapComplete sind wichtige Vergleichsangebote. Das vom Projektinitiator verlinkte Forschungsprojekt AEDHunter liefert Anregungen für spielerisches Entdecken und wiederholte Ortsbesuche. Quellen und Grenzen dieser Aussagen stehen in den verlinkten Dokumenten.

## Sammlung weiterführen

Neue Quellen mit URL, Abrufdatum, kurzer Einordnung und offenen Fragen ergänzen. Belegte Funktionen, eigene Vorschläge und noch ungeprüfte Annahmen unterscheiden. Entscheidungen erst dann als beschlossen kennzeichnen, wenn sie tatsächlich getroffen wurden.

Das Repository wurde zunächst privat angelegt. Veröffentlichung, Lizenz, endgültiger Name und technische Umsetzung sind noch offen.
