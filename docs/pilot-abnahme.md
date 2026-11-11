# Pilot-Abnahme: Checklisten für Handy, Datenquelle, OSM-Test und Release

Stand: 10.11.2026. Dieses Dokument beschreibt die Prüfungen, die der Projektinitiator bzw. eine Testperson durchführt. Der Live-Check der Datenquelle (Abschnitt B) lief am 10.11.2026 erfolgreich, mit Ausnahme von B5. Die vollständige Handytest-Abnahme (Abschnitt A), der OSM-Dev-Schreibtest (Abschnitt C) und die Release-Kriterien (Abschnitt E) stehen noch aus.

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
| A16 | Nach dem ersten Anmelden auf dem Handy | Einmal erscheint der Standort-Dialog des Browsers. Nach dem Start der App erscheint er nie wieder | `[ ]` |
| A17 | iPhone: „AED fotografieren“ (Kamera der App) bei erteilter Standort-Erlaubnis | Keine Frage nach dem Standort. Die Suche läuft mit „Handy-Standort verwendet“. Hat das Foto GPS, steht „Standort aus dem Foto verwendet“ | `[ ]` |
| A18 | „Foto auswählen“ (Galerie) ohne GPS, bei erteilter Erlaubnis | Die Standortwahl erscheint wie bisher; der Handy-Standort wird nicht stillschweigend genommen | `[ ]` |
| A14 | Installierte PWA offen lassen, in der Zwischenzeit eine neue Version veröffentlichen (Merge auf `main`), dann zur App zurückkehren | Nach höchstens 30 Minuten oder sofort beim Zurückkehren erscheint oben „Neue Version verfügbar“. Die App lädt nicht von selbst neu | `[ ]` |
| A15 | Banner mit aktivem Foto antippen („Neu laden“) | Hinweis „Das aktuelle Foto geht dabei verloren.“ steht vorher da; nach dem Tippen läuft die neue Version, das Banner ist weg | `[ ]` |

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
| B1 | Der Check endet mit Exit-Code 0 | Ausgabe „Live-Check bestanden (nur lesend)“ | `[x]` Lauf #2, 10.11.2026 |
| B2 | Range-Unterstützung | Kein Fehler „Range-Anfrage wurde nicht korrekt beantwortet“ | `[x]` Lauf #2: Kachel kam per Range-Anfrage, kein Fehler |
| B3 | Datenstand | „OSM-Datenstand bis …“ mit Alter unter 5 Tagen (120 Stunden) | `[x]` Lauf #2: Datenstand 08.11.2026 21:21 UTC, Alter 36,0 Stunden |
| B4 | Ebene `defibrillators` | Anzahl an Features in der Testkachel; keine Meldung „Ebene fehlt“ | `[x]` Lauf #2: 28 Features in Kachel Zoom 14, 8696/5595 |
| B5 | Zweite Koordinate (z. B. Hamburg oder Wien) | Ebenfalls bestanden, sofern die Kachel Daten enthält | `[ ]` offen: bisher nur die Standardkoordinate (Nürnberg Hbf) geprüft |

Belege: [Lauf #2 vom 10.11.2026, 09:20 UTC](https://github.com/FrnkMrz/AEDjaeger/actions/runs/42789878021) (Stand nach der Anhebung des Höchstalters auf 120 Stunden, Commit `ee1dc41`). Lauf [#1](https://github.com/FrnkMrz/AEDjaeger/actions/runs/42784569321) bestand ebenfalls, noch mit der alten Grenze von 48 Stunden. Beide Läufe sind Stichproben zu einem Zeitpunkt und belegen die Verfügbarkeit nicht für später. Für B5 den Workflow oder `npm run check:live-search -- --lat <Breite> --lon <Länge>` mit einer zweiten Koordinate ausführen. Das Skript kennt die Koordinate als Option, der GitHub-Workflow hat dafür bisher keine Eingabe.

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

## F. Fotoprüfung per OpenAI (nur bei Betreiber-Freigabe)

Voraussetzung: Der Betreiber hat die Fotoprüfung im Cloudflare-Dashboard eingerichtet (siehe [offene Fragen](offene-fragen.md#betreiber-einrichtung-der-fotoprüfung)). Die Prüfung kostet Geld; die Testperson nutzt nur eigens aufgenommene, unbedenkliche Fotos ohne erkennbare Personen.

| Nr | Schritt | Erwartetes Ergebnis | Ergebnis |
| --- | --- | --- | --- |
| F1 | Startseite öffnen, angemeldet mit einem zugelassenen Konto | Hinweis „Das Foto geht ohne Standort und Metadaten zur Prüfung an OpenAI.“ statt der Zusage „bleibt auf deinem Gerät“ | `[ ]` |
| F2 | Mit einem nicht zugelassenen Konto anmelden | Bisheriger Ablauf mit „AED oder Gehäuse gesehen – weiter“; kein Foto verlässt das Gerät | `[ ]` |
| F3 | Foto eines echten AED oder Gehäuses wählen, „AED gesehen – Foto prüfen“ tippen | Ladeanzeige, danach weiter zu Datumsfrage bzw. Standort und Suche | `[ ]` |
| F4 | Screenshot, Foto eines anderen Gegenstands (z. B. Schuhe) wählen und prüfen | „Kein AED erkennbar“; „Anderes Foto“ ist der Standardweg, keine Suche, keine einfache Selbstbestätigung | `[ ]` |
| F5 | Unscharfes oder sehr weit entferntes AED-Foto prüfen | „Nicht eindeutig“ oder erkannt; bei „nicht eindeutig“ „Anderes Foto“ oder die Ausnahme (F10) | `[ ]` |
| F6 | Flugmodus während der Prüfung einschalten | Hinweis „Die Prüfung ist gerade nicht möglich“ und die Selbstbestätigung steht bereit | `[ ]` |
| F7 | Tageslimit erreichen (Limit vorübergehend sehr klein setzen) | Rückfall auf die Selbstbestätigung, keine Fehlermeldung mit Zahlen oder Kosten | `[ ]` |
| F8 | Eine Stichprobe von mindestens 20 echten AED-Fotos und 20 Fotos ohne AED prüfen | Anzahl falsch gesperrter AED-Fotos und durchgelassener Fremdfotos notieren | `[ ]` |
| F9 | Abrechnung im OpenAI-Konto nach den Tests ansehen | Kosten liegen im erwarteten Rahmen (je Prüfung grob unter 0,01 US-Dollar laut früherem Test) | `[ ]` |
| F10 | Bei „Kein AED erkennbar“ „Trotzdem: Hier ist ein AED“ tippen | Rückfrage „Wirklich ein AED?“; erst „Ja, AED oder Gehäuse ist zu sehen – weiter“ führt weiter, „Anderes Foto“ bricht ab | `[ ]` |
| F11 | Foto mit viel Text (z. B. Flasche mit Etikett) und mehreren Geräten auf dem Tisch prüfen | Kein Fehlercode „schema_mismatch“; die Prüfung liefert „Kein AED erkennbar“ | `[ ]` |

Hinweise: F1 bis F7 prüfen Verhalten, F8 die Trefferqualität. Zeigt F8 viele falsch gesperrte AED-Fotos, ist die Sperre „kein AED“ zu streng und wird mit dem Projektinhaber neu bewertet. Bei jedem Fehler Uhrzeit und genaue Meldung notieren, keinen Schlüssel teilen.

## Was diese Abnahme nicht abdeckt

- Die Trefferqualität der Fotoprüfung (wie oft sie echte AED-Fotos fälschlich sperrt oder fremde Fotos durchlässt) ist nicht belegt. Abschnitt F verlangt dazu eine Stichprobe mit echten Fotos.
- Die Live-Verfügbarkeit des PMTiles-Archivs hängt von `pipeline.openfiremap.org` ab. Der Check misst nur den Stand zum Zeitpunkt des Laufs.
- Eine Stichprobe an einer Koordinate ist kein Nachweis für die gesamte Region.
- Produktions-OSM wird in keinem Abschnitt geschrieben.
