# AEDjaeger – Übergabe an den nächsten Agenten

Stand: **10. November 2026**  
Repository: [FrnkMrz/AEDjaeger](https://github.com/FrnkMrz/AEDjaeger)  
App: [aedjaeger.aedjaeger.workers.dev](https://aedjaeger.aedjaeger.workers.dev)

Dieses Dokument ist die kompakte, aktuelle Übergabe für einen neuen Chat oder einen anderen Coding-Agenten. Es fasst die in diesem Projekt getroffenen Produktentscheidungen, den tatsächlichen technischen Stand und den nächsten sinnvollen Schritt zusammen. Bei Widersprüchen haben die neueren Produktentscheidungen und die Dateien unter „Weiterlesen“ Vorrang vor älteren historischen Abschnitten.

## Ziel und gewünschter Ablauf

AEDjaeger soll vor Ort mit möglichst wenigen Schritten helfen, einen AED in OpenStreetMap zu erfassen oder einen bestehenden Eintrag zu bestätigen:

1. Mit OpenStreetMap anmelden. Ohne Anmeldung sind Foto und Arbeitsablauf gesperrt.
2. AED oder AED-Gehäuse fotografieren oder ein vorhandenes Foto auswählen.
3. Die Person bestätigt selbst, dass AED oder Gehäuse auf dem Foto sichtbar ist.
4. Die App verwendet zuerst GPS aus dem Foto. Falls kein Foto-GPS vorhanden ist, darf sie Handy-GPS oder eine Kartenposition nur nach ausdrücklicher Auswahl der Person nutzen.
5. AEDs in der Nähe abgleichen.
6. Bei einem eindeutig passenden vorhandenen AED nur dessen Vorhandensein mit `check_date` bestätigen. Bei keinem passenden Treffer nach erfolgreicher, vollständiger Suche eine Neuanlage vorbereiten.
7. Vor jeder OSM-Änderung die konkrete Änderung zeigen und ausdrücklich bestätigen lassen.

Die Karte ist Hilfsmittel für die Standortkorrektur, nicht der Startbildschirm. Die App soll nur Fragen stellen, die für Zuordnung oder korrekte OSM-Daten nötig sind.

## Beschlossene Produkt- und Sicherheitsregeln

- Produktname in allen Sprachen: **AEDjaeger** (ohne Umlaute).
- Erste Sprachversionen: Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch.
- Pilot ohne OpenAI, ohne andere externe Bilddienste und ohne automatische Bildanalyse. Das Foto und seine EXIF-Daten bleiben lokal auf dem Gerät. Die App darf nicht behaupten, eine KI habe das Bild erkannt.
- Im Pilot bleibt Gamification unsichtbar. Intern dürfen nur erfolgreiche Prüfungen nach bestätigtem OSM-Vorgang gezählt werden.
- Oberfläche und API laufen als Cloudflare Worker mit Static Assets auf der vorhandenen `workers.dev`-Adresse; D1 hält notwendige Sitzungs- und Vorgangsdaten. Kein Paid-Tarif und keine eigene Domain ohne gesonderten Auftrag.
- OSM-Login ist erforderlich. Der aktuelle Login ist für die OSM-Entwicklungsumgebung (Dev) gedacht. Geheimnisse und OAuth-Tokens dürfen ausschließlich in serverseitigen Secrets bzw. verschlüsselter Sitzung liegen.
- `OSM_DEV_WRITES_ENABLED` bleibt **aus**. Es dürfen keine echten OSM-Schreibvorgänge ohne gesonderte Freigabe stattfinden. Normale Tests verwenden Mocks oder OSM Dev, niemals produktives OSM.
- Die Umgebungssuche ist fehlertolerant, aber fail-closed: Ein Timeout, eine veraltete Quelle oder eine unvollständige Abdeckung bedeutet „Suche fehlgeschlagen“, niemals „hier gibt es keinen AED“.
- Bei „noch vorhanden“ ausschließlich `check_date` ändern. Bei Neuanlage vor dem Schreiben die Gegend erneut prüfen und keine vorhandenen/fremden Tags überschreiben.

## Was aktuell tatsächlich läuft

- PR [#49](https://github.com/FrnkMrz/AEDjaeger/pull/49) („AED-Umgebungssuche direkt aus PMTiles lesen“) wurde am **9. November 2026** gemergt. Merge-Commit: [00c953b](https://github.com/FrnkMrz/AEDjaeger/commit/00c953bdab32bc94909c031a3df2294fd56730c1).
- Der GitHub-Actions-Lauf [#234](https://github.com/FrnkMrz/AEDjaeger/actions/runs/42672639423) war erfolgreich; CI und Cloudflare-Deploy sind grün. Die App wurde auf die bestehende workers.dev-Adresse deployed.
- Der aktuelle Stand ersetzt die Overpass-Umgebungssuche durch den AED-Layer im bestehenden OpenFireMap-PMTiles-Archiv. Die konkrete Live-Suche nach diesem Deploy wurde auf einem echten Handy noch nicht als erfolgreich bestätigt.
- OSM-Schreiben bleibt gesperrt. Der nächste Test ist daher ein **lesender** Abgleich, keine Neuanlage und kein Update.
- Ein bereits früher beobachteter Fehler „Umgebungssuche vorübergehend nicht erreichbar“ gehört zu einem älteren Suchlauf. Er muss nach dem neuen Deploy erneut geprüft werden; er beweist nicht, dass der neue PMTiles-Zugriff funktioniert oder fehlschlägt.

## Wie die Datenquelle funktioniert – und was sie nicht bedeutet

AEDjaeger fragt direkt das bestehende Archiv unter [pipeline.openfiremap.org/openfiremap.pmtiles](https://pipeline.openfiremap.org/openfiremap.pmtiles) ab. Der Worker lädt nicht die gesamte Datei: Er prüft frische Metadaten und liest nur die benötigten Zoom-14-Kacheln um den gewählten Standort per HTTP Range aus der Ebene `defibrillators`. Dabei werden Datenalter, Länderextrakte, Abdeckung und Antworten kontrolliert. Ein Fehler oder eine unvollständige Abdeckung sperrt die Suche bzw. Neuanlage.

Das ist eine **lesende Datenquelle**. AEDjaeger startet, betreibt oder verändert die OpenFireMap-Datenpipeline nicht. Diese App hat keine Verbindung zu Proxmox oder VM102; die gleichzeitige Arbeit an `pipeline.openfiremap.org` ist kein AEDjaeger-Deployment. Die AEDjaeger-Web-App wird separat über das GitHub-Repository `FrnkMrz/AEDjaeger` nach Cloudflare deployed.

OpenStreetMap Devs begrenzter `/api/0.6/map.json`-Endpunkt dient zusätzlich dazu, eine leere PMTiles-Suche für eine angemeldete Dev-Sitzung in einem kleinen Gebiet abzusichern. Das ist kein Overpass und ersetzt nicht die PMTiles-Kandidatensuche. In Produktion wird eine nicht sicher bestätigte leere Suche abgelehnt. Es gibt keinen Overpass-Fallback und keinen separaten AED-Feed.

**Bekannte Grenze:** AEDjaeger bleibt für Kandidaten auf die Verfügbarkeit, Aktualität und Abdeckung des PMTiles-Archivs angewiesen. Das vermeidet die Overpass-Abhängigkeit, garantiert aber keine erfolgreiche Suche, wenn das Archiv oder sein Host ausfällt. Ein Fehler muss sichtbar bleiben; nicht als leere Trefferliste behandeln.

## Was der Nutzer als Nächstes tun soll

1. Auf dem Handy die App unter [aedjaeger.aedjaeger.workers.dev](https://aedjaeger.aedjaeger.workers.dev) öffnen und auf dem OSM-Testserver anmelden.
2. Ein echtes AED-Foto auswählen, bei dem GPS-Metadaten vorhanden sind; danach AED/Gehäuse-Sichtbarkeit bestätigen.
3. Die Umkreissuche starten. Prüfen, ob die App die Position aus dem Foto meldet und ob nahe AED-Kandidaten erscheinen.
4. Nur die Anzeige und den Abgleich prüfen. **Nicht erwarten, dass bereits in OSM geschrieben wird:** Dev-Schreiben ist noch abgeschaltet.
5. Bei einem Fehler Zeitpunkt, genaue Fehlermeldung und ob „Standort aus dem Foto verwendet“ angezeigt wurde notieren. Keine Tokens oder Schlüssel teilen.

Wenn die Suche gelingt, nächste technische Etappe: den gefundenen Kandidaten verständlich anzeigen und den Weg „vorhanden bestätigen“ bzw. „keinen der Treffer erkannt“ → Standort prüfen → Neuanlage vorbereiten Ende-zu-Ende gegen OSM Dev validieren. Erst danach und nur nach ausdrücklicher Freigabe den Dev-Schreibschalter aktivieren und eine einzelne kontrollierte Teständerung mit dem Nutzer durchführen. Produktions-OSM bleibt tabu.

## Arbeitsanweisung für den nächsten Agenten

- Beginne mit dem **aktuellen `main`** und lies zuerst [Architektur](architektur.md), [Konzept](konzept.md), [OSM-Datenzugriff](osm.md), [Umsetzungsplan](umsetzungsplan.md) und [offene Fragen](offene-fragen.md).
- Überprüfe GitHub PR-/Actions-Stand und den tatsächlichen Cloudflare-Stand, bevor du Fehler als aktuell annimmst. Die Unterhaltung enthält ältere, inzwischen überholte Screenshots und Fehler.
- Konzentriere dich auf den nächsten Nutzerablauf: reale mobile PMTiles-Suche nach dem Deploy. Keine neuen Pipeline-/VM-Aufgaben, keine automatische KI, keine Anbieter-API und keine allgemeinen Umbauten ohne konkreten Blocker.
- Ändere Dateien auf einem eigenen `codex/*`-Branch und eröffne erst nach vollständiger Prüfung einen detailliert beschriebenen PR gegen `main`. Nie direkt auf `main` pushen; niemals selbst mergen oder Releases/Tags erstellen.
- Halte `CHANGELOG.md` und `docs/offene-fragen.md` aktuell. Schreibe Code und Dokumentation verständlich auf Deutsch und kommentiere nicht offensichtliche Sicherheits- und OSM-Regeln.
- Keine kostenpflichtigen Aufrufe, Secrets, öffentlichen Deployments oder OSM-Schreibvorgänge ohne ausdrücklichen Auftrag.

## Weiterlesen

- [Produktkonzept](konzept.md)
- [Architektur und Betrieb](architektur.md)
- [OSM-Datenmodell und Datenzugriff](osm.md)
- [Umsetzungsplan](umsetzungsplan.md)
- [Offene Fragen und nächste Schritte](offene-fragen.md)
- [Changelog](../CHANGELOG.md)
- [CI/Deploy-Workflow](../.github/workflows/ci.yml)
