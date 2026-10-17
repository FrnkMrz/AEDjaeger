# Anknüpfung an Hydrantenjäger

Geprüft am 17.10.2026: README, package.json, Dateistruktur und ein Ausschnitt des OSM-Service im [Repository FrnkMrz/hydranten-app](https://github.com/FrnkMrz/hydranten-app).

Referenzstand auf `main`: [`7a320fe6a6508ef26c4e29ec6734103ab67db550`](https://github.com/FrnkMrz/hydranten-app/tree/7a320fe6a6508ef26c4e29ec6734103ab67db550). Dies ist keine vollständige Codeprüfung und kein Funktionstest der Live-App.

## Was bereits vorhanden ist

Laut [README dieses Stands](https://github.com/FrnkMrz/hydranten-app/blob/7a320fe6a6508ef26c4e29ec6734103ab67db550/README.md) unterstützt Version 1.7.0 bereits das Erfassen, Anzeigen und Bearbeiten von AEDs, einschließlich Zugang, Innen-/Außenlage und Öffnungszeiten. Die Dokumentation bezeichnet 1.7.0 als live und 1.8.0 als Release-Kandidaten; der Veröffentlichungsstatus wurde nicht separat geprüft.

Der dokumentierte Ablauf startet mit OSM-Anmeldung und Foto, danach folgen Typauswahl, Standortkorrektur, Details und Upload. Fotos werden lokal verarbeitet und nicht mit dem Changeset hochgeladen.

Die App nutzt Vanilla JavaScript, Vite, Leaflet, Tailwind CSS und PWA-Unterstützung. Es gibt getrennte Services für Anmeldung, OSM, Position, Fotos, Kartendaten und PWA-Updates sowie Vitest- und Playwright-Prüfungen.

## Was sich als Ausgangspunkt anbietet

| Baustein | Idee für AEDjäger |
| --- | --- |
| Anmeldung und OSM-Upload | Vorhandenen Ablauf gezielt auf Wiederverwendung prüfen. |
| Karte und Positionskorrektur | Auf einen Objekttyp reduzieren; Innenräume stärker berücksichtigen. |
| AED-Formular | Standortbeschreibung und leicht verständliche Zugangsfragen priorisieren. |
| Fotoverarbeitung | Als optionale lokale Hilfe prüfen. |
| PWA-Updates und Fehlerzustände | Bewährte Bedienmuster übernehmen. |
| Fortschritt / Gamification | Eigene, zum Thema passende Darstellung diskutieren. |

## Was nicht ungeprüft übernommen werden sollte

Die README beschreibt GPS-Grenzen und einen automatischen Versatz von drei Metern in Blickrichtung. Für Geräte im Gebäude oder direkt an Wänden ist das kein automatisch passendes Verfahren. Die endgültige Position sollte bewusst bestätigt werden.

Regionale PMTiles-Daten und Overpass-Abgleiche könnten später nützlich sein. Für die Konzeptphase ist noch keine entsprechende Infrastruktur erforderlich. Auch die bisherige Token-Verwaltung und Offline-Funktionalität sollten vor Übernahme im Code geprüft werden.

**Arbeitsvorschlag:** Erst den bestehenden AED-Ablauf praktisch ansehen, dann entscheiden, ob eine reduzierte eigenständige App oder ein gemeinsam gepflegter Kern sinnvoller ist. Bisher wurde kein Anwendungscode kopiert und keine Architektur festgelegt.
