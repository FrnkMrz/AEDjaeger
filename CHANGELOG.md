# Changelog

Alle relevanten Änderungen an AEDjaeger werden hier nachvollziehbar festgehalten. Das Format folgt den Grundideen von [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) und verwendet Versionen im Format `MAJOR.MINOR.PATCH`.

## [Unreleased]

### Changed

- Vereinheitlicht den App-Namen in allen Sprachen auf `AEDjaeger` ohne Umlaute.
- Dokumentiert den festgelegten Produktnamen und die von Vitest unterstützten Node.js-Versionen in README und Paketmetadaten.

### Security

- Erzwingt für Änderungen an `main` Pull Requests und Reviews; `@FrnkMrz` ist als Code Owner für alle Dateien hinterlegt.

### Added

- Dokumentiert die explorative ChatGPT-Bildprüfung mit sieben bereinigten Bildern, ihre methodischen Grenzen und die nötige Trennung von sichtbarem Gerät, AED-Gehäuse und Wegweiser.
- Ablauf und Bewertungsbogen für einen einheitlichen, manuellen KI-Bildvergleich ergänzt.
- Bedienbarer, lokaler PWA-Prototyp für Fotoaufnahme und simulierte AED-Prüfung in sechs Sprachen.
- Sichere Demo-Fälle für bestehende und neue AEDs, Mehrfachtreffer, unklare Fotos, Suchfehler und unklare Speicherantworten.
- Mehrsprachiges Infofenster mit Erläuterung der Demo und den nächsten Prototyp-Etappen.
- Automatisierte Playwright-Prüfung für schmale Mobilansichten, sechs Info-Übersetzungen, Mehrfachtreffer, Wiederherstellung nach unklarem Ergebnis und Offline-Cache; in CI integriert.
- Prüft beschädigte Bilddateien und den Tastaturfokus in den wichtigsten Bestätigungs- und Wiederherstellungsschritten.

### Fixed

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
