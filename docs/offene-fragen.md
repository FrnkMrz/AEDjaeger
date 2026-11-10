# Entscheidungen und nächste Schritte

Stand: **10.11.2026**. Der aktuelle nächste Schritt ist ein echter, lesender Handytest des nach PR #49 deployten AED-Abgleichs. Diese Liste ersetzt ältere Statusangaben in diesem Dokument; frühere Einträge bleiben nur als historische Begründung erhalten.

## Neu vorbereitet (10.11.2026)

- Die Abnahme ist in [Pilot-Abnahme](pilot-abnahme.md) beschrieben: Handytest, Live-Check, kontrollierter OSM-Dev-Schreibtest, Rückweg und Kriterien für `v0.1.0`.
- Der Live-Check der Datenquelle (`npm run check:live-search` bzw. der manuelle Workflow „Live-Check AED-Datenquelle“) lief am 10.11.2026 zweimal erfolgreich auf GitHub ([Lauf #2](https://github.com/FrnkMrz/AEDjaeger/actions/runs/42789878021): Datenstand 36 Stunden alt, 28 Features in der Testkachel bei Nürnberg). B1 bis B4 der Pilot-Abnahme sind bestanden. Ein früherer Versuch aus der Agentenumgebung scheiterte bei der Namensauflösung des Datenhosts (`ENOTFOUND`); das lag an deren Netzwerk und sagt nichts über die Verfügbarkeit des Datenhosts.
- Offen bleiben: B5 (Live-Check mit einer zweiten Koordinate), Handytest auf Android und iPhone, Freigabe für einen Dev-Schreibtest und die Entscheidung über `v0.1.0`.

## Aktueller Stand

- PR [#49](https://github.com/FrnkMrz/AEDjaeger/pull/49) zur Suche im OpenFireMap-PMTiles-Archiv ist am 9.11.2026 gemergt.
- GitHub Actions [Lauf #234](https://github.com/FrnkMrz/AEDjaeger/actions/runs/42672639423) war erfolgreich; CI und Cloudflare-Deploy sind grün. Der jüngste Lauf auf `main` ist CI [#248](https://github.com/FrnkMrz/AEDjaeger/actions/runs/42853298091) (PR #54, Commit `b322116`); `validate` und `deploy` sind grün.
- App-Adresse: [aedjaeger.aedjaeger.workers.dev](https://aedjaeger.aedjaeger.workers.dev).
- Auf einem echten Handy ist nach diesem Deploy noch kein erfolgreicher Live-Abgleich bestätigt.
- OSM-Schreibzugriffe bleiben mit `OSM_DEV_WRITES_ENABLED` abgeschaltet. Es fand kein produktiver OSM-Schreibvorgang statt.

## Stand nach PR #54 (10.11.2026, abends)

- Gemergt und deployt: PR #51 bis #54. Einzelheiten, Entscheidungen und offene Punkte stehen in der [Übergabe](uebergabe.md).
- Der Live-Check der Datenquelle lief zweimal erfolgreich gegen echte Daten; der Abschnitt „Neu vorbereitet“ oben nennt die Einzelwerte (B1 bis B4 bestanden, B5 offen).
- Die Umgebungssuche lieferte auf dem Handy des Projektinhabers einen echten Treffer.
- Offen: erneuter Handytest der Änderungen aus PR #53 und #54 auf Android und iPhone, danach Entscheidung über den OSM-Dev-Schreibtest und `v0.1.0`.

## Rückmeldung aus dem ersten Handytest (10.11.2026)

- Umgesetzt: Umgebungskarte bei Treffern, zwei getrennte Bestätigungen für jede Neuanlage, deutlich kürzere Texte im Foto- und Suchablauf.
- Entscheidung: Eine Neuanlage braucht in beiden Fällen (Suche ohne Treffer und „keiner davon“) zwei ausdrückliche Bestätigungen.
- Offen: erneuter Handytest dieser Änderungen; die gekürzten Texte in Englisch, Polnisch, Japanisch, Französisch und Spanisch sind nicht muttersprachlich geprüft.

## Als Nächstes: Handytest

1. App auf dem Handy öffnen und am OSM-Testserver anmelden.
2. Ein echtes Foto auswählen, dessen EXIF GPS-Koordinaten enthält.
3. Selbst bestätigen, dass AED oder AED-Gehäuse zu sehen ist.
4. Umgebungssuche starten und prüfen, dass „Standort aus dem Foto verwendet“ angezeigt wird.
5. Ergebnis notieren: passende AED-Kandidaten, erfolgreich bestätigte leere Suche oder konkrete Fehlermeldung. Noch nicht versuchen, OSM zu ändern.

Falls ein Fehler auftritt, notiere ungefähre Uhrzeit, genaue Meldung und den angezeigten Standort-Hinweis. Keine Zugangsdaten, Tokens oder Schlüssel teilen.

## Danach – nur wenn die Suche funktioniert

- Gefundene Kandidaten korrekt und verständlich darstellen; eindeutigen Treffer, mehrere nahe Treffer und „keiner davon“ prüfen.
- Bei vollständiger Suche Standort auf der Karte prüfen und eine Neuanlage nur als Vorschau vorbereiten.
- OSM-Dev-Update (nur `check_date`) sowie Neuanlage Ende-zu-Ende prüfen. Erst dafür ist eine gesonderte ausdrückliche Freigabe nötig, um den Dev-Schreibschalter vorübergehend einzuschalten.
- Produktions-OSM bleibt außerhalb von Tests.

## Datenquelle und Grenzen

AEDjaeger lädt nicht das ganze PMTiles-Archiv herunter. Der Worker prüft Metadaten und liest die erforderlichen Zoom-14-Kacheln der Ebene `defibrillators` am bestätigten Standort mit begrenzten HTTP-Range-Anfragen. Fehlende/alte Metadaten, unvollständige Extrakte, fehlende Range-Unterstützung, nicht abgedeckte Suchbereiche und Upstream-Fehler sind Suchfehler, keine leere Ergebnisliste.

Für eine leere Suche im OSM-Dev-Test bestätigt ein begrenzter, authentifizierter `/api/0.6/map.json`-Abruf den kleinen Ausschnitt zusätzlich. Dieser feste OSM-Dev-Aufruf ist nicht Overpass und wird nicht verwendet, um Kandidaten aus der gesamten Umgebung zu sammeln. Es gibt keinen Overpass-Fallback und keinen separaten AED-Feed. Die PMTiles-Datei wird unter `pipeline.openfiremap.org` nur gelesen; AEDjaeger startet oder betreibt die Datenpipeline nicht und ist nicht mit Proxmox/VM102 verbunden. Die App hängt dennoch von Verfügbarkeit und Aktualität dieses Archivs ab.

## Festgelegte Produktentscheidungen

- Fotoaufnahme und Einfachheit stehen im Mittelpunkt: Foto → Sichtbarkeit selbst bestätigen → Umgebung abgleichen → vorhandenen AED prüfen oder neuen vorbereiten → Änderung ausdrücklich bestätigen.
- Anmeldung mit OpenStreetMap ist Voraussetzung für alle Arbeitsfunktionen.
- Foto/EXIF bleiben lokal; Foto-GPS hat Vorrang. Handy-GPS oder Kartenposition nur nach bewusster Auswahl.
- Pilot ohne OpenAI oder andere externe Bilddienste und ohne automatische Bilderkennung.
- Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch.
- Gamification bleibt im Pilot unsichtbar; keine öffentliche Teil- oder Ranglistenfunktion.
- Cloudflare Workers Free und bestehende workers.dev-Adresse; keine zusätzlichen Kosten oder Domain ohne Auftrag.
- `check_date` ist das Prüfdatum. Bei einem vorhandenen AED dürfen andere Tags nicht überschrieben werden.

## Weiterführende Unterlagen

- [Übergabe für neuen Chat oder Agenten](uebergabe.md)
- [Architektur und Betrieb](architektur.md)
- [OSM-Datenmodell und Datenzugriff](osm.md)
- [Umsetzungsplan](umsetzungsplan.md)
- [Changelog](../CHANGELOG.md)
