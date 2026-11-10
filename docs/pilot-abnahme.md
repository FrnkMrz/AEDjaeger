# Pilot-Abnahme: Checklisten für Handy, Datenquelle, OSM-Test und Release

Stand: 10.11.2026. Dieses Dokument beschreibt die Prüfungen, die der Projektinitiator bzw. eine Testperson durchführt. Es ist **vorbereitet, aber noch nicht ausgeführt**. Insbesondere der Live-Check der Datenquelle und alle Handytests stehen noch aus.

Grundregeln für alle Abschnitte:

- Produktions-OpenStreetMap bleibt tabu. Schreibtests laufen ausschließlich gegen die OSM-Entwicklungsinstanz.
- Der Schalter `OSM_DEV_WRITES_ENABLED` wird nur von der Projektinhaberin oder dem Projektinhaber gesetzt, nie von einem Agenten.
- Keine Zugangsdaten, Tokens, Fotos mit Personen oder GPS-Daten in Berichten oder Screenshots teilen.

Legende für die Ergebnisfelder: `[ ]` offen, `[x]` bestanden, `[!]` Fehler (Notiz mit Uhrzeit und genauer Meldung ergänzen).

## A. Lesender Handytest

Getestet werden Android Chrome, iPhone Safari und die installierte PWA. Die Testperson meldet Abweichungen mit Gerät, Browserversion, Uhrzeit und genauem Text der Meldung.

| Nr | Schritt | Erwartetes Ergebnis | Ergebnis |
| --- | --- | --- | --- |
| A1 | App unter der workers.dev-Adresse öffnen, mit OSM-Entwicklungskonto am Testserver anmelden | Anmeldung gelingt; nach der Rückkehr von OSM ist die App wieder bedienbar | `[ ]` |
| A2 | Foto aus der Kamera aufnehmen; Standort-Erlaubnis zunächst nicht erteilen | Foto wird angezeigt; App bleibt bedienbar | `[ ]` |
| A3 | Ein Foto mit GPS-Daten auswählen | Die App meldet „Standort aus dem Foto verwendet“ | `[ ]` |
| A4 | Sichtbestätigung setzen (AED oder Gehäuse ist sichtbar) | Erst nach dem Haken geht es weiter; die App behauptet keine automatische Erkennung | `[ ]` |
| A5 | Umgebungssuche starten | Ladeanzeige, danach Kandidatenliste oder „keine Treffer nach vollständiger Suche“ | `[ ]` |
| A6 | Treffer ansehen (falls vorhanden) | Eine Umgebungskarte zeigt den gesuchten Standort (rot) und nummerierte Marker; die Nummern passen zur Trefferliste. Keine Auswahl erfolgt automatisch | `[ ]` |
| A7 | Neuanlage anstoßen: bei Treffern „Keiner davon – neuen AED eintragen“, ohne Treffer „Hier fehlt ein AED – neu eintragen“ | Erst nach diesem Tastendruck erscheinen Karte und Positionsbestätigung (erste Bestätigung). In der Vorschau bleibt das Speichern gesperrt, bis der Haken „vor Ort geprüft“ gesetzt ist (zweite Bestätigung) | `[ ]` |
| A8 | Kamera-Berechtigung verweigern und erneut versuchen | Verständlicher Hinweis, kein Absturz; die App bietet die Fotoauswahl an | `[ ]` |
| A9 | Standort-Berechtigung verweigern und Kartenposition wählen | Suche startet erst nach bewusster Kartenauswahl; keine Standortdaten werden gesendet | `[ ]` |
| A10 | Offline-Start der installierten PWA (Flugmodus) | Die Oberfläche startet aus dem Cache; die Suche zeigt einen Fehler statt eines leeren Ergebnisses | `[ ]` |
| A11 | Installation der PWA auf dem Startbildschirm | Symbol und Name „AEDjaeger“ stimmen; Start im Vollbild oder im App-Modus | `[ ]` |
| A12 | Layout bei schmaler Breite (Hoch- und Querformat) | Kein horizontales Scrollen; Schaltflächen sind bedienbar | `[ ]` |

### Sprachprüfung (A13)

Jede Sprache wird auf dem schmalen Handybildschirm mit Fotoablauf, Suche und Info-Dialog geprüft.

| Sprache | Erwartung | Android Chrome | iPhone Safari |
| --- | --- | --- | --- |
| Deutsch | Keine englischen oder unübersetzten Platzhalter; Umbrüche korrekt | `[ ]` | `[ ]` |
| Englisch | wie oben | `[ ]` | `[ ]` |
| Polnisch | Sonderzeichen (ą, ę, ś, ż …) korrekt angezeigt | `[ ]` | `[ ]` |
| Japanisch | Schriftgröße und Zeilenumbruch lesbar | `[ ]` | `[ ]` |
| Französisch | Akzente und Textlänge passen in die Schaltflächen | `[ ]` | `[ ]` |
| Spanisch | Sonderzeichen (ñ, ¿, ¡) korrekt angezeigt | `[ ]` | `[ ]` |

## B. Live-Check der Datenquelle

Der Check ist rein lesend. Er ruft nur `metadata.json` und eine Zoom-14-Kachel des PMTiles-Archivs bei `pipeline.openfiremap.org` ab. Er schreibt nichts.

Ausführung entweder

- über den GitHub-Workflow „Live-Check AED-Datenquelle“ (manuell per „Run workflow“), oder
- lokal mit `npm run check:live-search` (optional `-- --lat 49.4456 --lon 11.0825`).

| Nr | Prüfpunkt | Erwartetes Ergebnis | Ergebnis |
| --- | --- | --- | --- |
| B1 | Der Check endet mit Exit-Code 0 | Ausgabe „Live-Check bestanden (nur lesend)“ | `[ ]` |
| B2 | Range-Unterstützung | Kein Fehler „Range-Anfrage wurde nicht korrekt beantwortet“ | `[ ]` |
| B3 | Datenstand | „OSM-Datenstand bis …“ mit Alter unter 5 Tagen (120 Stunden) | `[ ]` |
| B4 | Ebene `defibrillators` | Anzahl an Features in der Testkachel; keine Meldung „Ebene fehlt“ | `[ ]` |
| B5 | Zweite Koordinate (z. B. Hamburg oder Wien) | Ebenfalls bestanden, sofern die Kachel Daten enthält | `[ ]` |

Bei einem Fehler gilt: Eine Fehlermeldung zu fehlenden Kacheln oder Ebenen ist **kein Beleg**, dass an dieser Stelle kein AED existiert. Die App sperrt in diesem Fall korrekt die Suche und den Neuanlagevorschlag.

## C. Kontrollierter OSM-Dev-Schreibtest

Voraussetzungen (alle erfüllt, bevor der Schalter eingeschaltet wird):

1. Abschnitt A ist bestanden, mindestens auf einem Android-Handy und einem iPhone.
2. Abschnitt B ist bestanden (Exit-Code 0, Datenstand aktuell).
3. Die Projektinhaberin oder der Projektinhaber hat den Test ausdrücklich freigegeben.
4. Die Zielinstanz ist die OSM-Entwicklungsinstanz (`master.apis.dev.openstreetmap.org`). Die Schreibroute ist fest auf diesen Host begrenzt.

Ablauf:

| Nr | Schritt | Erwartetes Ergebnis | Ergebnis |
| --- | --- | --- | --- |
| C1 | `OSM_DEV_WRITES_ENABLED` als Worker-Variable im Cloudflare-Dashboard auf `true` setzen | Der Schalter ist nur für diesen Testlauf an. Ob dafür eine neue Version nötig ist, ist im Dashboard zu prüfen; das Repository belegt dazu nichts | `[ ]` |
| C2 | Genau **eine** `check_date`-Bestätigung an einem vorhandenen AED durchführen | Vorschau zeigt nur `check_date`; nach Bestätigung genau eine Änderung auf der Dev-Instanz | `[ ]` |
| C3 | Genau **eine** Neuanlage durchführen (nur nach erfolgreicher, vollständiger Suche im Testgebiet) | Vorschau zeigt nur `emergency=defibrillator` und `check_date`; genau ein neuer Knoten | `[ ]` |
| C4 | Changeset auf der Dev-Instanz öffnen und prüfen | Bei C2 ist nur `check_date` geändert. Bei C3 sind nur `emergency=defibrillator` und `check_date` gesetzt | `[ ]` |
| C5 | Schalter wieder ausschalten (`OSM_DEV_WRITES_ENABLED` entfernen oder `false`) | Ein erneuter Schreibversuch wird abgelehnt | `[ ]` |
| C6 | Produktions-OSM prüfen | Es gibt keine Änderung durch diesen Test | `[ ]` |

Hinweise: Wiederholte Klicks sind zu vermeiden. Bei einem Verbindungsabbruch darf der Vorgang nicht blind wiederholt werden; die App gleicht den Stand über das ursprüngliche Changeset ab. Ergebnisse (Changeset-Nummer, Node-ID, Zeitpunkt) gehören in den Abnahmebericht, aber keine Tokens.

## D. Rückweg

Wenn der Test auffällig ist:

1. Schalter `OSM_DEV_WRITES_ENABLED` sofort ausschalten.
2. Die vorherige Worker-Version über das Cloudflare-Dashboard zurückrollen. Die Bezeichnung der Menüs (Versionen oder Deployments) ist im Dashboard zu prüfen.
3. Eine D1-Wiederherstellung macht **keine** OSM-Änderungen rückgängig. Änderungen auf der Dev-Instanz müssen bei Bedarf dort manuell korrigiert werden.
4. Den Vorfall mit Uhrzeit und Changeset-Nummer im Abnahmebericht festhalten.

## E. Kriterien für den Release v0.1.0

Der Tag `v0.1.0` wird nur gesetzt, wenn alle folgenden Punkte erfüllt sind:

- [ ] Abschnitt A ist bestanden (Android, iPhone, PWA, alle sechs Sprachen).
- [ ] Abschnitt B ist bestanden.
- [ ] Abschnitt C ist bestanden und der Schalter ist wieder aus.
- [ ] `CHANGELOG.md` enthält die Fassung 0.1.0 mit Datum.
- [ ] Die Änderungen sind über einen Pull Request in `main` gemergt; die Code-Owner-Freigabe liegt vor.
- [ ] Der Tag zeigt auf genau diesen gemergten `main`-Commit.
- [ ] Die ausdrückliche Freigabe der Projektinhaberin oder des Projektinhabers liegt vor.

Ohne diese Punkte wird weder ein Tag noch ein GitHub-Release erstellt.

## Was diese Abnahme nicht abdeckt

- Automatische Bilderkennung ist nicht Teil des Pilots und wird nicht geprüft.
- Die Live-Verfügbarkeit des PMTiles-Archivs hängt von `pipeline.openfiremap.org` ab. Der Check misst nur den Stand zum Zeitpunkt des Laufs.
- Eine Stichprobe an einer Koordinate ist kein Nachweis für die gesamte Region.
- Produktions-OSM wird in keinem Abschnitt geschrieben.
