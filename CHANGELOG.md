# Changelog

Alle relevanten Änderungen an AEDjaeger werden hier nachvollziehbar festgehalten. Das Format folgt den Grundideen von [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) und verwendet Versionen im Format `MAJOR.MINOR.PATCH`.

## [Unreleased]

> Die jüngsten Einträge am Anfang beschreiben den aktuellen Pilotstand. Ältere Einträge darunter dokumentieren frühere, inzwischen teilweise abgelöste Zwischenstände und sind keine Beschreibung des aktuellen Laufzeitverhaltens.

### Changed
- Legt den Detailweg für AED-Angaben fest (nur Entscheidung und Dokumentation, noch keine Programmänderung): Neben „Noch da – bestätigen“ soll die App Standortbeschreibung, Zugang, Zeiten, drinnen/draußen, Ebene und optionale Zusatzangaben erfassen, bei Neuanlagen und bei bestehenden AEDs. Die Regel in `AGENTS.md`, die bisher bei „noch vorhanden“ nur das Prüfdatum erlaubte, ist dafür enger neu gefasst: nur Schlüssel einer festen Liste, Anzeige `alt → neu`, Neulesen vor dem Schreiben, kein Löschen, kein Zugangscode. Korrekturen bestehender Werte bleiben hinter einem eigenen Betreiber-Schalter (Standard aus). Die Etappen P1 bis P6 stehen in `docs/umsetzungsplan.md`.

### Added
- Fragt nach dem ersten Anmelden **einmal pro Gerät** nach der Standort-Erlaubnis (Systemdialog des Browsers) und nutzt den Handy-Standort danach ohne Zwischenfrage, wenn bei einem **gerade eben mit der Kamera der App aufgenommenen** Foto (höchstens 5 Minuten alt) die Ortsangabe fehlt. Das Alter wird bei jeder Fortsetzung neu geprüft, nicht nur bei der Aufnahme, und auch beim Wiederholen einer fehlgeschlagenen Suche: Wer die App nach dem Foto länger liegen lässt, bekommt die Standortwahl. Ein ausdrücklich gewählter Handy-Standort wird beim Wiederholen wie bisher neu geholt. Anlass: Safari auf dem iPhone liefert Kamerafotos aus dem Browser oft ohne GPS, und die App fragte jedes Mal nach. Die Anzeige nennt „Handy-Standort verwendet“. Bei Galerie-Fotos, älteren Aufnahmen und fehlender Erlaubnis bleibt die ausdrückliche Wahl. Die bei der einmaligen Anfrage ermittelte Position wird sofort verworfen; ein Merker im Browser-Speicher verhindert eine zweite Anfrage. Foto-GPS hat weiter Vorrang.
- Ergänzt einen Ausnahmeweg bei „Kein AED erkennbar“ und „Nicht eindeutig“: Weil die Prüfung auch irren kann, führen zwei ausdrückliche Bestätigungen („Trotzdem: Hier ist ein AED“, dann „Ja, AED oder Gehäuse ist zu sehen – weiter“) in den normalen Ablauf mit Datum, Standort und den eigenen zwei Bestätigungen für Neuanlagen. „Anderes Foto“ bleibt der Standardweg und die einfache Selbstbestätigung entfällt weiter. Texte in allen sechs Sprachen.
- Zeigt bei einer gescheiterten Fotoprüfung einen kurzen Fehlercode („Fehlercode: analysis_failed (HTTP 502, OpenAI 401, invalid_api_key)“) und schreibt ihn ins Betriebsprotokoll des Workers (`vision_analysis_failed`). Bisher stand dort nur „Die Prüfung ist gerade nicht möglich“, ohne Hinweis auf die Ursache. Übernommen werden nur feste Kennungen und Statuszahlen (Fehlercode des Anbieters, HTTP-Status, „timeout“, „missing_table“ …), nie Fehlertexte, Fotos, Schlüssel oder Konten. Die Tabelle der Codes mit Maßnahmen steht in `docs/offene-fragen.md`.
- Ergänzt einen Update-Hinweis für die PWA: Die laufende App erkennt über die neue Datei `/version.json`, dass eine neuere Version veröffentlicht wurde, und zeigt oben ein Banner „Neue Version verfügbar – Neu laden“ in allen sechs Sprachen. Sie fragt beim Start, beim Zurückkehren in die App, bei wiederhergestellter Verbindung und alle 30 Minuten nach. Neu geladen wird nie automatisch, weil das das aktuelle Foto und den Entwurf verwirft; das Banner nennt diesen Verlust. Beim Speichern (auch bei unklarem Ergebnis), beim Foto-Prüfen und bei offener Wiederherstellung bleibt der Knopf gesperrt. Der Service Worker legt `/version.json` nicht in den Cache. Fehler bei der Abfrage erzeugen nie einen falschen Hinweis.
- Ergänzt eine optionale Fotoprüfung per OpenAI. Ist sie für das Konto freigegeben, ersetzt „AED gesehen – Foto prüfen“ die reine Selbstbestätigung: Der Browser verkleinert das Foto, kodiert es ohne EXIF/GPS neu und sendet es nach ausdrücklichem Tippen an den Worker, der Budget in D1 reserviert und erst dann OpenAI aufruft. Bei „kein AED“ oder „nicht eindeutig“ ist der Weg gesperrt; bei Ausfall, Limit oder fehlerhafter Antwort gilt der Rückfall auf die Selbstbestätigung. Texte in allen sechs Sprachen. Die Prüfung bleibt aus, bis der Betreiber `OPENAI_API_KEY`, `AI_ANALYSIS_ENABLED`, Zulassungsliste und Kostenlimits setzt (siehe `docs/offene-fragen.md`). Ob die Budget-Tabelle in D1 angelegt ist, ist nicht belegt.
- Meldet im Sitzungsstatus `photoCheckAvailable`, wenn die Fotoprüfung für das Konto aktiv ist. Das Feld fehlt sonst; Schlüssel, Limits und Zulassungsliste erscheinen nie in der Antwort.
- Ergänzt ein App-Symbol für die installierte PWA: weißes Herz mit Blitz auf dem Grün der App, als PNG in 192 und 512 Pixeln, als eigene „maskable“-Variante für Android und als `apple-touch-icon` für iPhone und iPad.
- Zeigt bei Treffern der Umgebungssuche eine Karte der Umgebung: roter Punkt für den gesuchten Standort, nummerierte Marker für die gefundenen AED-Einträge. Die Nummern stimmen mit der Trefferliste überein; beim Setzen eines neuen AED-Punkts bleiben die Marker sichtbar.
- Ergänzt einen lesenden Live-Check der AED-Datenquelle (`npm run check:live-search` und manueller GitHub-Workflow). Er prüft Metadaten, Datenalter, HTTP-Range und die Ebene `defibrillators` an einer Testkoordinate. Er lief am 10.11.2026 zweimal erfolgreich (Datenstand 36 Stunden alt, 28 Features in der Testkachel bei Nürnberg); eine zweite Koordinate (B5) ist noch offen.
- Ergänzt die Pilot-Abnahme mit Checklisten für Handytest, Live-Check, kontrollierten OSM-Dev-Schreibtest, Rückweg und Kriterien für `v0.1.0`.
- Ergänzt eine aktuelle, vollständige Übergabe mit Produktentscheidungen, Datenquelle, Deploy-Stand, Sicherheitsgrenzen und konkretem nächstem Handytest.
- Liest AED-Kandidaten direkt aus der `defibrillators`-Ebene des OpenFireMap-PMTiles-Archivs. Der Worker prüft den Datenstand und liest für den Foto-Standort nur die benötigten Zoom-14-Kacheln über begrenzte HTTP-Range-Anfragen.
- Verwendet kein Overpass für die Umgebungssuche. Fehlende, veraltete, unvollständige oder ungültige Archivdaten bleiben ein Suchfehler und werden nie als Beleg für einen freien Standort behandelt.

### Added
- Spielt nach einem vom Server bestätigten Speichern auf dem Testserver einen kurzen „Ka-Ching“-Ton. Er wird im Browser erzeugt (keine Tondatei), klingt nur bei bestätigtem Erfolg (nicht bei Vorschau, Senden, Konflikt oder „Ergebnis unklar“) und lässt sich im Info-Dialog ausschalten („Ton, wenn das Speichern gelingt“; Standard: an). Der Ton wird beim Tippen auf „Speichern“ freigeschaltet, weil Safari auf dem iPhone Ton sonst nicht erlaubt. Bei stumm geschaltetem iPhone bleibt es still.
- Zeigt die Version ganz klein in der Fußzeile jedes Bildschirms („Version <Nummer> · <Datum, Uhrzeit>“, markierbar), auch auf der Anmeldeseite. Dieselbe Zeile steht im Info-Dialog.
- Zeigt im Info-Dialog ganz unten die Version der laufenden App: „Version <Nummer> · <Datum, Uhrzeit>“ in der Sprache der App. Die Nummer ist die Build-Revision, das Datum die daraus zurückgerechnete Build-Zeit. Zum Prüfen vergleicht man die Nummer mit der veröffentlichten Revision unter `/version.json`; sind beide gleich, läuft die neueste Version.
- Ergänzt die Vorbereitung des OSM-Dev-Schreibtests in `docs/pilot-abnahme.md` (Abschnitt C0): Dev-Konto und OAuth-Anwendung, Worker-Einstellungen, Migrationen `0006` bis `0009`, Wahl des Testorts, geänderte Reihenfolge (zuerst Neuanlage, dann `check_date`, mit späterem Beobachtungsdatum für `check_date`) und eine Vorlage für den Abnahmebericht. Es wird nichts geschrieben; `OSM_DEV_WRITES_ENABLED` bleibt aus.

### Changed
- Hält fest, dass `aedjaeger.de` seit dem 13.11.2026 bei united domains für 12 Monate gesichert ist, und legt den Umzug in `docs/domain.md` fest (Cloudflare-Zone im Free-Tarif, Custom Domain am Worker, OSM-Dev-Redirect-URI, Prüfung, Aufräumen). Reine Dokumentation: Code, Deploy-Ziel und Anmeldung bleiben bis zum Umzug unverändert auf `workers.dev`.
- Entfernt das Häkchen-Symbol vor dem Namen in der Kopfzeile: Es zeigte dasselbe wie die grüne Lampe. Die Lampe bleibt als einziger Statusanzeiger.
- Die Lampe ist jetzt eine Schaltfläche mit größerer Tippfläche. Grün: öffnet den Abschnitt mit „Abmelden“ im Info-Dialog (abgemeldet wird erst mit „Abmelden“). Rot: zeigt die Anmeldeseite und setzt den Fokus auf den Anmelde-Knopf; die Lampe meldet nie von selbst an, die Anmeldung braucht immer das ausdrückliche Tippen auf den Knopf. Fehlt dieser (Prüfung läuft, Verbindungsfehler), bekommt der passende andere Knopf oder die Überschrift den Fokus.

### Fixed
- Steht das Prüfdatum schon so auf dem Testserver-Knoten, schreibt der Server bewusst nichts. Die App meldete das trotzdem als „Vor-Ort-Prüfung gespeichert“ und spielte den Ton. Jetzt steht „Schon aktuell. Es wurde nichts geändert.“ da (sechs Sprachen), es gibt keinen Ton und keinen zweiten Speichern-Knopf. Ein echter Schreibvorgang meldet weiter „gespeichert“ und klingt.
- Ein AED ohne Namen und ohne Ortsangabe zeigt in der Änderungsvorschau „AED (ohne Namen)“ in der gewählten Sprache statt der technischen Kennung `node/…`.
- Die App startet auch dann, wenn der Browser den Zugriff auf seinen Speicher sperrt (zum Beispiel bei „alle Cookies blockieren“). Bisher stürzte die Seite beim Lesen der gemerkten Sprache ab. Der Sprachwechsel greift außerdem für die offene Seite, wenn sich die Wahl nicht speichern lässt. Neu: `src/storage/safeStorage.ts`. Der Speichervorgang auf dem Testserver bleibt streng: Lässt sich der offene Vorgang nicht sichern, wird nicht gesendet.
- Der Schreibtest auf dem OSM-Testserver blieb nach einer erfolgreichen Anlage bei „Ergebnis unklar“, obwohl der Knoten angelegt und der Änderungssatz geschlossen war. Ursache war, dass der Status des Änderungssatzes nur als XML gelesen wurde; der Testserver liefert ihn auf unsere Anfrage als JSON. Jetzt versteht die Prüfung JSON und XML. Zusätzlich toleriert die Auswertung der Antwort „diffResult“ beim Anlegen und beim Datum-Aktualisieren die XML-Kopfzeile, mit der echte OSM-Antworten beginnen. Eine geschlossene oder offene Nummer, die nicht passt, gilt weiter als nicht bestätigt.
- „Abmelden“ zeigt nie still wieder „angemeldet“: Meldet der Server nach der Abmeldung noch eine Sitzung, erscheint die Fehlermeldung mit dem Wiederholen-Knopf, die Lampe bleibt rot, und die Arbeitsfunktionen bleiben gesperrt.
- Die rote Lampe startete die Anmeldung selbst. Wer bei OpenStreetMap noch angemeldet war, kam damit ohne Eingabe zurück in die App. Sie zeigt jetzt nur noch die Anmeldeseite.
- Hält die Kopfzeile (Name, Verbindungslampe, Info) auf dem iPhone unterhalb von Uhr und Dynamic Island. Bisher lag sie in der installierten App darunter und war unsichtbar; ein e2e-Test prüft den Abstand. Der Update-Hinweis berücksichtigt den Abstand ebenfalls.

### Removed
- Entfernt die externe OpenAI-Bildanalyse samt Anbieter-, Budget- und Browsercode. Der alte Analyse-Endpunkt antwortet aus Kompatibilitätsgründen mit HTTP 410, ohne den Request-Body zu lesen. Überholt am 10.11.2026: Die Fotoprüfung kehrt als optionale Funktion zurück (siehe „Added“), und `/api/vision/analyze` antwortet wieder entsprechend der Betreiber-Konfiguration statt mit HTTP 410.

### Removed
- Entfernt alle Verweise „In OpenStreetMap ansehen“ bzw. „Position auf OpenStreetMap ansehen“ aus der Trefferliste, der Bestätigungsseite, der Vorschau für neue AEDs und der Wiederherstellungsseite. Der Ablauf bleibt in der App.
- Entfernt den Textblock „Mit OSM-Testserver verbunden … Abmelden“ vom Hauptbildschirm, solange man angemeldet ist.

### Changed
- Verkürzt die Bestätigungsseite für einen vorhandenen AED: Es stehen nur noch die Bezeichnung und „Prüfdatum: …“ da. „Einzige vorgeschlagene Änderung“, „Ausgewählter AED:“ und „Bisher: nicht gesetzt“ entfallen; ein bisheriges Prüfdatum steht nur da, wenn es eines gibt. Der Hinweis „Nur eine Vorschau. Nichts wurde gespeichert.“ erscheint nur, wenn gar nichts gespeichert werden kann und kein Vorgang läuft; mit Speichern-Knopf nennt dessen Beschriftung („Testserver: …“) das Ziel, und währenddessen sowie danach steht er nicht neben der Statusmeldung.
- „Zurück“ (früher „Zurück zu den Treffern“) gibt es auf der Bestätigungsseite nur noch, wenn es mehrere Treffer zur Auswahl gab. In der Vorschau für neue AEDs bleibt „Zurück“, weil es zur Positionsbestätigung führt.
- Zeigt die Verbindung als grüne (verbunden) oder rote (nicht verbunden) Lampe in der Kopfzeile direkt neben dem Namen, auf jeder Seite ohne Scrollen sichtbar, mit Statustext für Screenreader. „Abmelden“ und der Hinweis zum Testserver liegen jetzt im Info-Dialog. Die Anmeldeseite und alle Fehlerzustände der Anmeldung bleiben unverändert.
- Bereitet die Antwort des Bildmodells vor der strengen Prüfung auf: Zeilenumbrüche in Textfragmenten werden zu Leerzeichen, zu lange oder zu viele Einträge werden gekürzt, ungültige Bildhinweise fallen weg, und bei einem Widerspruch zwischen Szene und Gerätezahl gilt die Szene. Im Handytest führte ein Foto mit viel Etikettentext und mehreren Geräten auf dem Tisch zu `schema_mismatch`, obwohl für den Filter nur die Szene zählt. Unbekannte oder fehlende Felder, ungültige Szenen und falsche Datentypen werden weiter abgelehnt, und eine negative Szene wird nie zu einer erkannten. Der Fehlercode nennt jetzt das betroffene Feld (`schema_invalid_scene`, `schema_unexpected_keys` …).
- Schärft die Anweisung an das Bildmodell: `device_count` zählt nur AED-Geräte; Steckdosen, Laptops oder Kopfhörer zählen nicht. Textfragmente sollen ohne Zeilenumbrüche kommen.
- Stellt die Zusage auf der Startseite um: Bei aktiver Fotoprüfung steht dort, dass das Foto ohne Standort und Metadaten zur Prüfung an OpenAI geht, statt „bleibt auf deinem Gerät“. Ohne Freigabe bleibt die bisherige Zusage. Der Info-Dialog nennt die optionale Fotoprüfung in allen sechs Sprachen und sagt nicht mehr, Fotos blieben immer lokal oder es gebe keine automatische Prüfung; ein gescheiterter Prüfversuch behauptet ebenfalls nicht mehr, das Foto sei nicht gesendet worden.
- Passt `AGENTS.md` und die Produktdocs an die Entscheidung vom 10.11.2026 an: Die Fotoprüfung per OpenAI ist optional und löst den Beschluss „ohne OpenAI“ vom 9.11.2026 ab. Tests rufen die echte OpenAI-API nie auf.
- Entfernt technische Angaben aus dem Suchergebnis: Die Zeile zu Datenstand und Snapshot-Kennung entfällt, und Links zeigen „In OpenStreetMap ansehen“ statt Kennungen wie `node/123`. Zu alte Archivdaten sperren die Suche weiterhin serverseitig.
- Fragt bei einem gerade eben aufgenommenen Foto (höchstens 5 Minuten alt) nicht mehr nach dem Beobachtungsdatum. Maßgeblich ist die EXIF-Aufnahmezeit; fehlt sie, zählt nur bei „AED fotografieren“ die Dateizeit. Ältere Fotos, ausgewählte Fotos ohne Aufnahmezeit und Fotos, die selbst einen anderen Tag als heute nennen, brauchen weiter die ausdrückliche Datumsbestätigung.
- Verlangt für jede Neuanlage zwei getrennte, ausdrückliche Bestätigungen: zuerst „Hier fehlt ein AED – neu eintragen“ bzw. „Keiner davon – neuen AED eintragen“, danach in der Vorschau den Haken „vor Ort geprüft“. Ohne den ersten Schritt erscheinen weder Karte noch Vorbereitung; ohne den zweiten bleibt das Speichern gesperrt.
- Kürzt die Texte im Foto- und Suchablauf in allen sechs Sprachen deutlich und entfernt wiederholte Hinweise. Fehler- und Unvollständigkeitsmeldungen sagen weiterhin, dass sie kein Beleg für einen fehlenden AED sind.
- Erhöht das zulässige Höchstalter der AED-Archivdaten für die Umgebungssuche von 48 Stunden auf 5 Tage (120 Stunden), in der Suchroute und im Live-Check. Ein einzelner ausgefallener Pipeline-Lauf sperrt die Suche damit nicht mehr; ältere Daten bleiben ein Suchfehler und nie ein Beleg für einen freien Standort.
- Entfernt automatisch klingende Formulierungen aus der Pilot-Oberfläche: Das Beispielergebnis für eine Neuanlage heißt jetzt „Beispiel: AED im Eingangsbereich“ und sagt nicht mehr „erkannt“. Die Roadmap beschreibt die automatische Erkennung als nicht im Pilot.
- Stellt die AED-Suche von einem nicht veröffentlichten Zusatz-Feed auf die bereits vorhandene AED-Vektorebene im PMTiles-Archiv um.
- Führt nach der Fotoauswahl eine ausdrückliche Sichtbestätigung ein. Foto und EXIF bleiben lokal; Foto-GPS wird zuerst genutzt, Handy-GPS oder Kartenposition nur nach bewusster Auswahl.
- Fragt bei Kamera- und Galerie-Fotos das Beobachtungsdatum ausdrücklich ab, wenn EXIF fehlt oder nicht dem heutigen lokalen Kalenderdatum entspricht. Datumsvorschlag, Eingabegrenze und Validierung verwenden dieselbe Gerätezeitzone; ein altes oder undatiertes Foto wird nicht stillschweigend als heutige Vor-Ort-Prüfung behandelt.
- Ermöglicht die manuelle Kartenwahl auch ohne Handy-Standortfreigabe. Die Karte startet sichtbar in einer neutralen Mitteleuropa-Ansicht; eine Suche ist erst nach einer tatsächlichen Kartenbewegung möglich.
- Aktualisiert die aktuellen Produkt- und Agentenregeln auf einen Pilot ohne externe Bilddienste und ohne OpenAI.

### Added
- Ergänzt sichere Diagnoseeinträge für fehlgeschlagene oder unvollständige Umgebungssuchen: zufällige Diagnose-ID, Fehlercode, Worker-HTTP-Status und Laufzeit. Koordinaten, Konto, Kandidaten, Antworttexte und Zugangsdaten werden nicht protokolliert.
- Ergänzt nach einer vollständigen Umgebungssuche den ausdrücklichen, als seltene Ausnahme gekennzeichneten Weg „Keiner davon ist der fotografierte AED“. Erst nach sorgfältiger Einzelprüfung aller angezeigten nahen Treffer lassen sich Standort auf der Karte bestätigen und eine Neuanlage vorbereiten; nicht angezeigte Treffer bleiben in der Dublettenprüfung. Ältere laufende Uploads können nach einem Update sicher abgeglichen werden.
- Ergänzt eine mehrsprachige OSM-Einstiegsseite mit Konto-Erstellungslink. Ohne bestätigte OSM-Sitzung bleiben Fotoaufnahme, Fotoauswahl, Demo, Sichtbestätigung und Umgebungssuche ausgeblendet; Passwortdaten werden ausschließlich auf der OSM-Seite eingegeben.

### Fixed
- Verhindert, dass eine leere PMTiles-Suche ohne tatsächliche Extraktabdeckung als „keine AEDs“ gilt: Angemeldete OSM-Dev-Sitzungen bestätigen leere Bereiche über einen begrenzten, authentifizierten `map.json`-Abruf. Fehler und nicht als Punkt darstellbare AEDs sperren den Neuanlagevorschlag. Übernimmt außerdem `check_date` in vorhandene Kandidatendaten, damit die Update-Vorschau den erwarteten Wert korrekt vergleichen kann.
- Akzeptiert ausdrücklich bestätigte historische Beobachtungsdaten in beiden OSM-Dev-Schreibrouten; ungültige und zukünftige Daten bleiben gesperrt.
- Hält die Abmeldung nach einem vorübergehenden Fehler auf der OSM-Einstiegsseite erneut verfügbar.
- Stellt nach abgelaufener Anmeldung den Tastaturfokus auf eine fokussierbare Überschrift der Einstiegsseite.
- Startet den Cloudflare-Deploy nach jedem erfolgreichen CI-Lauf für einen Push auf `main` automatisch (einschließlich PR-Merges). Manuelle Läufe bleiben auf `main` möglich und benötigen weiterhin eine Bestätigung; Freigaben der `production`-Umgebung gelten weiterhin. Veröffentlicht wird ausschließlich auf `workers.dev`.
- Ergänzt eine standardmäßig abgeschaltete Neuanlage-Route für den OSM-Testserver. Sie prüft den kleinen Kartenbereich direkt vor dem Schreiben erneut auf AEDs, schreibt nur `emergency=defibrillator` und `check_date` sowie optional den bestätigten Standorttext und gleicht unklare Uploads über dasselbe Changeset ab. Eine Wiederaufnahme schließt den Changeset vor dem stabilen Abgleich; ein nachweislich leerer Changeset beendet den Vorgang als fehlgeschlagen, statt ihn endlos zu sperren. Veraltete Startvorgänge werden nach einer zweiminütigen Inaktivität atomar beendet; die mobile Vorschau verlangt einen expliziten Klick und produktives OSM bleibt technisch ausgeschlossen.
- Ergänzt eine im Betreiberstandard abgeschaltete Schreibfunktion für „vor Ort noch vorhanden“ auf dem OSM-Testserver: nur nach konkreter Bestätigung, mit Versionsprüfung, Änderungen ausschließlich an `check_date` sowie gespeicherter Wiederherstellung bei unklarer Antwort. Die mobile Vorschau zeigt die Aktion nur für angemeldete Testserver-Sitzungen und versionierte AED-Knoten.
- Ergänzt einen getrennt aktivierbaren OSM-Entwicklungslogin, der ausschließlich den festen OSM-Testserver anspricht, den angeforderten `write_api`-Zugriff serverseitig verschlüsselt an die App-Sitzung bindet und in der Oberfläche ausdrücklich als Testserver kennzeichnet.

- Ergänzt eine verschiebbare OSM-Karte zur Prüfung und Korrektur des vorgeschlagenen AED-Standorts. Jede Kartenbewegung hebt die Standortbestätigung auf.
- Ergänzt im Fotoablauf eine Vorschau für neue AED-Knoten. Eine Neuanlage wird nur nach vollständiger Suche und ausdrücklicher Bestätigung des angezeigten GPS-Punkts vorbereitet. Der OSM-Schreibweg bleibt zusätzlich über die standardmäßig deaktivierte Entwicklungsserver-Option gesperrt.
- Verbindet bestätigte AED-Knoten aus der Umgebungssuche mit einer lokalen Änderungsvorschau, die ausschließlich `check_date` enthält. Es wird weiterhin nichts an OpenStreetMap gesendet.

### Changed

- Vereinfacht das KI-Ergebnis zu „AED erkannt“ oder „Kein AED oder AED-Gehäuse erkannt“. Ein erkennbares AED-Gehäuse zählt auch ohne sichtbares Gerät als positiver Fund; ein bloßes Schild, eine leere Halterung oder ein unklarer Fall führt nicht zur Umgebungssuche.
- Umgebungssuche verwendet GPS-Koordinaten aus dem Foto, wenn vorhanden. Ohne Foto-GPS wird der Handy-Standort erst nach ausdrücklicher Auswahl verwendet. EXIF-Daten bleiben lokal und werden nicht an die KI gesendet. Bei ungenauem Handy-GPS fragt ein erneuter Versuch die aktuelle Position erneut ab.
- Ermöglicht angemeldeten OSM-Dev-Konten die ausdrücklich ausgelöste, budgetbegrenzte KI-Bildanalyse auch dann, wenn OSM-Schreibzugriffe ausgeschaltet sind. Speichern bleibt weiterhin separat gesperrt.
- Konfiguriert Wrangler so, dass Dashboard-Variablen für den Dev-Login bei Code-Deployments erhalten bleiben; Secrets bleiben weiterhin separat serverseitig gespeichert.


- Zeigt den OpenAI-Fotoeinwilligungstext nur, wenn die Live-Analyse verfügbar ist; die lokale Demo behauptet dadurch nicht mehr, ein Foto zu senden.
- Ergänzt eine geführte, klar gekennzeichnete Foto-Demo und eine freiwillige Diagnoseaufzeichnung für Testläufe. Die Logs enthalten nur feste Ereigniscodes und zufällige Lauf-IDs; automatische Request-Logs sind deaktiviert.
- Aktualisiert Architektur-, Umsetzungs- und Pilotdokumentation nach dem ersten öffentlichen Workers-Free-Deployment. Hält URL, Health-Prüfung, migrierten D1-Stand und weiterhin abgeschaltete KI-/OSM-Funktionen fest.
- Vereinheitlicht den App-Namen in allen Sprachen auf `AEDjaeger` ohne Umlaute.
- Dokumentiert den festgelegten Produktnamen und die von Vitest unterstützten Node.js-Versionen in README und Paketmetadaten.

- Trennt im manuellen Bildtest sichtbare AED-Geräte, AED-Gehäuse, Wegweiser, andere Gegenstände und unklare Bilder in einem gemeinsamen Prompt-Schema.
- Respektiert lokale und von Overpass gemeldete Cooldowns, meldet deren tatsächliche Restzeit und aktualisiert den blockierten Retry-Countdown in allen sechs Sprachen.

### Security

- Trennt OSM-Dev-Discoveryfehler in unerreichbaren Endpunkt, HTTP-Fehler, ungültige Antwort und ungültige Metadaten. Für Diagnose werden nur feste Codes und gegebenenfalls der HTTP-Status verwendet, nie Antwortinhalte.
- Ergänzt datensparsame OSM-OAuth-Fehlerdiagnosen: Anwendungs-Diagnoseeinträge enthalten nur Anbieter, feste Ablaufphase, begrenzten Fehlercode und optional HTTP-Status. OAuth-Codes, Cookies, Tokens, Secrets und Antworttexte des Providers werden nicht protokolliert.
- Ergänzt die vom OSM-Entwicklungsserver verlangte `client_secret_basic`-Authentifizierung zusätzlich zu PKCE. Das Dev-Login bleibt ohne `OSM_DEV_CLIENT_SECRET` als serverseitiges Cloudflare-Secret nicht verfügbar; das Geheimnis wird weder in der Browser-App noch in Logs oder im Repository verwendet.
- Ergänzt einen serverseitigen OSM-API-URL-Baustein, der nur bei exakt gesetzter Entwicklungsumgebung Anfragen an den festen OSM-Testserver zulässt und frei wählbare Hosts oder Pfad-Ausbrüche abweist. Auch die neuen Schreibwege verwenden ausschließlich diesen Baustein.
- Speichert OSM-Entwicklungstokens nur AES-GCM-verschlüsselt, an eine aktive App-Sitzung gebunden und mit Ablaufzeit in D1; die Migration löscht sie beim Widerruf der Sitzung automatisch. Die getrennte OAuth-Anmeldung und die abgeschalteten Testserver-Schreibwege nutzen diesen Speicher.
- Speichert bei OSM-Sitzungen den Anbieter (`production` oder `development`) mit, sodass gleichlautende Subjekte nicht zwischen Servern verwechselt werden. Bildanalyse-Freigaben nennen den Anbieter ausdrücklich; D1 verwendet eine getrennte, gehashte Kostenidentität. Testserver-Konten erhalten keine Produktionsfreigabe; die Live-Fotoanalyse setzt eigene Betreiberfreigaben und Kostenlimits voraus.
- Begrenzt lesende Overpass-Abfragen pro angemeldetem OSM-Konto auf einen Aufruf pro 30 Sekunden; D1 speichert einen einweg-gehashten Kontoschlüssel, löscht abgelaufene Cooldowns bei der nächsten Suche und speichert weder Standort noch Suchergebnis.
- Speichert eine von Overpass gemeldete Upstream-Sperre als globale Ablaufzeit in D1, damit kein anderes AEDjaeger-Konto den öffentlichen Dienst währenddessen erneut anfragt.
- Setzt eine unklare Analyse-Reservierung nur mit derselben Kostenhöhe am selben UTC-Tag fort; alte Reservierungen können das Tageslimit nicht umgehen.
- Ergänzt eine standardmäßig deaktivierte Bildanalyse-Route, die OSM-Sitzung, Pilot-Freigabeliste, Origin, Bildcontainer und Größenlimit vor einer D1-Budgetreservierung prüft und die Segment-/Chunk-Zahl in JPEG, PNG und WebP begrenzt; API-Schlüssel und Bilddaten gelangen nicht in Browserantworten oder Logs.
- Prüft OSM-OIDC-Metadaten gegen feste OpenStreetMap-Endpunkte und akzeptiert ausschließlich signierte RS256-ID-Tokens mit passendem Issuer, Client, Ablaufdatum und einmaliger Nonce; Providerabrufe sind begrenzt und folgen keinen Weiterleitungen.
- Bindet OSM-Anmeldetransaktionen über HttpOnly-/SameSite-Cookies an den startenden Browser, widerruft die vorherige Sitzung bei einer Anmeldung und begrenzt die neue Sitzung serverseitig auf zwölf Stunden; OAuth-Tokens und Nutzerprofile gelangen nicht in Browserantworten oder Logs.
- Reserviert das Analysebudget in einem einzelnen bedingten Datenbank-Schreibvorgang und behandelt wiederholte Anfrage-IDs ohne zweite Reservierung.
- Erzwingt für Änderungen an `main` Pull Requests und Reviews; `@FrnkMrz` ist als Code Owner für alle Dateien hinterlegt.

### Added

- Ergänzt eine reine OSM-Änderungsvorschau: Bestätigte vorhandene Knoten dürfen nur `check_date` ändern; Neuanlagen verlangen eine bestätigte Position, erneute Kandidatenbewertung im abgedeckten Suchgebiet und freigegebene Grund-Tags.
- Ergänzt eine geschützte, ausschließlich lesende Overpass-Suchroute mit begrenzter Standortgenauigkeit, festem Suchradius, Zeit- und Antwortgrößenlimit sowie konservativer Kennzeichnung unvollständiger Ergebnisse.
- Verbindet die Fotoanalyse mit der geschützten Umgebungssuche: Der angemeldete Nutzer startet die einmalige Standortabfrage ausdrücklich, sieht mögliche OSM-Treffer und erhält auch bei fehlender oder unvollständiger Suche keinen automatischen Neuanlage- oder Schreibvorgang.
- Verbindet die Fotooberfläche über eine ausdrückliche Nutzeraktion mit der geschützten GPT-6-Luna-Analyse: Bilder werden lokal verkleinert und neu kodiert, KI-Antworten erneut validiert und nur als Beobachtung angezeigt; die App löst keine OSM-Änderung aus.
- Ergänzt Tests für KI-Anfrage, Pilotfreigabe, Modell- und Antwortvalidierung, begrenzte Wiederholungen, mobile Darstellung und alle sechs Sprachen.
- Ergänzt einen geschützten `/api/vision/analyze`-Worker-Endpunkt für strukturierte GPT-6-Luna-Bildbeobachtungen. Der Endpunkt bleibt ohne explizite Aktivierung, serverseitigen Schlüssel und vollständige Kostenlimits abgeschaltet; Tests verwenden ausschließlich simulierte Sitzungen, D1 und Modellantworten.
- Verbindet die PWA mit dem OSM-Sitzungsstatus und zeigt Login oder Abmeldung erst bei konfigurierter Worker-Anmeldung an; alle sechs Sprachen weisen darauf hin, dass der Login nur die Identität bestätigt und OSM-Änderungen deaktiviert bleiben.
- Bindet die Cloudflare-D1-Pilotdatenbank ein; `aedjaeger-pilot` wurde im Cloudflare-Konto angelegt und mit den Schema-Migrationen initialisiert. Ein Paid-Tarif wurde nicht aktiviert und ein Worker-Deployment ist nicht enthalten.

- Ergänzt OSM-Loginrouten für PKCE-Codeaustausch, OIDC-ID-Tokenprüfung, Sitzungsabfrage und Abmeldung. Die PWA zeigt den Status sowie Login/Logout an, sobald Client-ID, passender Callback und Verschlüsselungs-Secret korrekt konfiguriert sind. Der Login nutzt nur `openid` und legt keinen OSM-Zugriffstoken ab.
- Ergänzt eine D1-Sitzungstabelle mit Ablaufzeit; Browser-Sitzungstokens werden nur als Hash gespeichert.
- Ergänzt kurzlebige OSM-OAuth-Transaktionen in D1: State und Browserbindung werden gehasht, PKCE-Verifier und OIDC-Nonce mit AES-GCM an die Vorgangskennung gebunden verschlüsselt und der gültige Vorgang atomar einmalig verbraucht; verlassene abgelaufene Zeilen werden später aufgeräumt.
- Ergänzt die erste D1-Migration und eine atomare, vor dem KI-Aufruf auszuführende Reservierung für Nutzer- und Tageslimits; konkrete Grenzwerte bleiben Betreiberkonfiguration.
- Cloudflare-Worker-Grundgerüst mit statischer PWA-Auslieferung, SPA-Fallback und einem nicht-cachebaren Health-Endpunkt; Analyse- und OSM-Schreibrouten sind noch nicht freigeschaltet.
- Ergänzt ein laufzeitgeprüftes, anbieterspezifisches Schema für strukturierte KI-Bildbeobachtungen; unbekannte Felder und übergroße Werte werden verworfen.

- Führt die Demo-Suchszenarien durch dieselbe Antwortprüfung und Kandidatenbewertung wie den vorgesehenen Overpass-Ablauf.
- Ergänzt eine OSM-Kandidatenbewertung, die unvollständige Suche und ungenauen Standort von einer Neuanlagevoraussetzung trennt und ungefähre Objektmittelpunkte zur manuellen Prüfung erhält.
- Dokumentiert GPT-6 Luna als festgelegtes Bildmodell für den ersten API-Prototyp und hält den explorativen API-Test mit drei positiven Fotos samt Grenzen fest.
- Ergänzt einen isolierten, serverseitigen GPT-6-Luna-Adapter mit Bildsignatur- und Größenprüfung sowie Laufzeitvalidierung strukturierter Beobachtungen.
- Dokumentiert die explorative ChatGPT-Bildprüfung mit sieben bereinigten Bildern, ihre methodischen Grenzen und die nötige Trennung von sichtbarem Gerät, AED-Gehäuse und Wegweiser.
- Ablauf und Bewertungsbogen für einen einheitlichen, manuellen KI-Bildvergleich ergänzt.
- Bedienbarer, lokaler PWA-Prototyp für Fotoaufnahme und simulierte AED-Prüfung in sechs Sprachen.
- Sichere Demo-Fälle für bestehende und neue AEDs, Mehrfachtreffer, unklare Fotos, Suchfehler und unklare Speicherantworten.
- Mehrsprachiges Infofenster mit Erläuterung der Demo und den nächsten Prototyp-Etappen.
- Automatisierte Playwright-Prüfung für schmale Mobilansichten, sechs Info-Übersetzungen, Mehrfachtreffer, Wiederherstellung nach unklarem Ergebnis und Offline-Cache; in CI integriert.
- Prüft beschädigte Bilddateien und den Tastaturfokus in den wichtigsten Bestätigungs- und Wiederherstellungsschritten.
- Ergänzt eine validierte Overpass-Abfrage und normalisiert AED-Treffer; Ways und Relations bleiben als Näherungspositionen erkennbar, unvollständige Antworten gelten nicht als abgeschlossene Suche.
- Verbindet Overpass-Ergebnisse mit der konservativen Kandidatenbewertung; nur vollständige, ausreichend abgedeckte Suchen können einen Neuanlagevorschlag ermöglichen.

### Fixed
- Repariert den vor jeder OSM-Discovery-Anfrage auftretenden Cloudflare-Laufzeitfehler durch den nicht unterstützten Modus `redirect: "error"`. OSM-Login, Testserver-API und Overpass verwenden nun `manual` und lehnen Weiterleitungen ausdrücklich ab; ein lokaler workerd-HTTP-Test prüft dies ohne echte OSM- oder KI-Aufrufe auch in CI.

- Resume an ambiguously committed budget reservation before provider startup, while an atomic D1 claim prevents duplicate provider calls and unclear claim outcomes keep the photo without offering an unsafe retry.

- Trennt den ausdrücklich gestarteten lokalen Demoablauf sichtbar von der echten KI-Bildanalyse.
- Zeigt eine vom Analyse-Endpunkt abgewiesene OSM-Sitzung als abgemeldet an und begrenzt KI-Anfragen clientseitig auf 35 Sekunden ohne automatische Wiederholung.
- Erhält das ausgewählte Foto bei einem vorübergehenden Ausfall der Sitzungsprüfung und bietet eine sichere Wiederholung vor der KI-Anfrage an.
- Verhindert, dass eine laufende KI-Anfrage durch die Navigation über den App-Namen das Foto oder die Zuordnung ihrer Antwort verliert.
- Begrenzt strukturierte KI-Textbeobachtungen, schließt leere und reine Leerraumwerte aus, verwirft unvollständige Antworten und normalisiert unerwartete Provider-Strukturen zu einem kontrollierten Fehlerzustand.
- Schließt den Markdown-Promptblock im Bildtest korrekt und repariert den Linkanker zur Ergebnisüberschrift.
- Dokumentiert die erfolgreiche Handyprüfung von Kamera- und Bibliotheksauswahl samt noch offenen Geräteprüfungen.
- Erhöht den Kontrast des Einführungstextes auf dem Startbildschirm.
- Erhält das ausgewählte Foto in jedem Analyse- und Klärungszustand der Vorschau.
- Nimmt gebündelte JavaScript- und CSS-Dateien in den Offline-Cache auf.
- Lässt bei mehreren nahen Treffern eine Auswahl zu und erhält den konkreten AED im weiteren Ablauf.
- Bietet bei unklarer Speicherantwort eine Statusprüfung, statt den Vorgang samt Foto zu verwerfen.
- Macht den Tastaturfokus an den Foto-Auswahlfeldern sichtbar.
- Aktualisiert den Service Worker, wenn sich die gehashten App-Dateien ändern, und liefert statische Cache-Dateien offline unabhängig von irrelevanten `Vary`-Headern aus.
- Entfernt beim Aktivieren einer neuen Service-Worker-Version den vorherigen Offline-Cache samt nicht mehr benötigten Bundles.
- Beschränkt das Aufräumen des Service Workers auf AEDjaeger-eigene Caches, damit Caches anderer Funktionen auf derselben Origin erhalten bleiben.
- Begrenzt Offline-Navigation und statische Cache-Treffer auf die aktive AEDjaeger-Cache-Version.
- Lehnt nicht dekodierbare Bilder ab, bevor sie den AED-Ablauf starten können, und entfernt ihre temporären Objekt-URLs.
- Führt den Tastaturfokus nach Zustandswechseln an den passenden nächsten Schritt oder das Ergebnis.
- Erhöht den Kontrast der kleinen Datenschutz- und Hinweiszeile.
- Verhindert horizontales Scrollen in der Kopfzeile bei 320 Pixeln auch mit den längeren Sprachbezeichnungen.
- Erhöht den Kontrast der Datei-Fokusmarkierung und des Vorschauhinweises im Fußbereich.
- Verhindert, dass der Marken-Link einen ungeklärten Speichervorgang verwirft, erhält Tastaturfokus beim Sprachwechsel und verbessert den Fokuskontrast aller Bedienelemente.
- Sperrt den Marken-Link auch während des Speicherns und der Statusprüfung und verbessert den Kontrast der Demo-Steuerelemente.
- Erhöht den Kontrast des DEMO-Badges.

## [0.1.0] - 2026-10-17

### Added

- Recherche, Produktkonzept und Architektur für eine einfache mobile AED-Erfassung in OpenStreetMap.
- Sechs geplante UI-Sprachen: Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch.
- Umsetzungsplan, Sicherheitsleitlinien, internes Gamification-Konzept und Regeln für Coding-Agenten.
- PR-basierter Entwicklungsablauf mit ausführlichen Beschreibungen und GitHub-Release-Tags.
