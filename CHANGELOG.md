# Changelog

Alle relevanten Änderungen an AEDjaeger werden hier nachvollziehbar festgehalten. Das Format folgt den Grundideen von [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) und verwendet Versionen im Format `MAJOR.MINOR.PATCH`.

## [Unreleased]

### Added
- Ergänzt eine standardmäßig abgeschaltete Neuanlage-Route für den OSM-Testserver. Sie prüft den kleinen Kartenbereich direkt vor dem Schreiben erneut auf AEDs, schreibt nur `emergency=defibrillator` und `check_date` sowie optional den bestätigten Standorttext und gleicht unklare Uploads über dasselbe Changeset ab. Eine Wiederaufnahme schließt den Changeset vor dem stabilen Abgleich; ein nachweislich leerer Changeset beendet den Vorgang als fehlgeschlagen, statt ihn endlos zu sperren. Veraltete Startvorgänge werden nach einer zweiminütigen Inaktivität atomar beendet; die mobile Vorschau verlangt einen expliziten Klick und produktives OSM bleibt technisch ausgeschlossen.
- Ergänzt eine im Betreiberstandard abgeschaltete Schreibfunktion für „vor Ort noch vorhanden“ auf dem OSM-Testserver: nur nach konkreter Bestätigung, mit Versionsprüfung, Änderungen ausschließlich an `check_date` sowie gespeicherter Wiederherstellung bei unklarer Antwort. Die mobile Vorschau zeigt die Aktion nur für angemeldete Testserver-Sitzungen und versionierte AED-Knoten.
- Ergänzt einen getrennt aktivierbaren OSM-Entwicklungslogin, der ausschließlich den festen OSM-Testserver anspricht, den angeforderten `write_api`-Zugriff serverseitig verschlüsselt an die App-Sitzung bindet und in der Oberfläche ausdrücklich als Testserver kennzeichnet.

- Ergänzt eine verschiebbare OSM-Karte zur Prüfung und Korrektur des vorgeschlagenen AED-Standorts. Jede Kartenbewegung hebt die Standortbestätigung auf.
- Ergänzt im Fotoablauf eine Vorschau für neue AED-Knoten. Eine Neuanlage wird nur nach vollständiger Suche und ausdrücklicher Bestätigung des angezeigten GPS-Punkts vorbereitet. Der OSM-Schreibweg bleibt zusätzlich über die standardmäßig deaktivierte Entwicklungsserver-Option gesperrt.
- Verbindet bestätigte AED-Knoten aus der Umgebungssuche mit einer lokalen Änderungsvorschau, die ausschließlich `check_date` enthält. Es wird weiterhin nichts an OpenStreetMap gesendet.

### Changed

- Umgebungssuche verwendet GPS-Koordinaten aus dem Foto, wenn vorhanden. Ohne Foto-GPS wird der Handy-Standort erst nach ausdrücklicher Auswahl verwendet. EXIF-Daten bleiben lokal und werden nicht an die KI gesendet.
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
