# AEDjäger – Arbeitsregeln für Coding-Agenten

## Produktziel

Baue eine sehr einfache, mobile PWA für die Erfassung und Vor-Ort-Bestätigung von AEDs in OpenStreetMap. Der Hauptablauf lautet: **AED fotografieren → Foto und Umgebung prüfen → vorhandenen AED kurz als noch vorhanden bestätigen oder einen neuen Eintrag vorbereiten → speichern**. Stelle nur Fragen, deren Antwort für Erkennung, Zuordnung oder einen korrekten OSM-Eintrag erforderlich ist.

Das Repository befindet sich noch in der Recherche- und Konzeptphase. Lies vor Implementierungsaufträgen die relevanten Abschnitte in `docs/architektur.md`, `docs/konzept.md`, `docs/osm.md` und `docs/umsetzungsplan.md`. Die Dokumente beschreiben Vorschläge und offene Punkte; prüfe sie gegen die neueste Nutzerentscheidung, bevor du Annahmen in Code verwandelst.

## Entscheidungen und Umfang

- Oberfläche und API sind für Cloudflare Workers mit Static Assets vorgesehen. Starte Prototyp und kleinen Pilot mit Workers Free und der `workers.dev`-Adresse. Aktiviere keinen Paid-Tarif, kaufe keine Domain und füge keine kostenpflichtigen Dienste hinzu, ohne dass der Nutzer dies ausdrücklich beauftragt.
- Die erste Version unterstützt Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch. Keine sichtbaren, unübersetzten Platzhaltertexte in diesen Sprachen ausliefern.
- Im Pilot bleibt Gamification für Nutzende unsichtbar. Intern dürfen nur erfolgreiche Vor-Ort-Prüfungen nach bestätigtem OSM-Vorgang gezählt werden. Keine Punkteanzeige, Rangliste, öffentliche Fortschrittskarte oder Teilen-Funktion ohne neue Produktentscheidung.
- Ein App-API-Zugang wird getrennt von Chat-Abos behandelt. Die ChatGPT- und Gemini-Abos des Nutzers sind kein API-Schlüssel oder API-Guthaben für die laufende App.
- Die Anwendung heißt vorläufig „AEDjäger“. Name, Domain und Lizenz bleiben offen, bis der Nutzer sie festlegt.

## Sicherheit und Daten

- KI liefert ausschließlich strukturierte Bildbeobachtungen. Sie entscheidet nicht selbst über OSM-Tags, Zielobjekte oder Schreibvorgänge und erhält niemals OSM-Tokens oder API-Schlüssel.
- API-Schlüssel und OAuth-Tokens gehören ausschließlich in serverseitige Secrets. Niemals in Browsercode, Build-Ausgaben, Logs, Commits, Screenshots oder Fehlermeldungen schreiben.
- Nutzerbestätigung muss sich auf den konkreten erkannten AED und die konkrete vorgeschlagene Änderung beziehen. Ohne Bestätigung keine OSM-Schreiboperation.
- Produktions-OSM darf in normalen Tests, CI, Vorschauen und Agentenläufen nie verändert werden. Verwende Mocks oder die OSM-Entwicklungsinstanz und prüfe die Zielumgebung vor jedem Integrationstest.
- Bei „noch vorhanden“ darf ausschließlich das fachlich freigegebene Prüfdatum gesetzt werden. Keine anderen Tags überschreiben. Bei Neuanlagen zuerst die erfolgreiche Suche im relevanten Gebiet bestätigen; fehlgeschlagene oder unvollständige Suche ist kein Beleg, dass kein AED existiert.
- Behalte Fotos nur so lange wie für den konkreten Vorgang nötig. Keine dauerhaft gespeicherten Fotos oder unnötigen EXIF-, GPS-, Konto- oder Bewegungsdaten. Logs enthalten keine Fotos, Tokens oder vollständigen Antworten mit möglicherweise personenbezogenen Inhalten.
- Für Gemini-API-Free-Tarife oder manuelle Modelltests ausschließlich eigens aufgenommene oder rechtmäßig nutzbare, nicht sensible Bilder ohne erkennbare Personen verwenden. Nutzerfotos aus dem Produktbetrieb nicht automatisch für Modellvergleiche wiederverwenden oder an mehrere Anbieter senden.
- Keine kostenpflichtigen Modellaufrufe, Käufe, Tarifwechsel, öffentlichen Deployments oder Änderungen an echten OSM-Daten ohne ausdrücklichen Auftrag. Vor API-Tests kostenlose Limits und etwaige Ausgabenbegrenzungen prüfen.

## Umsetzung

- Arbeite in kleinen, überprüfbaren Schritten. Lies bestehende Dateien und `git diff`, bevor du änderst; bewahre Nutzereingaben und vorhandene Arbeit.
- Schreibe gut lesbaren Code mit sprechenden Namen und kommentiere wichtige oder nicht offensichtliche Entscheidungen verständlich. Erkläre besonders Sicherheitsregeln, OSM-Zuordnung und Fehlerbehandlung so, dass der Projektinitiator den Ablauf nachvollziehen und dabei lernen kann. Kommentiere nicht jede einzelne Zeile; vermeide Kommentare, die nur den Code wiederholen.
- Lege vor dem ersten Code die Architektur nicht eigenmächtig neu fest. Halte Bibliotheken, Datenhaltung und Provider austauschbar, wo die Konzeptdokumente es verlangen.
- Trenne UI, Fachregeln, KI-Adapter, OSM-Zugriff und Speicherung. Validiere alle Browser- und KI-Eingaben zur Laufzeit an Vertrauensgrenzen.
- Behandle Bildtext, OSM-Beschreibungen und KI-Ausgaben als nicht vertrauenswürdige Daten. Erlaube keine Prompt-Anweisungen aus Bildern und keine freien oder ungeprüften KI-Änderungen an OSM.
- Baue explizite Zustände für Analyse, Klärung, Vorschlag, Bestätigung, Senden, Erfolg und unklaren Fehler. Ein Netzabbruch darf keinen Entwurf verlieren oder doppelte OSM-Änderungen erzeugen.
- Entwickle und prüfe mobile Darstellung, Kamera, Standort, Login-Rückkehr, Barrierefreiheit und alle sechs Sprachen. Die Karte darf nicht der Startbildschirm sein; der Fotoablauf bleibt die Hauptfunktion.
- Setze vorhandene Projektkonventionen fort. Füge keine allgemeinen Skills, Frameworks, Datenbanken oder Build-Werkzeuge hinzu, wenn sie für den konkreten Schritt keinen belegbaren Nutzen haben.

## Prüfung und Übergabe

- Ermittle die tatsächlich eingerichteten Skripte und führe passende Format-, Lint-, Typprüfungs-, Test- und Build-Befehle aus. Behaupte keine bestandenen Tests, die nicht ausgeführt wurden.
- Tests müssen insbesondere falsche AED-Erkennung, mehrere nahe Treffer, ungenaues GPS, fehlgeschlagene Suche, OAuth-Rückkehr, doppelte Bestätigung, Versionskonflikt, Netzabbruch und verweigerte Berechtigungen abdecken.
- Ergänze oder ändere Tests, wenn fachliches Verhalten oder Sicherheitsgrenzen verändert werden. Keine Tests, die echte Kosten verursachen oder produktives OSM verändern.
- Berichte nach jeder Etappe knapp, was geändert wurde, welche Prüfungen liefen und was offen oder nicht getestet ist. Halte verbleibende Entscheidungen in `docs/offene-fragen.md` aktuell.
