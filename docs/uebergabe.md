# AEDjaeger – Übergabe an den nächsten Agenten

Stand: **10. November 2026, abends** (nach PR #54)  
Repository: [FrnkMrz/AEDjaeger](https://github.com/FrnkMrz/AEDjaeger)  
App: [aedjaeger.aedjaeger.workers.dev](https://aedjaeger.aedjaeger.workers.dev)

Dieses Dokument ist die kompakte, aktuelle Übergabe für einen neuen Chat oder einen anderen Coding-Agenten. Es fasst die in diesem Projekt getroffenen Produktentscheidungen, den tatsächlichen technischen Stand und den nächsten sinnvollen Schritt zusammen. Bei Widersprüchen haben die neueren Produktentscheidungen und die Dateien unter „Weiterlesen“ Vorrang vor älteren historischen Abschnitten.

## Ziel und gewünschter Ablauf

AEDjaeger soll vor Ort mit möglichst wenigen Schritten helfen, einen AED in OpenStreetMap zu erfassen oder einen bestehenden Eintrag zu bestätigen:

1. Mit OpenStreetMap anmelden. Ohne Anmeldung sind Foto und Arbeitsablauf gesperrt.
2. AED oder AED-Gehäuse fotografieren oder ein vorhandenes Foto auswählen.
3. Die Person bestätigt selbst, dass AED oder Gehäuse auf dem Foto sichtbar ist.
4. Die App verwendet zuerst GPS aus dem Foto. Falls kein Foto-GPS vorhanden ist, darf sie Handy-GPS oder eine Kartenposition nur nach ausdrücklicher Auswahl der Person nutzen.
5. AEDs in der Nähe abgleichen.
6. Bei einem eindeutig passenden vorhandenen AED nur dessen Vorhandensein mit `check_date` bestätigen. Bei keinem passenden Treffer nach erfolgreicher, vollständiger Suche eine Neuanlage vorbereiten.
7. Vor jeder OSM-Änderung die konkrete Änderung zeigen und ausdrücklich bestätigen lassen.

Die Karte ist Hilfsmittel für die Standortkorrektur, nicht der Startbildschirm. Die App soll nur Fragen stellen, die für Zuordnung oder korrekte OSM-Daten nötig sind.

## Beschlossene Produkt- und Sicherheitsregeln

- Produktname in allen Sprachen: **AEDjaeger** (ohne Umlaute).
- Erste Sprachversionen: Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch.
- Fotoprüfung (Entscheidung vom 10.11.2026, ersetzt „ohne OpenAI“ vom 9.11.): optional per OpenAI, nur wenn der Betreiber sie für das Konto freigibt. Foto geht nach ausdrücklichem Tippen verkleinert und ohne EXIF/GPS raus. „Kein AED“ oder „nicht eindeutig“ sperrt den einfachen Weg („Anderes Foto“), mit Ausnahme nach zwei ausdrücklichen Bestätigungen; Ausfall, Limit oder Fehler fallen auf die Selbstbestätigung zurück. Ohne Freigabe bleibt alles lokal. Die App behauptet keine sichere Erkennung.
- Im Pilot bleibt Gamification unsichtbar. Intern dürfen nur erfolgreiche Prüfungen nach bestätigtem OSM-Vorgang gezählt werden.
- Oberfläche und API laufen als Cloudflare Worker mit Static Assets auf der vorhandenen `workers.dev`-Adresse; D1 hält notwendige Sitzungs- und Vorgangsdaten. Kein Paid-Tarif und keine eigene Domain ohne gesonderten Auftrag.
- OSM-Login ist erforderlich. Der aktuelle Login ist für die OSM-Entwicklungsumgebung (Dev) gedacht. Geheimnisse und OAuth-Tokens dürfen ausschließlich in serverseitigen Secrets bzw. verschlüsselter Sitzung liegen.
- `OSM_DEV_WRITES_ENABLED` bleibt **aus**. Es dürfen keine echten OSM-Schreibvorgänge ohne gesonderte Freigabe stattfinden. Normale Tests verwenden Mocks oder OSM Dev, niemals produktives OSM.
- Die Umgebungssuche ist fehlertolerant, aber fail-closed: Ein Timeout, eine veraltete Quelle oder eine unvollständige Abdeckung bedeutet „Suche fehlgeschlagen“, niemals „hier gibt es keinen AED“.
- Bei „noch vorhanden“ ausschließlich `check_date` ändern. Bei Neuanlage vor dem Schreiben die Gegend erneut prüfen und keine vorhandenen/fremden Tags überschreiben.

## Was aktuell tatsächlich läuft

Am 10. November 2026 wurden vier PRs gemergt. Jeder Merge deployt automatisch auf `workers.dev`.

| PR | Inhalt |
| --- | --- |
| [#51](https://github.com/FrnkMrz/AEDjaeger/pull/51) | Lesender Live-Check der Datenquelle (`npm run check:live-search`, Workflow „Live-Check AED-Datenquelle“), `docs/pilot-abnahme.md`, neutrale UI-Texte ohne „erkannt“ |
| [#52](https://github.com/FrnkMrz/AEDjaeger/pull/52) | Höchstalter der Archivdaten von 48 Stunden auf **5 Tage (120 Stunden)** erhöht |
| [#53](https://github.com/FrnkMrz/AEDjaeger/pull/53) | Umgebungskarte bei Treffern, zwei Bestätigungen für jede Neuanlage, gekürzte Texte, PWA-Symbol |
| [#54](https://github.com/FrnkMrz/AEDjaeger/pull/54) | Keine Datumsabfrage bei frischen Fotos, keine technischen Zeilen im Suchergebnis |

Belegt:

- Der Live-Check lief zweimal erfolgreich gegen echte Daten (GitHub-Actions-Läufe [42784569321](https://github.com/FrnkMrz/AEDjaeger/actions/runs/42784569321) und 42789878021): Metadaten gültig, HTTP-Range funktioniert, 28 Features in der Testkachel Nürnberg Hbf.
- Der Projektinhaber hat die App auf dem Handy bedient. Die Umgebungssuche lieferte dort einen echten Treffer („AED, ungefähr 2 m entfernt“, Standort aus dem Foto). Damit ist die mobile PMTiles-Suche grundsätzlich bestätigt.
- Lokal und in der CI: 205 Unit-Tests und 47 E2E-Tests bestanden (Stand PR #54).

Nicht belegt:

- Der Deploy für den Merge von PR #54 ([CI-Lauf 42853298091](https://github.com/FrnkMrz/AEDjaeger/actions/runs/42853298091)) lief beim Schreiben dieser Übergabe noch. Zuerst prüfen, ob er grün ist.
- Die Änderungen aus PR #53 und #54 hat noch niemand auf einem echten Handy gesehen. Der letzte Handy-Screenshot zeigte einen älteren, zwischengespeicherten Stand.
- OSM-Schreiben bleibt gesperrt (`OSM_DEV_WRITES_ENABLED` aus). Es gab keinen OSM-Schreibvorgang, weder auf dem Testserver noch produktiv.

## Entscheidungen des Projektinhabers vom 10. November 2026

- **Datenalter:** Archivdaten dürfen bis zu 5 Tage alt sein. Ältere Daten bleiben ein Suchfehler.
- **Neuanlage:** Jede Neuanlage braucht zwei getrennte, ausdrückliche Bestätigungen – sowohl nach einer Suche ohne Treffer als auch nach „keiner davon“. Erste: „Hier fehlt ein AED – neu eintragen“ bzw. „Keiner davon – neuen AED eintragen“. Zweite: Haken „vor Ort geprüft“ in der Vorschau; ohne ihn bleibt das Speichern gesperrt.
- **Karte:** Findet die Suche AEDs, zeigt die App eine Karte der Umgebung mit dem gesuchten Standort (rot) und nummerierten Markern.
- **Einfachheit geht vor:** So wenig Text wie möglich. Keine technischen Angaben („Log-Info“) auf dem Bildschirm, also kein Datenstand, keine Snapshot-Kennung, keine Kennungen wie `node/123`.
- **Datumsabfrage:** Bei einem gerade eben aufgenommenen Foto (höchstens 5 Minuten alt) entfällt die Abfrage des Beobachtungsdatums. Umsetzung: Die Regel ersetzt nur ein fehlendes Datum; nennt das Foto selbst einen anderen Tag als heute, bleibt die Abfrage. Bei „Foto auswählen“ ohne EXIF-Zeit zählt die Dateizeit nicht.
- **PWA-Symbol:** weißes Herz mit Blitz auf dem App-Grün (`public/aed-icon.svg`, PNGs in 192/512, maskable, `apple-touch-icon`).

## Bekannte offene Punkte

- Die Texte in Englisch, Polnisch, Japanisch, Französisch und Spanisch sind sachlich abgeglichen, aber nicht muttersprachlich geprüft.
- Startseite, Info-Dialog und Fehlermeldungen wurden nicht gekürzt. Der Projektinhaber hat offengelassen, ob weitere Bildschirme zu voll sind.
- Die Zeile „Standort aus dem Foto verwendet“ steht noch im Suchergebnis. Sie blieb bewusst, kann aber auf Wunsch entfallen.
- Die Übersichtskarte lädt Kacheln von `tile.openstreetmap.org`, sobald Treffer angezeigt werden.
- Die zweite Bestätigung für Neuanlagen wirkt nur im Browser; die Schreibroute des Testservers kennt den Haken nicht.
- Die Konstanten in `scripts/check-live-search.mjs` sind aus `server/osm/staticCandidateSearchRoute.ts` kopiert und müssen synchron bleiben.
- Für einen späteren Produktivbetrieb fehlt eine Absicherung gegen Dubletten bei bis zu 5 Tage alten Daten; auf dem Testserver prüft die Schreibroute den Kartenausschnitt vor einer Neuanlage erneut.
- Punkt B5 der Pilot-Abnahme (Live-Check an einer zweiten Koordinate) steht aus; der Workflow hat dafür noch keine Eingabefelder.
## Wie die Datenquelle funktioniert – und was sie nicht bedeutet

AEDjaeger fragt direkt das bestehende Archiv unter [pipeline.openfiremap.org/openfiremap.pmtiles](https://pipeline.openfiremap.org/openfiremap.pmtiles) ab. Der Worker lädt nicht die gesamte Datei: Er prüft frische Metadaten und liest nur die benötigten Zoom-14-Kacheln um den gewählten Standort per HTTP Range aus der Ebene `defibrillators`. Dabei werden Datenalter, Länderextrakte, Abdeckung und Antworten kontrolliert. Ein Fehler oder eine unvollständige Abdeckung sperrt die Suche bzw. Neuanlage.

Das ist eine **lesende Datenquelle**. AEDjaeger startet, betreibt oder verändert die OpenFireMap-Datenpipeline nicht. Diese App hat keine Verbindung zu Proxmox oder VM102; die gleichzeitige Arbeit an `pipeline.openfiremap.org` ist kein AEDjaeger-Deployment. Die AEDjaeger-Web-App wird separat über das GitHub-Repository `FrnkMrz/AEDjaeger` nach Cloudflare deployed.

OpenStreetMap Devs begrenzter `/api/0.6/map.json`-Endpunkt dient zusätzlich dazu, eine leere PMTiles-Suche für eine angemeldete Dev-Sitzung in einem kleinen Gebiet abzusichern. Das ist kein Overpass und ersetzt nicht die PMTiles-Kandidatensuche. In Produktion wird eine nicht sicher bestätigte leere Suche abgelehnt. Es gibt keinen Overpass-Fallback und keinen separaten AED-Feed.

**Bekannte Grenze:** AEDjaeger bleibt für Kandidaten auf die Verfügbarkeit, Aktualität und Abdeckung des PMTiles-Archivs angewiesen. Das vermeidet die Overpass-Abhängigkeit, garantiert aber keine erfolgreiche Suche, wenn das Archiv oder sein Host ausfällt. Ein Fehler muss sichtbar bleiben; nicht als leere Trefferliste behandeln.

## Was der Nutzer als Nächstes tun soll

1. App auf dem Handy ganz schließen und neu öffnen, damit der Service Worker den aktuellen Stand lädt. Für das neue Symbol die App vom Startbildschirm entfernen und neu installieren.
2. Abschnitt A der [Pilot-Abnahme](pilot-abnahme.md) durchgehen, mit Blick auf die neuen Punkte: Umgebungskarte bei Treffern, zwei Bestätigungen vor einer Neuanlage, keine Datumsabfrage direkt nach dem Fotografieren, keine technischen Zeilen im Suchergebnis, Textmenge.
3. Android und iPhone prüfen; bisher gibt es nur Rückmeldungen von einem Gerät.
4. Erst danach und nur mit ausdrücklicher Freigabe: kontrollierter OSM-Dev-Schreibtest nach Abschnitt C der Pilot-Abnahme. Den Schalter `OSM_DEV_WRITES_ENABLED` setzt der Projektinhaber selbst, nie ein Agent.
5. Wenn A bis C bestanden sind: Entscheidung über `v0.1.0`. Der Tag entsteht nur auf Auftrag und nur auf einem gemergten `main`-Commit.

Bei einem Fehler Zeitpunkt, genaue Meldung und einen Screenshot notieren. Keine Tokens oder Schlüssel teilen.
## Arbeitsanweisung für den nächsten Agenten

- Beginne mit dem **aktuellen `main`** und lies zuerst `AGENTS.md`, dann [Pilot-Abnahme](pilot-abnahme.md), [offene Fragen](offene-fragen.md), [Architektur](architektur.md), [Konzept](konzept.md), [OSM-Datenzugriff](osm.md) und [Umsetzungsplan](umsetzungsplan.md).
- Prüfe zuerst den GitHub-Actions-Stand auf `main` (CI und Deploy), bevor du einen Fehler als aktuell annimmst.
- Der Projektinhaber gibt Rückmeldungen direkt aus dem Handytest, oft knapp und mit Screenshot. Ist eine Anmerkung mehrdeutig, frage einmal gezielt nach, statt zu raten.
- Arbeitsweise, die sich bewährt hat: kleine Änderung → alle Prüfungen lokal → Commit auf dem Arbeitsbranch → Projektinhaber fragen → PR gegen `main` mit den sechs Abschnitten aus `AGENTS.md` → PR beobachten und Befunde des Codex-Review-Bots prüfen und beheben. Der Bot prüft nur beim Öffnen eines PRs oder nach dem Kommentar `@codex review`. Mergen, Tags und Releases bleiben beim Projektinhaber.
- Nach einem Merge den Arbeitsbranch frisch von `main` neu aufsetzen; nie auf gemergter Historie weiterarbeiten. Nie direkt auf `main` pushen.
- Prüfbefehle: `npm test`, `npm run build`, `npm run worker:check`, `npm run test:worker-http`, `npm run test:e2e`. Tests, die Dateien mit Node lesen, sind `.mjs`-Dateien, weil die Typprüfung keine Node-Typen kennt.
- UI-Texte stehen in `src/i18n/translations.ts` (Start, Info, Demo) und `src/i18n/flowTranslations.ts` (Foto- und Suchablauf). Jede Änderung gilt für alle sechs Sprachen; `tests/translations.test.ts` listet die Schlüssel.
- Neuen Code ausführlich auf Deutsch kommentieren, so dass ein Einsteiger die Logik versteht; bestehende Kommentare erhalten.
- Halte `CHANGELOG.md` und `docs/offene-fragen.md` aktuell.
- Keine neuen Pipeline-/VM-Aufgaben, keine Tests gegen die echte OpenAI-API, keine weiteren Anbieter-APIs, keine kostenpflichtigen Aufrufe außerhalb der freigegebenen Limits, keine Secrets, keine OSM-Schreibvorgänge ohne ausdrücklichen Auftrag. Produktions-OSM bleibt tabu.
## Weiterlesen

- [Produktkonzept](konzept.md)
- [Architektur und Betrieb](architektur.md)
- [OSM-Datenmodell und Datenzugriff](osm.md)
- [Umsetzungsplan](umsetzungsplan.md)
- [Offene Fragen und nächste Schritte](offene-fragen.md)
- [Changelog](../CHANGELOG.md)
- [CI/Deploy-Workflow](../.github/workflows/ci.yml)
