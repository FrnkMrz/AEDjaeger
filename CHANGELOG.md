# Changelog

Alle relevanten Änderungen an AEDjaeger werden hier nachvollziehbar festgehalten. Das Format folgt den Grundideen von [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) und verwendet Versionen im Format `MAJOR.MINOR.PATCH`.

## [Unreleased]

### Changed

- Vereinheitlicht den App-Namen in allen Sprachen auf `AEDjaeger` ohne Umlaute.
- Dokumentiert den festgelegten Produktnamen und die von Vitest unterstützten Node.js-Versionen in README und Paketmetadaten.

- Trennt im manuellen Bildtest sichtbare AED-Geräte, AED-Gehäuse, Wegweiser, andere Gegenstände und unklare Bilder in einem gemeinsamen Prompt-Schema.

### Security

- Prüft OSM-OIDC-Metadaten gegen feste OpenStreetMap-Endpunkte und akzeptiert ausschließlich signierte RS256-ID-Tokens mit passendem Issuer, Client, Ablaufdatum und einmaliger Nonce; Providerabrufe sind begrenzt und folgen keinen Weiterleitungen.
- Bindet OSM-Anmeldetransaktionen über HttpOnly-/SameSite-Cookies an den startenden Browser, widerruft die vorherige Sitzung bei einer Anmeldung und begrenzt die neue Sitzung serverseitig auf zwölf Stunden; OAuth-Tokens und Nutzerprofile gelangen nicht in Browserantworten oder Logs.
- Reserviert das Analysebudget in einem einzelnen bedingten Datenbank-Schreibvorgang und behandelt wiederholte Anfrage-IDs ohne zweite Reservierung.
- Erzwingt für Änderungen an `main` Pull Requests und Reviews; `@FrnkMrz` ist als Code Owner für alle Dateien hinterlegt.

### Added

- Ergänzt OSM-Loginrouten für PKCE-Codeaustausch, OIDC-ID-Tokenprüfung, Sitzungsabfrage und Abmeldung. Der Login nutzt nur `openid`, legt keinen OSM-Zugriffstoken ab und ist noch nicht mit der App-Oberfläche oder einer Cloudflare-D1-Bindung verbunden.
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
