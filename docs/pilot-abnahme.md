# Pilot-Abnahme: Checklisten für Handy, Datenquelle, OSM-Test und Release

Stand: **15.11.2026**. Diese Checkliste ist die maßgebliche Abnahme für den Pilot. P10 ist gemergt; die PWA-Symbolkorrekturen aus PR #107 sind ebenfalls auf `main`. Aktueller Commit: `1695930`; die CI dafür läuft noch ([Lauf #43701600670](https://github.com/FrnkMrz/AEDjaeger/actions/runs/43701600670)). Der letzte erfolgreiche CI- und Deploy-Lauf ist [#43700608053](https://github.com/FrnkMrz/AEDjaeger/actions/runs/43700608053) auf Commit `062d34e`. Das ersetzt keine manuelle Geräte- oder Schreibtest-Abnahme.

**Aktueller Abnahmestand:** A ist nur teilweise manuell geprüft; Android ist nicht getestet. B1–B4 sind bestanden, B5 (zweite Koordinate) bleibt offen. C0.1–C0.5 sind laut den Einträgen vom 13.11. vorbereitet, C0.6–C0.8 fehlen. Beim ersten Dev-Schreibversuch am 13.11. wurde Node `4365809370` im Changeset `725093` angelegt, während die App „Ergebnis unklar“ meldete. Der Fehler wurde behoben und auf `main` deployed; die manuelle Wiederaufnahme und Verifikation dieses bestehenden Vorgangs ist **noch nicht bestätigt**. Vor einem neuen Create muss er abgeglichen werden, damit kein Duplikat entsteht.

Grundregeln für alle Abschnitte:

- Produktions-OpenStreetMap bleibt tabu. Schreibtests laufen ausschließlich gegen die OSM-Entwicklungsinstanz.
- Der Schalter `OSM_DEV_WRITES_ENABLED` wird nur von der Projektinhaberin oder dem Projektinhaber gesetzt, nie von einem Agenten.
- Keine Zugangsdaten, Tokens, Fotos mit Personen oder GPS-Daten in Berichten oder Screenshots teilen.

Legende für die Ergebnisfelder: `[ ]` offen, `[x]` bestanden, `[!]` Fehler (Notiz mit Uhrzeit und genauer Meldung ergänzen).

## A. Lesender Handytest

Getestet werden Android Chrome, iPhone Safari und die installierte PWA. Die Testperson meldet Abweichungen mit Gerät, Browserversion, Uhrzeit und genauem Text der Meldung.

**Stand 15.11.2026:** Der Projektinhaber hat kein Android-Gerät. Android ist **nicht getestet**; alle A-Punkte ohne `[x]` bleiben offen. Am 13.11. hat der Projektinhaber den kontrollierten Schreibtest auf dem OSM-Testserver ausdrücklich auch ohne Android-Abnahme freigegeben. Diese eng begrenzte Testfreigabe ersetzt keine Android-Prüfung für `v0.2.0`; die Release-Abnahme bleibt offen (siehe [offene Fragen](offene-fragen.md)).

**Vor jedem Test die Version prüfen:** Eine installierte PWA lädt eine neue Version erst nach einem vollständigen Neustart. Im Info-Dialog (Schaltfläche „Info“) steht ganz unten „Version <Nummer> · <Datum, Uhrzeit>“. Öffne im Browser `https://aedjaeger.aedjaeger.workers.dev/version.json`; dort steht `{"revision":"<Nummer>"}`. **Sind beide Nummern gleich, läuft die neueste Version.** Weichen sie ab, läuft noch die alte: App ganz schließen, neu öffnen, bei „Neue Version verfügbar“ auf „Neu laden“ tippen und erneut vergleichen. Das Datum im Dialog ist der Zeitpunkt des Builds. Der Build läuft im Workflow vor dem Deploy-Schritt, das Datum liegt also immer kurz **vor** der Deploy-Zeit; ein Vergleich mit der Deploy-Zeit taugt nicht. Die Nummer gehört in jede Fehlermeldung.

| Nr | Schritt | Erwartetes Ergebnis | Ergebnis |
| --- | --- | --- | --- |
| A1 | App unter der workers.dev-Adresse öffnen, mit OSM-Entwicklungskonto am Testserver anmelden | Anmeldung gelingt; nach der Rückkehr von OSM ist die App wieder bedienbar | `[x]` 13.11.2026, iPhone, bestätigt vom Projektinhaber (Anmeldung am Testserver klappt) |
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
| A19 | Version prüfen: im Browser `https://aedjaeger.aedjaeger.workers.dev/version.json` öffnen, dann in der App im Info-Dialog ganz nach unten scrollen (und auf dem Hauptbildschirm die kleine Nummer unten ansehen) | Die Nummer im Dialog gleicht der veröffentlichten Revision | `[x]` 13.11.2026, iPhone, bestätigt vom Projektinhaber |
| A20 | Lampe und Abmelden: im Info-Dialog „Abmelden“ tippen, dann die rote Lampe tippen, dann „Mit OSM-Testserver anmelden“ tippen; nach der Anmeldung die grüne Lampe tippen | Nach „Abmelden“ erscheint die Anmeldeseite mit roter Lampe. Die rote Lampe markiert nur den Anmelde-Knopf und meldet nie von selbst an. Erst der Knopf startet die Anmeldung. Die grüne Lampe öffnet den Abschnitt „Abmelden“ im Info-Dialog, ohne abzumelden | `[x]` 13.11.2026, iPhone, bestätigt vom Projektinhaber |
| A21 | Ton beim Speichern (nach dem Schreibtest-Schalter): auf dem Testserver ein Speichern bestätigen. Dann im Info-Dialog „Ton, wenn das Speichern gelingt“ aus- und wieder einschalten | Nach der Erfolgsmeldung klingt **einmal** ein kurzes „Ka-Ching“. Kein Ton bei Vorschau, Senden, Fehler oder „Ergebnis unklar“. Beim Einschalten klingt der Ton einmal zur Probe, beim Ausschalten nicht. Bei stumm geschaltetem iPhone (Seitenschalter) bleibt es still | `[ ]` |

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

Belege: [Lauf #2 vom 10.11.2026, 09:20 UTC](https://github.com/FrnkMrz/AEDjaeger/actions/runs/42789878021) (Stand nach der Anhebung des Höchstalters auf 120 Stunden, Commit `ee1dc41`). Lauf [#1](https://github.com/FrnkMrz/AEDjaeger/actions/runs/42784569321) bestand ebenfalls, noch mit der alten Grenze von 48 Stunden. Beide Läufe sind Stichproben zu einem Zeitpunkt und belegen die Verfügbarkeit nicht für später. Für B5 den Workflow oder `npm run check:live-search -- --lat <Breite> --lon <Länge>` mit einer zweiten Koordinate ausführen. Der GitHub-Workflow „Live-Check AED-Datenquelle“ hat dafür die Eingaben `lat` und `lon` (leer = Nürnberg Hbf); die Eingaben stehen im Dialog „Run workflow“ zur Verfügung.

Bei einem Fehler gilt: Eine Fehlermeldung zu fehlenden Kacheln oder Ebenen ist **kein Beleg**, dass an dieser Stelle kein AED existiert. Die App sperrt in diesem Fall korrekt die Suche und den Neuanlagevorschlag.

## C. Kontrollierter OSM-Dev-Schreibtest

Voraussetzungen (alle erfüllt, bevor der Schalter eingeschaltet wird):

1. Die für den Test verwendeten iPhone-Abläufe aus Abschnitt A und Abschnitt B sind bestanden. Android bleibt mangels Gerät ungetestet; die dokumentierte Freigabe vom 13.11.2026 erlaubt den eng begrenzten Dev-Schreibtest trotzdem. Das ist keine Freigabe oder Abnahme für `v0.2.0`.
2. Abschnitt B ist bestanden (Exit-Code 0, Datenstand aktuell).
3. Die Projektinhaberin oder der Projektinhaber hat den Test ausdrücklich freigegeben. **Erteilt am 13.11.2026** für den kontrollierten Schreibtest auf dem OSM-Testserver (nicht für das echte OSM). Diese Freigabe liegt vor. Der Schalter bleibt aus, bis der Projektinhaber ihn selbst für den Test setzt.
4. Die Zielinstanz ist die OSM-Entwicklungsinstanz (`master.apis.dev.openstreetmap.org`). Die Schreibroute ist fest auf diesen Host begrenzt.

### Vorbereitung (C0): nur einrichten und prüfen, noch nichts schreiben

Der Schalter `OSM_DEV_WRITES_ENABLED` bleibt in diesem Teil **aus**. Die Punkte macht der Projektinhaber im Browser und im Cloudflare-Dashboard; Secrets gehören nur dorthin, nie in Chat, Code oder Screenshots.

| Nr | Vorbereitung | Prüfung | Ergebnis |
| --- | --- | --- | --- |
| C0.1 | Eigenes Konto auf der Dev-Instanz anlegen oder anmelden: `https://master.apis.dev.openstreetmap.org`. Die Dev-Instanz hat eigene Konten; die Zugangsdaten des echten OSM gelten dort nicht | Anmeldung auf der Dev-Instanz klappt | `[x]` 13.11.2026, bestätigt vom Projektinhaber (Anmeldung am Testserver klappt) |
| C0.2 | Auf der Dev-Instanz eine OAuth-2-Anwendung registrieren (vertraulicher Client). Redirect-URI genau: `https://aedjaeger.aedjaeger.workers.dev/api/auth/osm/development/callback`. Berechtigungen: „OpenID“ und „Karte ändern“ (`write_api`). Die Anmeldung der App fragt `openid write_api` an | Client-ID und Client-Secret liegen vor | `[x]` 13.11.2026, bestätigt vom Projektinhaber (aus der funktionierenden Anmeldung abgeleitet) |
| C0.3 | Im Cloudflare-Dashboard setzen: `OSM_DEV_LOGIN_ENABLED` = `true` (Variable), `OSM_DEV_CLIENT_ID` (Variable), `OSM_DEV_CLIENT_SECRET` (**Secret**), `OSM_DEV_REDIRECT_URI` = die Adresse aus C0.2 (Variable), `OSM_OAUTH_ENCRYPTION_KEY` (**Secret**, falls noch nicht vorhanden). `OSM_DEV_WRITES_ENABLED` bleibt aus | Alle fünf Einträge stehen im Dashboard; der Worker ist danach neu deployt oder die Einstellung ist aktiv | `[x]` 13.11.2026, bestätigt vom Projektinhaber (aus der funktionierenden Anmeldung abgeleitet; Einträge einzeln nicht geprüft) |
| C0.4 | Migrationsstand der D1-Datenbank `aedjaeger-pilot` vor dem Schreibtest nur lesend prüfen. Der Deploy wendet Migrationen nicht an. `npx wrangler d1 migrations list aedjaeger-pilot --remote` verwenden; fehlende Migrationen nicht im Rahmen dieses Tests spontan anwenden | Alle Migrationen `0001` bis `0011` stehen als angewendet da | `[x]` 15.11.2026: `0010` und `0011` wurden nach PR #99 geprüft und auf der Produktions-D1 angewendet; der aktuelle Deploy-Migrationscheck war erfolgreich ([Lauf #387](https://github.com/FrnkMrz/AEDjaeger/actions/runs/43694419824)). Vor dem Schreibtest Status erneut lesend bestätigen |
| C0.5 | App öffnen, abgemeldet: „Mit OSM-Testserver anmelden“ ist sichtbar. Anmelden | Nach der Rückkehr ist die Lampe grün; im Info-Dialog steht „Mit OSM-Testserver verbunden“. Es wurde nichts geschrieben | `[x]` 13.11.2026, bestätigt vom Projektinhaber |
| C0.6 | **Testort wählen.** Die Suche liest AEDs aus dem Archiv des echten OSM; geschrieben wird nur auf die Dev-Instanz. Einen abgedeckten Ort (D, A, CH, LI, LU) ohne AED-Treffer im Archiv wählen. Der frühere Testknoten muss dort über die Dev-Suche auffindbar sein, ohne einen Archivtreffer mit einem echten AED zu verwechseln | App zeigt nach vollständiger Suche den vorgesehenen Testknoten bzw. bestätigt vor einer neuen Neuanlage eine vollständige leere Suche | `[ ]` |
| C0.7 | Beobachtungsdaten festlegen. Für eine neue C3-Neuanlage muss ihr Datum vor dem C2-Prüfdatum liegen. Ist der Knoten aus dem Vorgang vom 13.11. bereits bestätigt, gilt sein bestehendes `check_date` (`2026-11-13`) als C3-Datum; C2 bekommt ein späteres, nicht zukünftiges Datum | Datum des Testknotens und späteres C2-Datum stehen im Bericht-Entwurf | `[ ]` |
| C0.8 | **Früheren unklaren Vorgang abgleichen, bevor ein neuer Create begonnen wird.** Während der Schreibschalter aus ist, zuerst lesend mit demselben Dev-Konto Node `4365809370` und Changeset `725093` auf der Dev-Instanz sowie die erwarteten Tags prüfen. Die App-Wiederaufnahme „Status erneut prüfen“ erfolgt unmittelbar nach C1, weil sie den aktivierten Dev-Schreibweg voraussetzt; bis dahin keinen neuen Create starten | Nach der Wiederaufnahme meldet die App den Vorgang als erstellt und die Dev-Instanz bestätigt genau `emergency=defibrillator` und `check_date`; oder es liegt ein eindeutiger Nachweis vor, dass kein Objekt angelegt wurde. Bleibt der Status unklar, Schalter ausschalten und abbrechen; keinen neuen Create senden | `[ ]` **Teilweise erfüllt.** Der Nachweis auf der Dev-Instanz liegt vor (18.11.2026, **lesend** geprüft, keine Änderung); die Wiederaufnahme in der App („Status erneut prüfen“ meldet „erstellt“) ist **noch nicht bestätigt**: Node `4365809370` Version 1 stammt aus Changeset `725093` (13.11.2026, 17:37:31 Uhr UTC, geschlossen nach 10 Sekunden, `created_count` 1, Kommentar „AEDjaeger: AED mapped on site“) und trägt genau `emergency=defibrillator` und `check_date=2026-11-13`. Es gibt keinen zweiten Knoten aus diesem Vorgang. **Neu entdeckt:** Der Knoten hat eine Version 2 aus Changeset `725534` (14.11.2026, 05:48:54 Uhr UTC, gleiches Konto, `modified_count` 1, Kommentar „AEDjaeger: AED presence checked on site“) mit `check_date=2026-11-14`. Das passt zu einer C2-Bestätigung; wer sie ausgelöst hat, ist nicht belegt. Offen bleibt, ob die App den Vorgang nach „Status erneut prüfen“ jetzt als „erstellt“ meldet |

**Ausführungsreihenfolge:** C0.8 zunächst lesend vorbereiten, dann C1 einschalten und als erste Aktion die App-Wiederaufnahme des alten Vorgangs ausführen. Nur wenn eindeutig kein Create stattgefunden hat, C3 neu anlegen; bei unklarem Ergebnis abbrechen und den Schalter ausschalten. Danach am selben Punkt neu suchen und C2 auf demselben Testknoten ausführen. Die Suche soll den Testknoten über die Dev-Instanz finden. Das ergibt sich aus `server/osm/staticCandidateSearchRoute.ts` und ist beim Praxistest zu bestätigen; weicht es ab, stoppen und die Abweichung dokumentieren. C3 ist nicht erneut anzulegen, wenn C0.8 den bereits angelegten Knoten bestätigt.

**Verschiedene Daten für C3 und C2:** Setzt C3 den `check_date` des neuen Knotens auf ein Datum und C2 meldet dasselbe Datum, schreibt die Route nichts (`already_current`, kein Changeset). Das Datum von C2 muss deshalb **später** liegen als das von C3. Ein Datum in der Zukunft ist nicht erlaubt. Darum bekommt C3 ein Datum von mindestens einem Tag früher (Foto vom Vortag), oder C2 läuft am nächsten Tag. Ein Datum, das **älter** ist als das bereits gesetzte, wird als `newer_check_date_exists` abgelehnt; auch das darf beim Test nicht passieren.

**Der Schreibtest in einfachen Worten (iPhone):**

1. **Schalter einschalten (macht der Projektinhaber, nie ein Agent).** Cloudflare-Dashboard, Worker `aedjaeger`, Einstellungen, „Variablen und Secrets“ (die Menünamen können abweichen). Variable `OSM_DEV_WRITES_ENABLED` mit dem Wert `true` anlegen und speichern. Der Wert bleibt bei späteren Deploys erhalten (`keep_vars` in `wrangler.jsonc`). Ob der Schalter wirkt, zeigt `https://aedjaeger.aedjaeger.workers.dev/api/auth/session` im Browser, angemeldet am Testserver: Dort steht `"developmentWriteAvailable":true`. In der App steht dann in der Vorschau nicht mehr „Nur eine Vorschau“, und der Speicher-Knopf erscheint.
2. **Den vorhandenen Testvorgang zuerst abgleichen.** C0.8 für Node `4365809370` / Changeset `725093` ausführen. Wird die erfolgreiche Neuanlage bestätigt und stimmen die Tags, gilt C3 als bereits durchgeführt. Keinen zweiten Knoten anlegen.
3. **Nur falls C0.8 eindeutig belegt, dass keine Neuanlage erfolgte:** Einen Test-AED wie beschrieben an einer vollständigen leeren Suche anlegen und genau einmal speichern. Bleibt die Antwort unklar, stoppen; nicht neu senden.
4. **Prüfdatum erneuern.** Am selben Testknoten neu suchen. „Noch vorhanden“ bestätigen. Das Datum muss **später** sein als das bereits vorhandene `check_date`, darf aber nicht in der Zukunft liegen.
5. **Ergebnis auf der Dev-Seite ansehen.** Die Änderungen auf `master.apis.dev.openstreetmap.org` öffnen. Die Neuanlage hat genau `emergency=defibrillator` und `check_date`; beim zweiten Vorgang hat sich nur das Datum geändert.
6. **Schalter bleibt an (Entscheidung des Projektinhabers vom 18.11.2026).** `OSM_DEV_WRITES_ENABLED` bleibt bewusst eingeschaltet, solange der Pilot nur den Testserver nutzt. Der Projektinhaber kann ihn jederzeit entfernen oder auf `false` setzen; danach wird ein neuer Schreibversuch abgelehnt. Vor jedem Schritt in Richtung echtes OSM wird neu entschieden.
7. **Echtes OSM ansehen.** Es darf keine Änderung durch den Test geben.

Warum die Kartenposition: Die Suche liest die echten AEDs des echten OSM, geschrieben wird nur auf den Testserver. Ein echter AED aus dem Archiv (zum Beispiel der am Feuerwehrhaus) ist auf dem Testserver nicht vorhanden und darf dort nicht „bestätigt“ werden. Der Testpunkt auf dem Feld ist Testdaten auf dem Testserver; im echten OSM würde man immer die echte Position nehmen.

Ablauf:

| Nr | Schritt | Erwartetes Ergebnis | Ergebnis |
| --- | --- | --- | --- |
| C1 | `OSM_DEV_WRITES_ENABLED` als Worker-Variable im Cloudflare-Dashboard auf `true` setzen | Der Schalter ist nur für diesen Testlauf an. Ob dafür eine neue Version nötig ist, ist im Dashboard zu prüfen; das Repository belegt dazu nichts | `[ ]` |
| C3 | Vorhandene Neuanlage aus C0.8 als C3 bestätigen. Nur wenn zweifelsfrei kein Create stattgefunden hat: genau eine Neuanlage nach erfolgreicher, vollständiger Suche im Testgebiet durchführen | App meldet den alten Vorgang als erstellt und die Dev-Instanz zeigt genau die zwei erwarteten Tags; andernfalls höchstens ein neu erstellter Knoten. Kein Create bei unklarem Status | `[ ]` **Teilweise erfüllt.** Die Neuanlage vom 13.11.2026 ist auf der Dev-Instanz belegt (siehe C0.8), es muss nichts neu angelegt werden. Abgehakt wird C3 erst, wenn die App den Vorgang nach „Status erneut prüfen“ als „erstellt“ meldet |
| C2 | Danach genau **eine** `check_date`-Bestätigung an demselben Testknoten durchführen, mit einem Beobachtungsdatum **nach** dem vorhandenen Datum von C3 (siehe C0.7) | Vorschau zeigt nur `check_date`; nach Bestätigung genau eine Änderung auf der Dev-Instanz (ein neues Changeset, nicht `already_current`) | `[ ]` Nachweis liegt vor: Version 2 des Testknotens (Changeset `725534`, 14.11.2026) ändert nur `check_date` von `2026-11-13` auf `2026-11-14`. Bestätigung durch den Projektinhaber, dass dies sein C2-Test war, und Prüfung von C4 bis C6 stehen noch aus |
| C4 | Changeset auf der Dev-Instanz öffnen und prüfen | Bei C2 ist nur `check_date` geändert. Bei C3 sind nur `emergency=defibrillator` und `check_date` gesetzt | `[ ]` |
| C5 | **Entfällt.** Der Projektinhaber lässt `OSM_DEV_WRITES_ENABLED` bewusst an (Entscheidung vom 18.11.2026). Stattdessen gilt: Die Schreibroute ist fest auf die Dev-Instanz begrenzt | Es entsteht keine Schreibanfrage an das echte OSM (siehe C6) | entfällt, Entscheidung 18.11.2026 |
| C6 | Produktions-OSM prüfen | Es gibt keine Änderung durch diesen Test | `[ ]` |

**Erster Versuch am 13.11.2026 (iPhone):** Die Neuanlage legte auf dem Testserver den Knoten `4365809370` an (Änderungssatz `725093`, Version 1, genau die zwei Angaben `emergency=defibrillator` und `check_date=2026-11-13`; der Änderungssatz wurde nach etwa 10 Sekunden geschlossen). Die App blieb trotzdem bei „Testserver: Ergebnis unklar“. Ursache: Die Statusprüfung des Änderungssatzes las nur XML, der Testserver antwortete mit JSON. Behoben im Code, mit Tests; ohne Deploy bleibt der Zustand unverändert. Nach dem Deploy bestätigt „Testserver: Status erneut prüfen“ den vorhandenen Vorgang, ohne einen zweiten Knoten anzulegen. Der Test ist erst abgehakt, wenn die App „erstellt“ meldet.

### Zusatztest für den Detailweg (Etappen P2 bis P5; Prüfschritte D1–D7)

Erst nach C2 bis C4, am gleichen Testort und mit demselben Schalter `OSM_DEV_WRITES_ENABLED`. Der Schalter `OSM_DETAIL_CORRECTIONS_ENABLED` wird wie der Schreibschalter nur vom Projektinhaber gesetzt, nie von einem Agenten, und nur für D4 bis D6 eingeschaltet.

| Nr | Schritt | Erwartetes Ergebnis | Ergebnis |
| --- | --- | --- | --- |
| D1 | Neuanlage mit einigen Angaben (Standort-Text, Zugang, Zeiten) | Die Vorschau nennt alle Tags. Der neue Knoten hat genau diese Tags plus `emergency=defibrillator` und `check_date` | `[ ]` |
| D2 | Am Knoten aus D1 „Fehlende Angaben ergänzen“ und zum Beispiel Ebene und Betreiber ergänzen | Die schon eingetragenen Werte stehen als gesperrte Zeilen da. Der Änderungssatz enthält nur die neuen Tags und `check_date`; Kommentar „missing details added“; alle anderen Tags unverändert | `[ ]` |
| D3 | Dasselbe mit einem Wert, der schon vorhanden ist, in einem zweiten Browserfenster, das vor D2 geöffnet wurde | Konflikt-Meldung; nichts wird geschrieben | `[ ]` |
| D4 | `OSM_DETAIL_CORRECTIONS_ENABLED` = `true` setzen. `https://aedjaeger.aedjaeger.workers.dev/api/auth/session` zeigt `"developmentCorrectionsAvailable":true`. In der App erscheint „Angaben ergänzen oder korrigieren“ | Das Formular ist vorbelegt | `[ ]` |
| D5 | Einen Wert korrigieren (zum Beispiel Zugang) | Gelb umrandet mit „Vorher: …“; die Vorschau zeigt `alt → neu`; Speichern erst nach dem Haken; der Änderungssatz ändert nur diesen Wert und `check_date`; Kommentar „details added and corrected“ | `[ ]` |
| D6 | Den Wert in einem zweiten Fenster (oder iD) ändern und danach im alten Fenster speichern | Konflikt-Meldung; der fremde Wert bleibt unverändert | `[ ]` |
| D7 | Nur den Korrektur-Schalter `OSM_DETAIL_CORRECTIONS_ENABLED` wieder ausschalten; `OSM_DEV_WRITES_ENABLED` bleibt an (Entscheidung vom 18.11.2026) | Der Sitzungsstatus enthält kein `developmentCorrectionsAvailable`; ein erneuter Schreibversuch mit Korrektur wird mit 403 abgelehnt | `[ ]` |

Abnahmebericht (ausfüllen, ohne Tokens):

| Angabe | Wert |
| --- | --- |
| Datum, Uhrzeit (Beginn und Ende) | |
| Testort (Ungefähr, ohne Straße genügt) | |
| Dev-Konto (Benutzername) | |
| Schalter eingeschaltet von / bis | |
| C2: Changeset-Nummer, Node-ID, geänderter Tag | |
| C3: Changeset-Nummer, neue Node-ID, gesetzte Tags | |
| C4: Beobachtung im Changeset (nur erwartete Tags?) | |
| C5: entfällt (Schalter bleibt an, Entscheidung 18.11.2026) | |
| C6: Produktions-OSM geprüft von / wann | |
| Auffälligkeiten, Abweichungen | |

Hinweise: Wiederholte Klicks sind zu vermeiden. Bei einem Verbindungsabbruch darf der Vorgang nicht blind wiederholt werden; die App gleicht den Stand über das ursprüngliche Changeset ab. Ergebnisse (Changeset-Nummer, Node-ID, Zeitpunkt) gehören in den Abnahmebericht, aber keine Tokens.

## Rückweg bei einem Vorfall

Wenn der Test auffällig ist:

1. Schalter `OSM_DEV_WRITES_ENABLED` sofort ausschalten.
2. Die vorherige Worker-Version über das Cloudflare-Dashboard zurückrollen. Die Bezeichnung der Menüs (Versionen oder Deployments) ist im Dashboard zu prüfen.
3. Eine D1-Wiederherstellung macht **keine** OSM-Änderungen rückgängig. Änderungen auf der Dev-Instanz müssen bei Bedarf dort manuell korrigiert werden.
4. Den Vorfall mit Uhrzeit und Changeset-Nummer im Abnahmebericht festhalten.

## E. Kriterien für den Release v0.2.0

Version 0.1.0 (17.10.2026) war ein reiner Dokumentationsstand und bekommt keinen Tag. Der Pilotstand trägt seit dem 16.11.2026 die Version 0.2.0. Am 17.11.2026 hat der Projektinhaber `v0.2.0` ausdrücklich als **Pre-release** veröffentlicht, obwohl die Punkte unten noch offen sind. Sie entscheiden jetzt darüber, ob der Pre-release-Haken entfällt und `v0.2.0` als stabiler Stand gilt:

- [ ] Abschnitt A ist bestanden (Android, iPhone, PWA, alle sechs Sprachen).
- [ ] Abschnitt B ist bestanden.
- [ ] Abschnitt C ist bestanden. C5 entfällt: `OSM_DEV_WRITES_ENABLED` bleibt auf Entscheidung des Projektinhabers vom 18.11.2026 an, solange der Pilot nur den Testserver nutzt.
- [ ] `CHANGELOG.md` enthält die Fassung 0.2.0 mit Datum.
- [ ] Die Änderungen sind über Pull Requests in `main` gemergt und alle erforderlichen Statusprüfungen sind grün. Die Freigabeanforderung richtet sich nach der dann aktuellen Branch-Protection-Regel; Stand 13.11.2026 ist keine Code-Owner-Freigabe erforderlich.
- [ ] Der Tag zeigt auf genau diesen gemergten `main`-Commit.
- [ ] Die ausdrückliche Freigabe der Projektinhaberin oder des Projektinhabers liegt vor.

Ohne diese Punkte bleibt `v0.2.0` ein Pre-release. Weitere Tags oder Releases entstehen nur auf ausdrücklichen Auftrag.

## F. Fotoprüfung per OpenAI (nur bei Betreiber-Freigabe)

Voraussetzung: Der Betreiber hat die Fotoprüfung im Cloudflare-Dashboard eingerichtet (siehe [offene Fragen](offene-fragen.md#betreiber-einrichtung-der-fotoprüfung)). Die Prüfung kostet Geld; die Testperson nutzt nur eigens aufgenommene, unbedenkliche Fotos ohne erkennbare Personen.

| Nr | Schritt | Erwartetes Ergebnis | Ergebnis |
| --- | --- | --- | --- |
| F1 | Startseite öffnen, angemeldet mit einem zugelassenen Konto | Hinweis „Das Foto geht ohne Standort und Metadaten zur Prüfung an OpenAI.“ statt der Zusage „bleibt auf deinem Gerät“ | `[ ]` |
| F2 | Mit einem nicht zugelassenen Konto anmelden | Bisheriger Ablauf mit „AED oder Gehäuse gesehen – weiter“; kein Foto verlässt das Gerät | `[ ]` |
| F3 | Foto eines echten AED oder Gehäuses wählen, „AED gesehen – Foto prüfen“ tippen | Ladeanzeige, danach weiter zu Datumsfrage bzw. Standort und Suche | `[ ]` |
| F4 | Screenshot, Foto eines anderen Gegenstands (z. B. Schuhe) wählen und prüfen | „Kein AED erkennbar“; „Anderes Foto“ ist der Standardweg, keine Suche, keine einfache Selbstbestätigung | `[x]` 13.11.2026, iPhone, bestätigt vom Projektinhaber: Foto vom Schreibtisch (Orangensaft, Laptop, Tastaturen) ergab „Kein AED erkennbar“. Die weiteren Teile (keine Suche, keine einfache Selbstbestätigung) sind aus dem Ablauf bis zur Ausnahme abgeleitet |
| F5 | Unscharfes oder sehr weit entferntes AED-Foto prüfen | „Nicht eindeutig“ oder erkannt; bei „nicht eindeutig“ „Anderes Foto“ oder die Ausnahme (F10) | `[ ]` |
| F6 | Flugmodus während der Prüfung einschalten | Hinweis „Die Prüfung ist gerade nicht möglich“ und die Selbstbestätigung steht bereit | `[ ]` |
| F7 | Tageslimit erreichen (Limit vorübergehend sehr klein setzen) | Rückfall auf die Selbstbestätigung, keine Fehlermeldung mit Zahlen oder Kosten | `[ ]` |
| F8 | Eine Stichprobe von mindestens 20 echten AED-Fotos und 20 Fotos ohne AED prüfen | Anzahl falsch gesperrter AED-Fotos und durchgelassener Fremdfotos notieren | `[ ]` |
| F9 | Abrechnung im OpenAI-Konto nach den Tests ansehen | Kosten liegen im erwarteten Rahmen (je Prüfung grob unter 0,01 US-Dollar laut früherem Test) | `[ ]` |
| F10 | Bei „Kein AED erkennbar“ „Trotzdem: Hier ist ein AED“ tippen | Rückfrage „Wirklich ein AED?“; erst „Ja, AED oder Gehäuse ist zu sehen – weiter“ führt weiter, „Anderes Foto“ bricht ab | `[x]` 13.11.2026, iPhone: Die Ausnahme wurde genutzt und führte über die Rückfrage bis zur Vorschau „neuer AED“. Die Rückfrage selbst ist aus dem Ablauf abgeleitet, nicht einzeln beobachtet |
| F11 | Foto mit viel Text (z. B. Flasche mit Etikett) und mehreren Geräten auf dem Tisch prüfen | Kein Fehlercode „schema_mismatch“; die Prüfung liefert „Kein AED erkennbar“ | `[x]` 13.11.2026, iPhone, bestätigt vom Projektinhaber: Foto mit mehreren Geräten auf dem Tisch ergab „Kein AED erkennbar“ ohne Fehlercode. Es war keine Flasche mit Etikett; das Foto deckt den Fall „mehrere Geräte“ ab |

**Ergebnis 13.11.2026 (iPhone):** Ein Foto vom Schreibtisch mit Orangensaft, Laptop, Tastaturen und Rechner wurde von der Prüfung mit „Kein AED erkennbar“ abgelehnt; der Projektinhaber nutzte die Ausnahme (F10). Das ist ein einzelner Treffer; die Stichprobe F8 steht aus.

Hinweise: F1 bis F7 prüfen Verhalten, F8 die Trefferqualität. Zeigt F8 viele falsch gesperrte AED-Fotos, ist die Sperre „kein AED“ zu streng und wird mit dem Projektinhaber neu bewertet. Bei jedem Fehler Uhrzeit und genaue Meldung notieren, keinen Schlüssel teilen.

## G. Echtes OSM: noch vorhanden bestätigen (Etappe Q3)

Voraussetzungen (Projektinhaber):

1. Migration `0014_osm_production_write_limits.sql` auf der Produktions-D1 anwenden, **bevor** das Deploy nach dem Merge laufen kann (die Deploy-Prüfung stoppt bei offenen Migrationen): `npx wrangler d1 migrations apply aedjaeger-pilot --remote`.
2. Im Worker die Variable `OSM_PROD_WRITES_ENABLED=true` setzen. Zum Abschalten den Wert löschen oder auf etwas anderes setzen; das wirkt ohne Deploy.

| Nr | Schritt | Erwartetes Ergebnis | Ergebnis |
| --- | --- | --- | --- |
| G1 | Auf `https://aedjaeger.de` mit OpenStreetMap anmelden, ohne Schalter | Bei einem Treffer kein Knopf „In OpenStreetMap speichern“, Hinweis „Nur eine Vorschau“ | `[ ]` |
| G2 | Schalter an, Foto eines echten, eingetragenen AED, Suche | Treffer bis 10 m; in der Vorschau der Hinweis „öffentlich in OpenStreetMap“ mit dem Kommentar | `[ ]` |
| G3 | „In OpenStreetMap speichern“ | „In OpenStreetMap gespeichert.“; auf openstreetmap.org am AED nur `check_date` geändert, Changeset mit `source=survey`, `locale` und dem Kommentar | `[ ]` |
| G4 | Denselben AED innerhalb von 24 h noch einmal bestätigen | „Nichts wurde geändert: Erlaubt sind …“, kein zweites Changeset | `[ ]` |
| G5 | Flugmodus während des Speicherns | „Ergebnis unklar“; nach „Status erneut prüfen“ kein zweites Changeset | `[ ]` |
| G6 | Treffer nur aus dem Archiv (OSM-API nicht erreichbar) | Kein Speichern-Knopf | `[ ]` |

## Was diese Abnahme nicht abdeckt

- Die Trefferqualität der Fotoprüfung (wie oft sie echte AED-Fotos fälschlich sperrt oder fremde Fotos durchlässt) ist nicht belegt. Abschnitt F verlangt dazu eine Stichprobe mit echten Fotos.
- Die Live-Verfügbarkeit des PMTiles-Archivs hängt von `pipeline.openfiremap.org` ab. Der Check misst nur den Stand zum Zeitpunkt des Laufs.
- Eine Stichprobe an einer Koordinate ist kein Nachweis für die gesamte Region.
- Produktions-OSM wird in keinem Abschnitt geschrieben.
