# Entscheidungen und nächste Schritte

Stand: 17.10.2026. Fotoaufnahme und maximale Einfachheit sind festgelegt: **Foto → prüfen → vorhandenen AED kurz bestätigen oder neuen AED eintragen.**

## Festgelegt

- Die App ist als mobile PWA mit gemeinsam gehosteter Oberfläche und API auf Cloudflare vorgesehen. Implementierung und Deployment haben noch nicht begonnen.
- Vor dem AED wird ein Foto aufgenommen. Die KI prüft, ob ein AED zu sehen ist, und liest nur klar erkennbare Angaben aus.
- Der Standort wird mit bestehenden OpenStreetMap-Einträgen abgeglichen. Ein passender Treffer wird als „noch vorhanden“ bestätigt; ohne Treffer wird ein neuer Eintrag vorbereitet.
- Im eindeutigen Fall genügt eine kurze Bestätigung für den OSM-Schreibvorgang.
- Die erste Version soll Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch unterstützen.
- Im Pilot wird Gamification nur intern gezählt: erfolgreiche Vor-Ort-Prüfungen nach bestätigtem OSM-Vorgang. Es gibt keine sichtbare Anzeige und keine Teilfunktion. Teilen wird frühestens nach dem Pilot neu bewertet.
- Vorbild bleibt Hydrantenjäger. „AEDjäger“ ist ein Arbeitsname.
- Das Repository sammelt Recherche und Umsetzungskonzept; Anwendungscode ist noch nicht implementiert.

## Nächste praktische Prüfungen

1. Einen kleinen, rechtmäßig nutzbaren Bildtestsatz für Gemini, OpenAI und Claude zusammenstellen: sichtbares Gerät, Beschriftung, Kasten, Wegweiser, leere Halterung, mehrere Geräte und schwierige Bilder. Für Chat-Apps und API-Free-Tarife keine privaten oder sensiblen Fotos verwenden.
2. Zuerst die vorhandenen Chat-Abos als manuellen qualitativen Vorfilter verwenden; danach Gemini Developer API Free für den tatsächlichen API-Ablauf prüfen. Kostenpflichtige OpenAI- oder Claude-API-Aufrufe nur bei bestätigtem Guthaben und gesetztem Ausgabenlimit.
3. Den OSM-Abgleich mit echten Standorten als Vorschau erproben, einschließlich mehrerer Geräte in einem Gebäude und ungenauem GPS.
4. Einen durchgehenden Ablauf „Foto → Ergebnis → kurze Bestätigung“ auf einem Mobilgerät vorführen.

## Noch zu entscheiden

- Welcher API-Anbieter besteht den Bildtest mit ausreichender Zuverlässigkeit, Datenschutzbedingungen, Wartezeit und Kosten? Chat-Abos erlauben manuelle Tests, sind aber kein API-Zugang. Vor API-Tests kostenlose Quoten, vorhandenes Guthaben und Abrechnung prüfen.
- Welche minimalen Pflichtangaben sind bei Neuanlagen tatsächlich nötig, und wann ist eine Standortkorrektur erforderlich?
- Reicht Cloudflare Free für den Pilot? Workers Paid (mindestens 5 USD pro Monat) erst aktivieren, falls Free-Grenzen oder ein konkreter Betriebsbedarf es erforderlich machen. Eigene Domain ebenfalls erst dann wählen, wenn sie gebraucht wird.
- Welcher endgültige App-Name und welche Lizenz passen zum Projekt?
- Nach dem Pilot: Ist eine sichtbare oder teilbare Fortschrittskarte den Aufwand und die Datenschutzprüfung wert?

Für die Anbieterbewertung wird ein aktiver Dienst für den Produktbetrieb ausgewählt. Vor dem Versand echter Fotos müssen die Verarbeitung und Aufbewahrung beim ausgewählten Dienst geprüft und verständlich erklärt werden. Öffentliche Bildspeicherung ist keine Produktfunktion.

## Bereits recherchiert

Für „noch vorhanden“ ist `check_date` laut OSM-Dokumentation geeignet. Die Anwendung bestätigt damit keine Gerätewartung und verändert keine anderen Eigenschaften. Für die technische Arbeit liegt ein [Plan mit überprüfbaren Etappen](umsetzungsplan.md) vor. Das [Repository](https://github.com/FrnkMrz/AEDjaeger) ist zunächst privat.
