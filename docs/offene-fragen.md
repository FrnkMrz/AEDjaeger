# Entscheidungen und nächste Schritte

Stand: **10.11.2026**. Der aktuelle nächste Schritt ist ein echter, lesender Handytest des nach PR #49 deployten AED-Abgleichs. Diese Liste ersetzt ältere Statusangaben in diesem Dokument; frühere Einträge bleiben nur als historische Begründung erhalten.

## Update-Hinweis für die PWA (10.11.2026)

Die App zeigt „Neue Version verfügbar – Neu laden“, sobald `/version.json` eine andere Revision nennt als die laufende App. Automatisch getestet sind die Erkennung, der Service Worker und die Sperre beim Speichern (Unit- und E2E-Tests). Außerdem lief ein echter Ablauf mit zwei Builds und echtem Service Worker in dieser Umgebung durch. **Offen:** ein Test auf einem echten Handy (Abschnitt A14 und A15 der [Pilot-Abnahme](pilot-abnahme.md)). Bekannte Grenze: Handys, die noch eine Version vor diesem Update-Hinweis laufen haben, bekommen das Banner erst, nachdem sie einmal neu gestartet haben und diese Version geladen ist.

## Fotoprüfung per OpenAI (Entscheidung vom 10.11.2026)

**Anlass:** Im Handytest ließ sich ein Screenshot mit Karnevalsbildern nach „AED oder Gehäuse gesehen – weiter“ in den Ablauf bringen. Die reine Selbstbestätigung hielt falsche Fotos nicht auf.

**Entscheidung des Projektinhabers:** Die Fotoprüfung per OpenAI wird wieder eingebaut (die Anbindung war am 9.11.2026 mit PR #47 entfernt worden). Festgelegt: Bei „kein AED“ oder „nicht eindeutig“ ist der Weg gesperrt („Anderes Foto“). Bei Ausfall, Limit oder Fehler gilt der Rückfall auf die Selbstbestätigung. Vor dem Upload entfernt der Browser EXIF und GPS und verkleinert das Bild; ein Hinweis nennt OpenAI vor dem Tippen. `AGENTS.md` und die Docs sind angepasst.

**Umgesetzt:** Der alte Server-Teil (Route, OpenAI-Client, Budget in D1) kam aus der Historie zurück (Commit `314abdc`), der Sitzungsstatus meldet `photoCheckAvailable`, und der Browser bietet die Prüfung nur dann an. E2E-Tests mocken den Server; kein Test ruft OpenAI auf.

### Betreiber-Einrichtung der Fotoprüfung

Die Prüfung bleibt aus, bis alle Punkte im Cloudflare-Dashboard (Worker `aedjaeger`) gesetzt sind. Fehlt einer, bleibt der bisherige Ablauf unverändert.

| Name | Art | Bedeutung |
| --- | --- | --- |
| `OPENAI_API_KEY` | Secret | Schlüssel für die OpenAI API; nie in Chat, Code oder Logs |
| `AI_ANALYSIS_ENABLED` | Variable | `true` schaltet die Prüfung ein |
| `AI_ANALYSIS_ALLOWED_OSM_SUBJECTS` | Variable | erlaubte Konten, kommagetrennt, höchstens 100, Format `development:<Kennung>` oder `production:<Kennung>` |
| `AI_ANALYSIS_COST_RESERVATION_MICROS` | Variable | reservierte Kosten je Prüfung in Millionstel US-Dollar (20000 = 0,02 US-Dollar) |
| `AI_ANALYSIS_USER_DAILY_LIMIT_MICROS` | Variable | Tageslimit je Konto (z. B. 200000 = 0,20 US-Dollar) |
| `AI_ANALYSIS_GLOBAL_DAILY_LIMIT_MICROS` | Variable | Tageslimit insgesamt (z. B. 1000000 = 1 US-Dollar) |

Beispielwerte sind Vorschläge, keine geprüften Vorgaben. Die Reservierung muss kleiner oder gleich beiden Limits sein, sonst bleibt die Prüfung aus.

### Fehlercodes der Fotoprüfung lesen

Scheitert die Prüfung, zeigt die App unter „Die Prüfung ist gerade nicht möglich“ eine kleine Zeile „Fehlercode: …“ und bietet die Selbstbestätigung an. Derselbe Code steht im Betriebsprotokoll des Workers (Cloudflare-Dashboard, Worker `aedjaeger`, Logs; Ereignis `vision_analysis_failed`). Er enthält nur feste Kennungen und Statuszahlen, nie Fehlertexte, Fotos, Schlüssel oder Konten.

| Code (Beispiel) | Bedeutung | Maßnahme |
| --- | --- | --- |
| `analysis_budget_unavailable (HTTP 503, missing_table)` | Die Budget-Tabelle fehlt in D1 | Migrationen `0001` und `0002` anwenden (`npx wrangler d1 migrations apply aedjaeger-pilot --remote`, vorher mit `migrations list` prüfen) |
| `analysis_budget_unavailable (HTTP 503, storage_error)` | D1 antwortet mit einem anderen Fehler | Cloudflare-Status und Logs prüfen |
| `analysis_budget_exceeded (HTTP 429)` | Tages- oder Kontolimit erreicht | Limit prüfen oder bis zum nächsten UTC-Tag warten |
| `analysis_not_allowed (HTTP 403)` | Konto steht nicht in `AI_ANALYSIS_ALLOWED_OSM_SUBJECTS` | Eintrag im Format `development:<Kennung>` bzw. `production:<Kennung>` prüfen |
| `analysis_failed (HTTP 502, OpenAI 401, invalid_api_key)` | OpenAI lehnt den Schlüssel ab | Schlüssel erneuern und als Secret setzen |
| `analysis_failed (HTTP 502, OpenAI 404, model_not_found)` | Modellname gibt es nicht (mehr) | Modell in `src/contracts/visionObservation.ts` prüfen |
| `analysis_failed (HTTP 502, OpenAI 429, insufficient_quota)` | OpenAI-Guthaben oder Limit erschöpft | Abrechnung und Ausgabenlimit bei OpenAI prüfen |
| `analysis_failed (HTTP 502, timeout)` | OpenAI antwortete nicht innerhalb von 25 Sekunden | Später erneut versuchen |
| `analysis_failed (HTTP 502, incomplete_…)`, `no_output`, `invalid_json`, `schema_mismatch` | OpenAI antwortete, aber mit unbrauchbarem Inhalt | Meldung an den Entwickler mit dem genauen Code |
| `invalid_response (HTTP 500)` oder `(HTTP 503)` | Keine JSON-Antwort: der Worker ist abgestürzt oder hat ein Limit überschritten, zum Beispiel die CPU-Zeit im Workers-Free-Tarif | Worker-Logs prüfen; ist es die CPU-Zeit, den Server-Weg des Fotos schlanker machen oder den Tarif neu bewerten (Entscheidung des Projektinhabers) |
| `invalid_response (model_mismatch:…)` | Server und App kennen verschiedene Modellnamen | Beide Seiten nutzen `VISION_MODEL`; nach einem Teil-Deploy erneut laden |
| `analysis_failed (client_network)` / `(client_timeout)` | Verbindung zum Worker abgebrochen bzw. 35 Sekunden überschritten | Netz prüfen und erneut versuchen |
| `image_processing_failed`, `image_too_large`, `invalid_image` | Das Foto ließ sich im Browser nicht verkleinern oder ist zu groß | Anderes Foto wählen |

Vor dem ersten Einsatz zu klären (vom Projektinhaber):

1. **D1-Tabelle:** Die Budget-Tabelle kommt aus den Migrationen `0001_analysis_budget.sql` und `0002_analysis_provider_started.sql`. Der Deploy führt keine Migrationen aus; ob sie auf der echten Datenbank liegen, ist nicht belegt. Prüfen mit `npx wrangler d1 migrations list aedjaeger-pilot --remote`. Fehlt die Tabelle, bietet die App die Prüfung an, fällt aber bei jedem Versuch auf die Selbstbestätigung zurück.
2. **Modell:** Der Code verwendet `gpt-6-luna` (Festlegung aus `docs/architektur.md`). Ob die OpenAI API dieses Modell heute noch unter diesem Namen anbietet, ist in dieser Umgebung nicht geprüft.
3. **Schlüssel und Konto:** Der alte Schlüssel kann inzwischen gedreht oder gelöscht sein. Ausgabenlimit im OpenAI-Konto setzen.
4. **Datenschutzhinweis:** Der Hinweis in der App nennt OpenAI als Empfänger. Ob zusätzlich ein Eintrag in einer Datenschutzerklärung nötig ist, hängt von der Veröffentlichung ab und ist offen.
5. **Trefferqualität:** Wie oft die Prüfung echte AED-Fotos sperrt, ist unbekannt. Abschnitt F der [Pilot-Abnahme](pilot-abnahme.md) beschreibt die Stichprobe.

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
- Fotoprüfung per OpenAI, optional und nur bei Betreiber-Freigabe (Entscheidung vom 10.11.2026, ersetzt „ohne OpenAI“). Ohne Freigabe bleibt das Foto lokal und die Person bestätigt selbst.
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
