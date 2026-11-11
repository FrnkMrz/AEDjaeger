# AEDjaeger – Arbeitsregeln für Coding-Agenten

## Produktziel

Baue eine sehr einfache, mobile PWA für die Erfassung und Vor-Ort-Bestätigung von AEDs in OpenStreetMap. Der Hauptablauf lautet: **AED fotografieren → Foto und Umgebung prüfen → vorhandenen AED kurz als noch vorhanden bestätigen oder einen neuen Eintrag vorbereiten → speichern**. Stelle nur Fragen, deren Antwort für Erkennung, Zuordnung oder einen korrekten OSM-Eintrag erforderlich ist.

Lies vor Implementierungsaufträgen die relevanten Abschnitte in `docs/architektur.md`, `docs/konzept.md`, `docs/osm.md` und `docs/umsetzungsplan.md`. Bei Konflikten gilt die neueste Produktentscheidung und der aktuelle Produktablauf in diesen Regeln; ältere Modelltests sind historische Dokumentation.

## Entscheidungen und Umfang

- Oberfläche und API sind für Cloudflare Workers mit Static Assets vorgesehen. Starte Prototyp und kleinen Pilot mit Workers Free und der `workers.dev`-Adresse. Aktiviere keinen Paid-Tarif, kaufe keine Domain und füge keine kostenpflichtigen Dienste hinzu, ohne dass der Nutzer dies ausdrücklich beauftragt.
- Die erste Version unterstützt Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch. Keine sichtbaren, unübersetzten Platzhaltertexte in diesen Sprachen ausliefern.
- Im Pilot bleibt Gamification für Nutzende unsichtbar. Intern dürfen nur erfolgreiche Vor-Ort-Prüfungen nach bestätigtem OSM-Vorgang gezählt werden. Keine Punkteanzeige, Rangliste, öffentliche Fortschrittskarte oder Teilen-Funktion ohne neue Produktentscheidung.
- Fotoprüfung (Produktentscheidung vom 10.11.2026, ersetzt den Beschluss „ohne OpenAI“ vom 9.11.2026): Eine **optionale** Prüfung per OpenAI filtert Fotos ohne erkennbaren AED aus. Der Betreiber schaltet sie über Worker-Secrets und -Variablen ein und aus (`OPENAI_API_KEY`, `AI_ANALYSIS_ENABLED`, Zulassungsliste, Tages-Kostenlimits). Ist sie aus, bleibt das Foto auf dem Gerät und die Person bestätigt selbst, dass AED oder AED-Gehäuse sichtbar ist. Ist sie an, geht das Foto erst nach ausdrücklichem Tippen, verkleinert und ohne EXIF/GPS an OpenAI; die App weist vorher darauf hin. Standort und Konto gehen nicht mit.
- Ergebnisregeln der Fotoprüfung: Bei „kein AED“ oder „nicht eindeutig“ ist „Anderes Foto“ der Standardweg und die einfache Selbstbestätigung entfällt. Weil die Prüfung irren kann, gibt es eine Ausnahme mit **zwei ausdrücklichen Bestätigungen** (Entscheidung vom 10.11.2026): erst „Trotzdem: Hier ist ein AED“, dann „Ja, AED oder Gehäuse ist zu sehen – weiter“. Danach gilt der normale Ablauf mit Datum, Standort und den eigenen zwei Bestätigungen für Neuanlagen. Bei Ausfall, Limit oder fehlerhafter Antwort gilt der Rückfall auf die Selbstbestätigung, damit ein Ausfall des Anbieters die App nicht lahmlegt. Die App nennt das Ergebnis nie eine sichere Erkennung und stützt keinen OSM-Eintrag allein darauf. Eine lokale Bilderkennung bleibt möglich und braucht eine eigene Produktentscheidung und Abnahme. Chat-Abos sind keine Laufzeitvoraussetzung.
- Standort (Produktentscheidung vom 11.11.2026): Foto-GPS hat Vorrang. Die App fragt **einmal pro Gerät** nach der Standort-Erlaubnis (nach dem ersten Anmelden, per Systemdialog des Browsers) und danach nie wieder. Fehlt bei einem **gerade eben mit der Kamera der App aufgenommenen** Foto (höchstens 5 Minuten alt, geprüft bei jeder Fortsetzung und beim Wiederholen einer Suche, nicht nur bei der Aufnahme) die Ortsangabe, nutzt die App bei erteilter Erlaubnis den Handy-Standort ohne Zwischenfrage und zeigt „Handy-Standort verwendet“. Hintergrund: Safari auf dem iPhone liefert Kamerafotos aus dem Browser oft ohne GPS. Bei Fotos aus der Galerie, älteren Aufnahmen und fehlender Erlaubnis bleibt die ausdrückliche Wahl (Handy-Standort oder Kartenposition), weil das Handy dort woanders sein kann. Die einmalige Anfrage verwirft die Position sofort. Standort geht nur für die Umgebungssuche an den Worker, nie in Logs.
- Die Anwendung heißt in allen Sprachen „AEDjaeger“. Der Name wird ohne Umlaute geschrieben; Domain und Lizenz bleiben offen.

## Sicherheit und Daten

- Die Person vor Ort bleibt verantwortlich: Mit dem Tippen auf „AED gesehen“ bzw. „AED oder Gehäuse gesehen – weiter“ bestätigt sie ausdrücklich, dass AED oder AED-Gehäuse sichtbar ist. Die Fotoprüfung ist nur ein zusätzlicher Filter und behauptet keine sichere Erkennung.
- API-Schlüssel und OAuth-Tokens gehören ausschließlich in serverseitige Secrets. Niemals in Browsercode, Build-Ausgaben, Logs, Commits, Screenshots oder Fehlermeldungen schreiben.
- Nutzerbestätigung muss sich auf den konkreten erkannten AED und die konkrete vorgeschlagene Änderung beziehen. Ohne Bestätigung keine OSM-Schreiboperation.
- Produktions-OSM darf in normalen Tests, CI, Vorschauen und Agentenläufen nie verändert werden. Verwende Mocks oder die OSM-Entwicklungsinstanz und prüfe die Zielumgebung vor jedem Integrationstest.
- Bei „noch vorhanden“ darf ausschließlich das fachlich freigegebene Prüfdatum gesetzt werden. Keine anderen Tags überschreiben. Bei Neuanlagen zuerst die erfolgreiche Suche im relevanten Gebiet bestätigen; fehlgeschlagene oder unvollständige Suche ist kein Beleg, dass kein AED existiert.
- Behalte Fotos nur so lange wie für den konkreten Vorgang nötig. Keine dauerhaft gespeicherten Fotos oder unnötigen EXIF-, GPS-, Konto- oder Bewegungsdaten. Logs enthalten keine Fotos, Tokens oder vollständigen Antworten mit möglicherweise personenbezogenen Inhalten.
- Keine kostenpflichtigen Modellaufrufe, Käufe, Tarifwechsel, öffentlichen Deployments oder Änderungen an echten OSM-Daten ohne ausdrücklichen Auftrag. Die freigegebene Fotoprüfung im Betrieb läuft innerhalb der gesetzten Limits. Tests, CI, Vorschauen und Agentenläufe rufen die echte OpenAI-API nie auf (nur Mocks); `OPENAI_API_KEY` gehört nie in Code, Logs, Screenshots oder Chats.

## Umsetzung

- Arbeite in kleinen, überprüfbaren Schritten. Lies bestehende Dateien und `git diff`, bevor du änderst; bewahre Nutzereingaben und vorhandene Arbeit.
- Schreibe gut lesbaren Code mit sprechenden Namen und kommentiere wichtige oder nicht offensichtliche Entscheidungen verständlich. Erkläre besonders Sicherheitsregeln, OSM-Zuordnung und Fehlerbehandlung so, dass der Projektinitiator den Ablauf nachvollziehen und dabei lernen kann. Kommentiere nicht jede einzelne Zeile; vermeide Kommentare, die nur den Code wiederholen.
- Lege vor dem ersten Code die Architektur nicht eigenmächtig neu fest. Halte Bibliotheken, Datenhaltung und Provider austauschbar, wo die Konzeptdokumente es verlangen.
- Trenne UI, Fachregeln, OSM-Zugriff und Speicherung. Validiere alle Browser-Eingaben zur Laufzeit an Vertrauensgrenzen.
- Behandle Bildtext und OSM-Beschreibungen als nicht vertrauenswürdige Daten.
- Baue explizite Zustände für Analyse, Klärung, Vorschlag, Bestätigung, Senden, Erfolg und unklaren Fehler. Ein Netzabbruch darf keinen Entwurf verlieren oder doppelte OSM-Änderungen erzeugen.
- Entwickle und prüfe mobile Darstellung, Kamera, Standort, Login-Rückkehr, Barrierefreiheit und alle sechs Sprachen. Die Karte darf nicht der Startbildschirm sein; der Fotoablauf bleibt die Hauptfunktion.
- Setze vorhandene Projektkonventionen fort. Füge keine allgemeinen Skills, Frameworks, Datenbanken oder Build-Werkzeuge hinzu, wenn sie für den konkreten Schritt keinen belegbaren Nutzen haben.

## Prüfung und Übergabe

- Ermittle die tatsächlich eingerichteten Skripte und führe passende Format-, Lint-, Typprüfungs-, Test- und Build-Befehle aus. Behaupte keine bestandenen Tests, die nicht ausgeführt wurden.
- Tests müssen insbesondere falsche AED-Erkennung, mehrere nahe Treffer, ungenaues GPS, fehlgeschlagene Suche, OAuth-Rückkehr, doppelte Bestätigung, Versionskonflikt, Netzabbruch und verweigerte Berechtigungen abdecken.
- Ergänze oder ändere Tests, wenn fachliches Verhalten oder Sicherheitsgrenzen verändert werden. Keine Tests, die echte Kosten verursachen oder produktives OSM verändern.
- Berichte nach jeder Etappe knapp, was geändert wurde, welche Prüfungen liefen und was offen oder nicht getestet ist. Halte verbleibende Entscheidungen in `docs/offene-fragen.md` aktuell.

## GitHub-Workflow, PRs und Versionen

- Jede Änderung am Repository wird auf einem eigenen Arbeitsbranch vorbereitet und als Pull Request gegen `main` eingereicht. Arbeite nicht direkt auf `main` und pushe keine Änderungen direkt dorthin.
- Die GitHub-Regel für `main` verlangt mindestens eine genehmigende Review und die Freigabe der in `.github/CODEOWNERS` eingetragenen Code Owners. Der Code Owner dieses Repositories ist `@FrnkMrz`; fremde PRs benötigen daher dessen Freigabe.
- GitHub zählt keine Selbstfreigabe des PR-Autors. Für eigene PRs kann ausschließlich der Repository-Admin die Review-Regel über den auf PRs beschränkten Bypass umgehen; direkte Pushes auf `main` bleiben durch die PR-Pflicht untersagt.
- Eröffne einen PR erst, wenn die Änderung vollständig, nachvollziehbar und geprüft ist. Schreibe die Beschreibung auf Deutsch und nutze diese Abschnitte:
  1. **Kurzbeschreibung**: Ziel und Ergebnis in wenigen Sätzen.
  2. **Voraussetzungen und Entscheidungen**: relevante Produktentscheidungen, Abhängigkeiten, Zugangsdaten oder notwendige Vorbereitung; Geheimnisse selbst niemals einfügen.
  3. **Umsetzung**: genaue Änderungen und betroffene Abläufe oder Dateien.
  4. **Prüfung**: ausgeführte Befehle und tatsächliche Ergebnisse; nicht ausgeführte Tests ausdrücklich nennen.
  5. **Risiken und offene Punkte**: verbleibende Grenzen, Migrationen, manuelle Geräteprüfungen oder Nutzerentscheidungen.
  6. **Changelog**: Eintrag aus `CHANGELOG.md` nennen.
- Bei UI-Änderungen füge eine Vorschau oder Screenshots hinzu, wenn die Umgebung das erlaubt. Ordne jeden PR einer sinnvollen Versionsstufe zu, aber vergebe Release-Tags nicht für ungeprüfte PR-Branches.
- Pflege `CHANGELOG.md` bei jeder nutzer- oder betreiberrelevanten Änderung unter `Unreleased`, gruppiert nach `Added`, `Changed`, `Fixed`, `Security` oder `Removed`. Rein interne Änderungen ohne erkennbare Wirkung können ausgelassen werden.
- Die erste Projektversion ist **0.1.0**; der GitHub-Release-Tag lautet **`v0.1.0`**. Erstelle den Tag erst auf dem passenden, gemergten `main`-Commit und verlinke die Changelog-Fassung.
- Verwende danach Versionen im Format `MAJOR.MINOR.PATCH`: Fehlerkorrekturen und kleine Dokumentationskorrekturen erhöhen PATCH, neue rückwärtskompatible Funktionen erhöhen MINOR, und `1.0.0` markiert den vom Nutzer freigegebenen stabilen Start. Vor `1.0.0` werden größere Änderungen über MINOR-Versionen abgebildet. Release-Tags haben stets das Präfix `v` und zeigen auf einen gemergten `main`-Commit.
- Erstelle keine GitHub-Releases oder Tags und merge keinen PR ohne den passenden, ausdrücklichen Nutzerauftrag. Bereite Changelog und PR-Informationen vollständig vor, damit die Prüfung leicht ist.
