# Umsetzung durch einen AI-Agenten

> **Aktueller Pilotentscheid (9.11.2026):** Der aktuelle Fotoablauf kommt ohne externe Bilddienste aus: Foto/EXIF bleiben lokal, die Person bestätigt selbst die Sichtbarkeit von AED oder Gehäuse; Foto-GPS hat Vorrang, Handy-GPS/Karte erfordern bewusste Auswahl. Die Umgebungssuche liest den AED-Layer aus dem bestehenden OpenFireMap-PMTiles-Archiv und lädt nur die Standortkacheln per HTTP Range. Frische Metadaten und Länderextrakte werden vor der Suche geprüft. Veraltete, fehlende, unvollständige oder widersprüchliche Daten sperren die Neuanlage; es gibt keinen Overpass-Fallback und keinen separaten AED-Feed. Der Live-Range-Abruf und der vollständige mobile Ablauf sind noch zu prüfen. Ältere KI-/Overpass-Etappen unten sind historische Dokumentation, keine aktuellen Laufzeit- oder Testanforderungen.

Stand: 9.11.2026. Ergänzung zum [Architekturentwurf](architektur.md). Der Worker liest die AED-Vektorebene aus dem bestehenden PMTiles-Archiv. Der lokale Build lief erfolgreich; ein Live-Range-Abruf und ein mobiler Ende-zu-Ende-Test wurden noch nicht ausgeführt. Es gab kein Deployment und keinen OSM-Schreibvorgang. Für den aktuellen Datenvertrag siehe [OSM-Datenzugriff](osm.md).

**Aktueller Stand, 8.11.2026:** Die OSM-Dev-Anmeldung und eine Bildbeobachtung liefen in der veröffentlichten App. Zwei echte lesende Umgebungssuchen mit Foto-GPS scheiterten mit einer allgemeinen Verfügbarkeitsmeldung; OSM blieb unverändert. Ein datensparsamer Diagnoseeintrag mit Fehlercode, Status und Laufzeit wird ergänzt, um die Fehlerquelle beim nächsten Versuch erkennen zu können.

## Veröffentlichung auf Cloudflare

Die CI prüft Pull Requests und Commits auf `main`. Nach einem Merge startet der Push auf `main` den Deploy automatisch, sobald die komplette CI erfolgreich ist. Der Workflow **CI** lässt sich zusätzlich manuell auf `main` starten; dafür muss `deploy_to_workers` ausdrücklich bestätigt werden. Der Deploy-Job baut und prüft den Worker erneut und ruft anschließend `wrangler deploy` auf. Er nutzt die GitHub-Umgebung `production`, ist serialisiert und veröffentlicht ausschließlich die bestehende `workers.dev`-Adresse; er führt keine D1-Migrationen aus und ändert keine OSM-Daten. Falls für `production` verpflichtende Reviewer konfiguriert sind, bleibt deren Freigabe vor dem eigentlichen Deploy erforderlich.

Vor dem ersten Lauf muss in den Repository-Einstellungen die GitHub-Umgebung `production` angelegt werden. Als erforderliche Reviewerin ist `@FrnkMrz` einzutragen; „Prevent self-review“ bleibt aus, damit der Kontoinhaber den eigenen Deploy freigeben kann. Die Umgebung sollte nur `main` als Deployment-Branch erlauben. Danach in dieser Umgebung das Secret `CLOUDFLARE_API_TOKEN` und die Variable `CLOUDFLARE_ACCOUNT_ID` hinterlegen. Das Cloudflare-Token soll nach Cloudflares Vorlage **Edit Cloudflare Workers** erstellt und auf das AEDjaeger-Konto beschränkt werden. Tokenwerte gehören ausschließlich in GitHub Environment Secrets, niemals in Issues, Chat, Workflow-Dateien oder Logs.

## Reihenfolge und aktueller Stand

| Schritt | Ergebnis | Status |
| --- | --- | --- |
| A. Bedienprototyp | Mobil nutzbarer Fotoablauf mit simulierten Treffern, Rückfragen und Fehlern; sechs Sprachen | Begonnen |
| B. Vor-Ort-Prüfung | Schmale Browseransicht, Info-Texte in sechs Sprachen, Auswahlablauf und Offline-Cache automatisiert geprüft; Kamera, Lesbarkeit und Berechtigungen auf echten Mobilgeräten | Teilweise: Fotoaufnahme und Fotoauswahl wurden lokal auf einem Handy geprüft; die öffentliche PWA ist erreichbar. Der neue Testablauf erklärt Beispieldaten und bietet optionale, datensparsame Diagnose-Logs. Android/iPhone, Berechtigungen, PWA-Installation und Offlinebetrieb bleiben zu prüfen |
| C. Frühe Erkennungsvorprüfung (historisch) | Damalige qualitative Modellprüfung | Kleine externe Modelltests waren kein kontrollierter Genauigkeitsnachweis und sind keine App-Laufzeitfunktion. Historische Auswertung: [Bildtest](bildtest.md). |
| D. API-Vorschau (historisch) | Früherer Bildanalyse- und Overpass-Prototyp | Dieser Ablauf ist durch manuelle Sichtbestätigung und den PMTiles-Consumer ersetzt. Der Live-Range-Abruf und der mobile Ende-zu-Ende-Ablauf sind noch separat zu prüfen. |
| E. OSM-Testumgebung | Änderungsvorschau und bestätigte Schreibvorgänge ausschließlich gegen OSM-Entwicklungsinstanz | Vorschau und Schreibwege für Prüfdatum sowie Neuanlage sind umgesetzt und fest auf `master.apis.dev.openstreetmap.org/api/0.6` begrenzt. Beide Wege bleiben zusätzlich zum getrennten Entwicklungslogin durch `OSM_DEV_WRITES_ENABLED` abgeschaltet. Der Login wurde in der workers.dev-App erfolgreich bestätigt. Vor Neuanlage prüft der Server den kleinen Kartenausschnitt erneut; unvollständige Antworten und neue oder ungeprüfte AEDs blockieren den Vorgang. Dieser PR ergänzt den ausdrücklichen Weg, nach vollständiger Suche alle angezeigten nahen AEDs als andere Geräte zu bestätigen und anschließend eine Neuanlage vorzubereiten. Vorgangs-ID, Changeset und erkannte Node-ID werden in D1 gespeichert, damit unklare Uploads abgeglichen und nicht blind wiederholt werden. Automatisierte Tests verwenden ausschließlich simulierte OSM-Antworten; es wurde kein OSM-Objekt verändert. Vor einem echten Schreibtest braucht es weiterhin eine gesonderte Freigabe von `OSM_DEV_WRITES_ENABLED=true`. |
| F. Kleiner Pilot | Begrenzter Betrieb, Kosten- und Qualitätsauswertung, reale Geräteprüfung | Offen |

Im ersten Code-Schritt ist Vite mit TypeScript ohne React gewählt. Der lokale Prototyp benötigt keine UI-Bibliothek; der App-Zustand bleibt in einem kleinen Fachmodul, damit Worker-, Feed- und OSM-Adapter getrennt bleiben. Produktive Dienste werden erst nach Abschluss und Prüfung der vorherigen Schritte angeschlossen.

## Rollen und Werkzeuge

Der Projektinitiator beschreibt gewünschtes Verhalten, bewertet vorzeigbare Ergebnisse und entscheidet über Konten, Ausgaben und Veröffentlichung. Der programmierende AI-Agent übernimmt Code, Tests, Konfiguration, Dokumentation und Fehlerbehebung. Er muss dafür Zugriff auf das Repository und eine Ausführungsumgebung haben; ein Chat, der nur Code ausgibt, erledigt diese Arbeit nicht vollständig.

ChatGPT/Codex kann bei vorhandenem Repository- und Werkzeugzugriff Code, Tests und Dokumentation bearbeiten. Chrome dient zum Prüfen des Browserablaufs. Der aktuelle Pilot benötigt keinen Bildanbieter, keinen API-Schlüssel und keine Modell-API. Die unten beschriebenen Bildtests und Anbieteraussagen sind ausschließlich historische Ergebnisse.

Nicht mehrere Agenten unkoordiniert dieselben Dateien ändern lassen. Eine zweite Prüfung kann nützlich sein, muss aber einen klaren Auftrag und denselben Referenzstand bekommen. Besonders kritisch sind Anmeldung, Kostenlimits, Zuordnung und OSM-Schreibvorgänge.

## Sprachen im Entwicklungsauftrag

Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch gehören zur ersten Version. UI-Texte nicht auf Sichtbarkeit hin vervollständigen: Kamerazugriff verweigert, OSM-Login abgelaufen, Verbindung unterbrochen, Ergebnis unklar und Wiederherstellung müssen in allen sechs Sprachen funktionieren. Jede Sprache benötigt echte Tests im schmalen Mobilbildschirm. Kein automatisches Übersetzen in der Laufzeit.

Der Agent verwaltet die sechs Sprachdateien mit stabilen Schlüsseln und einer automatischen Vollständigkeitsprüfung. Der deutsche Ausgangstext wird gemeinsam geprüft, bevor derselbe Text in fünf weiteren Dateien verbreitet wird. Für Japanisch insbesondere Schriftgröße und Zeilenumbruch, für Polnisch und Französisch Sonderzeichen sowie Textlänge kontrollieren. Auch spätere Gamification-Kurztexte erhalten von Beginn an Übersetzungen, selbst wenn die entsprechende Funktion im Pilot noch verborgen bleibt.

## Gamification sauber klein halten

Das [AED-Signalnetz](gamification.md) bleibt für Nutzende im Pilot vollständig unsichtbar. Im Pilot werden erfolgreiche Vor-Ort-Prüfungen intern erst nach bestätigtem OSM-Vorgang gezählt. Es gibt keine Punkteanzeige, öffentliche Fortschritte oder Teilfunktion. Eine spätere sichtbare Funktion benötigt eine eigene Entscheidung und Datenschutzprüfung. Zählfehler oder ausgeschaltete Gamification dürfen niemals Fotoablauf, OSM-Upload oder Wiederherstellung blockieren.

## Phase 1: Historische externe Erkennungsvorprüfung (abgelöst)

**Historischer Bericht:** Die folgenden Hinweise dokumentieren abgeschlossene frühe Tests. Sie sind kein aktueller Auftrag, keine Laufzeitfunktion und keine Voraussetzung für den Pilot. Weitere externe Bildtests sind nicht Teil des Produkts.

Die früheren externen Bildtests und ihr Bewertungsbogen sind als Recherche dokumentiert, aber kein Teil des jetzigen Umsetzungsplans. Im aktuellen Ablauf bleibt das Foto samt EXIF auf dem Gerät; die Person bestätigt selbst, ob AED oder AED-Gehäuse sichtbar sind. Diese Bestätigung ist keine automatische Erkennung und darf nicht als solche bezeichnet werden.

Mit zunächst etwa 30–50 eigenen oder rechtmäßig nutzbaren Bildern anfangen. Positive Fälle: verschiedene Geräte, durch Glas sichtbare Geräte, Außenwand und Innenraum. Negative oder unklare Fälle: Wegweiser, geschlossener Kasten, leere Halterung, Poster, Bildschirmfoto, Feuerlöscher, mehrere Geräte, Reflexionen, Dunkelheit und Unschärfe.

Zu jedem Bild unabhängig festhalten, was tatsächlich sichtbar und lesbar ist. Einen Teil der Standorte ausschließlich zur Bewertung zurückhalten; Fotos desselben Geräts nicht auf Lern- und Prüfmenge verteilen. Das verhindert, dass die Erkennung nur bekannte Beispiele wiedererkennt.

Messen: falsche Gerätebestätigung, unberechtigte Zuordnung, erforderliche Rückfragen, korrekt übernommene Felder, Wartezeit und Kosten. Eine selbst gemeldete KI-Sicherheit von „99 %“ zählt nicht als gemessene Zuverlässigkeit. In der kleinen Testmenge darf kein klar negativer Fall als sichere Bestätigung durchgehen; selbst null beobachtete Fehler sind noch kein Beweis allgemeiner Fehlerfreiheit.

Die erste ChatGPT-Runde ist wegen abweichender Prompts und gemeinsamem Gesprächskontext nur explorativ; sie zeigt vor allem, dass die Sollklassen „AED-Gehäuse“ und „Defibrillator sichtbar“ getrennt annotiert werden müssen. Der anschließende API-Test mit GPT-6 Luna verwendete drei positive Testbilder in einer Anfrage und erkannte alle drei als AED. Das ist kein API-Benchmark: negative Fälle, unsichere Bilder, Wiederholungen und unabhängige Sollannotation fehlen. Als nächstes den Datensatz gezielt um diese Fälle erweitern, bevor Zuverlässigkeitsaussagen oder ein Pilot erfolgen. Weitere Fotos nur nach gesonderter Freigabe an einen Anbieter senden. Höhere OpenAI-Modelle nicht verwenden.

## Phase 2: Bedienbarer Ablauf mit simulierten Diensten

**Ergebnis:** Eine Vorschau auf dem Handy: Foto, manuelle Sichtbestätigung, Prüfung des AED-Layers am Foto-Standort, Ergebnis und kurze Bestätigung. Beide Hauptfälle funktionieren mit festen Testdaten.

Der Agent implementiert explizite Zustände: bereit, Aufnahme, Analyse, Klärung nötig, Vorschlag bereit, Senden, Ergebnis unklar, gespeichert, wiederholbarer Fehler. Ungültige Übergänge sind nicht erlaubt. Ein Reset während eines unklaren Uploads darf die Wiederherstellung nicht verlieren.

Abnahme: Auf einem einfachen Fall ist nach dem Foto nur eine Speicherbestätigung nötig. Eine fehlende optionale Angabe erzeugt keine Frage. Mehrere plausible AEDs erzeugen eine kurze Auswahl. Fehlermeldungen sind verständlich und erhalten den Entwurf.

## Phase 3: Historischer Prototyp mit externem Bilddienst (abgelöst)

**Historischer Stand:** Die folgenden Absätze beschreiben den früheren Ansatz. Er gehört nicht zum aktuellen Pilot: keine externe Bildanalyse, keine OpenAI-Integration und keine Anbieter-API als Laufzeitvoraussetzung.

Die damalige Umsetzung enthielt einen OpenAI-Adapter und eine Overpass-Suche. Beides wurde durch spätere Produktentscheidungen aus dem aktiven Fotoablauf entfernt. Der Pilot übermittelt kein Bild an Anbieter und sucht AEDs direkt im Layer `defibrillators` des bestehenden OpenFireMap-PMTiles-Archivs. Der Worker validiert Metadaten, Länderextrakte, Alter und Archivabdeckung und liest benötigte Kacheln per HTTP Range. Fehler oder unvollständige Daten sperren eine Neuanlage. Ein Live-Range-Abruf und der mobile Ende-zu-Ende-Ablauf sind noch zu prüfen. OSM-Schreibrouten bleiben separat über `OSM_DEV_WRITES_ENABLED` abgeschaltet. Schlüssel, Koordinaten, Fotos und Antworttexte gehören nicht in Logs.

Abnahme: Fotos und EXIF bleiben lokal; es gibt keine Bilddienst- oder Anbieter-API. Die Umgebungssuche startet nur nach ausdrücklichem Tastendruck. GPS-Koordinaten werden zuerst lokal dem Foto entnommen; bei fehlenden Koordinaten wird der Handy-Standort nur nach ausdrücklicher Auswahl abgefragt. Ein verweigerter Standortzugriff sendet keine Suchanfrage. Die Person bestätigt selbst, ob ein AED-Gerät oder AED-Gehäuse sichtbar ist; bloßes Schild, leere Halterung oder unklare Fotos gelten nicht automatisch als AED. Mögliche Feed-Treffer verlangen menschliche Prüfung. Ein fehlgeschlagener, veralteter oder unvollständiger Snapshot erzeugt keinen Neuanlagevorschlag. Foto- und Token-Inhalte erscheinen nicht in Logs.

## Phase 4: OSM-Schreiben in der Testumgebung

**Ergebnis:** Neuanlage und Existenzbestätigung funktionieren gegen die separate OSM-Entwicklungsinstanz.

Der Agent richtet dafür eigene Testkonten und OAuth-Konfigurationen soweit mit den verfügbaren Zugängen möglich ein. Reale Zugangsschritte oder erforderliche Kontobestätigungen übernimmt der Inhaber. Vor dem bestätigten OSM-Schreibvorgang gibt es genau eine kurze, verständliche Bestätigung. Staging darf auch durch eine falsch gesetzte Frontendvariable nicht unbemerkt produktiv schreiben.

Pflichtfälle:

**Automatisiert umgesetzt:** Ein bestehender AED kann nach ausdrücklicher Bestätigung ausschließlich auf dem festen OSM-Testserver mit `check_date` aktualisiert werden. Die Route liest das konkrete OSM-Objekt erneut, prüft AED-Tag und bisheriges Prüfdatum, übernimmt alle übrigen Tags unverändert und gleicht unklare Uploads ab. Die Kandidatensuche liest AED-Knoten aus der `defibrillators`-Ebene des PMTiles-Archivs; sie verwendet weder Overpass noch einen separaten AED-Feed. Für Neuanlagen prüft der Server direkt vor dem Schreiben einen kleinen aktuellen OSM-Kartenausschnitt erneut; das ist eine gezielte Schutzprüfung und kein großflächiger Suchdienst. Eine fehlgeschlagene oder unvollständige PMTiles-Suche erlaubt schon vorher keinen Neuanlagevorschlag. Bereits angezeigte Treffer werden erst toleriert, wenn die Person ausdrücklich bestätigt hat, dass keiner davon das fotografierte Gerät ist; neue oder ungeprüfte AEDs, ein Fehler oder eine ungültige Antwort blockieren den Vorgang weiterhin. Der Schreibvorschlag enthält nur `emergency=defibrillator` und `check_date`; ein optionaler Standorttext bleibt leer, solange der Nutzer ihn nicht ausdrücklich bestätigt. Ein bestätigter Klick sendet genau eine Node-Erstellung an den Testserver. Bei Verbindungsabbruch schließt die Wiederaufnahme zuerst das ursprüngliche Changeset und gleicht danach dessen stabilen Inhalt ab: Ein gefundener Node wird bestätigt, ein gültig leerer Changeset wird atomar als fehlgeschlagen beendet, und ein unvollständiger oder widersprüchlicher Abruf bleibt unklar. Uploads werden nicht blind wiederholt. Bleibt ein Vorgang vor dem Upload länger als zwei Minuten ohne Statusfortschritt, beendet eine atomare Prüfung ihn als fehlgeschlagen; noch laufende Anfragen erneuern ihren Status und können durch diesen Abbruch nicht fortfahren. Beide Schreibwege benötigen zusätzlich zur Entwicklungsanmeldung `OSM_DEV_WRITES_ENABLED=true`; Standard ist aus. Migration 0009 ergänzt die Ergebnis-Node-ID zur Wiederherstellung. Der Worker ist veröffentlicht; es gab keinen echten OSM-Schreibtest. |

- Eine Existenzbestätigung ändert ausschließlich das vorgesehene Datum.
- Zweimal Tippen oder paralleles Wiederholen erzeugt keinen zweiten Vorgang.
- Ein erfolgreicher Upload mit verlorener Antwort wird erkannt, ohne erneut anzulegen.
- Ein Datum wird durch einen älteren Entwurf nicht zurückgesetzt.
- Zusätzliche Tags und fremde Bearbeitungen bleiben erhalten.
- Geänderte Objektidentität, Löschung oder Versionskonflikt führen zu einer erneuten Prüfung.
- Fehlgeschlagenes Changeset-Schließen wiederholt keinen bereits erfolgreichen Objekt-Upload.
- Eine Neuanlage wird bei einem nicht geprüften nahen AED, einer unvollständigen API-Antwort oder einem Netzwerkfehler sicher abgebrochen. Bereits gezeigte und ausdrücklich abgelehnte Treffer dürfen den Vorgang nicht blockieren.
- Eine verlorene Antwort nach einer Neuanlage wird über das ursprüngliche Changeset abgeglichen; es erfolgt kein zweiter Node-Upload.
- Fehlende Sitzung, Providerfehler, Rate-Limit und Datenbankfehler ergeben nachvollziehbare Zustände.

Die OSM-Entwicklungsinstanz hat eine eigene Datenbank und eigene Konten; sie ist nicht mit produktivem OSM gleichzusetzen. [OSM OAuth](https://wiki.openstreetmap.org/wiki/OAuth)

## Phase 5: Kleiner realer Pilot

**Ergebnis:** Wenige freigeschaltete Nutzer erfassen tatsächlich besuchte Geräte. Die ersten Änderungen werden einzeln in OSM nachkontrolliert.

Jetzt echte Android-Geräte mit Chrome und echte iPhones im Browser sowie als installierte PWA prüfen. Playwright-WebKit ist hilfreich, ersetzt aber nicht iPhone-Kamera, GPS, Betriebssystemdialoge und App-Wechsel. Ein AI-Agent kann simulierte Tests ausführen; reale Vor-Ort-Beobachtung und Hardwaregrenzen müssen durch jemanden vor Ort überprüft werden.

Als vorläufige Produktziele für eindeutige Fälle: genau ein Bestätigungsschritt nach dem Foto und auf brauchbarem Mobilfunk typischerweise unter zehn Sekunden bis zum Vorschlag. Das sind Zielwerte, keine garantierten Leistungsangaben. Median, langsame Fälle und Rückfragequote getrennt berichten. Geschwindigkeit nicht durch riskantere Zuordnungen erkaufen.

Vor dem Pilot ist zusätzlich die reale PWA auf mindestens einem Android-Handy und einem iPhone durchzugehen: Kameraaufnahme, verweigerte und später erteilte Berechtigungen, Wechsel zurück zur App, Standortfreigabe, Schrift-/Zeilenumbrüche und Wiederaufnahme nach Verbindungsabbruch. Die automatisierte Playwright-Prüfung deckt wiederholbare Browserabläufe und schmale Ansichten ab, nicht Hardware oder Betriebssystemdialoge.

Vor öffentlicher Freigabe: reale Kosten je Erfassung, Fehlerquote, Loginprobleme und Datenqualität bewerten. Das Projekt in der OSM-Community nachvollziehbar vorstellen; keine automatischen Forenbeiträge ohne ausdrücklichen Auftrag.

## Arbeitsregeln für den programmierenden Agenten

Die verbindlichen Arbeitsregeln für Agenten stehen in der Repository-Root-Datei [`AGENTS.md`](../AGENTS.md). Die folgenden Punkte erklären ergänzend, woran die Implementierung gemessen wird.

1. Ein kleiner, vorführbarer Funktionsschritt pro Änderung. Kein Gesamtsystem auf einmal generieren.
2. TypeScript streng prüfen; Eingaben an Servergrenzen auch zur Laufzeit validieren.
3. Fachlogik für Erkennungsauswertung, Zuordnung und OSM-Patches getrennt von UI und Providercode halten.
4. Vor jedem Schritt konkrete Akzeptanzfälle definieren. Tests müssen fachliche Ergebnisse prüfen, nicht die gerade geschriebene Implementierung nacherzählen.
5. Kein echter OSM-Schreibtest in normalen CI-Läufen. Dienste simulieren; Integrationsprüfungen getrennt und kontrolliert.
6. Modell- und Promptversion gemeinsam dokumentieren. Ein Wechsel erfordert die erneute Auswertung des Bildtestsatzes.
7. Keine Secrets in Git, Browsercode oder öffentliche Vorschauen. Fremde Pull Requests erhalten keine Produktionszugänge.
8. Jede Änderung muss Formatierung/Lint, Typprüfung, relevante Tests und Build bestehen. Änderungen an den Hauptabläufen benötigen mobile End-to-End-Prüfungen.
9. Der Agent liefert eine Vorschau, eine kurze verständliche Änderungserklärung und bekannte Grenzen. Fehlende Messungen oder Gerätetests werden offen benannt.
10. Releases müssen auf den vorherigen Stand zurücksetzbar sein. Datenbankänderungen möglichst rückwärtskompatibel ausführen und Wiederherstellung praktisch erproben.

Historisch vorgeschlagene Struktur, inzwischen teilweise umgesetzt; der aktuelle PMTiles-Consumer liegt in `server/osm/staticCandidateSearchRoute.ts`, die providerunabhängigen Regeln in `src/domain/` und die Antworttypen in `src/osm/candidateTypes.ts`:

```text
src/ui/             Ansichten, Kamera, lokale Entwürfe
src/domain/         Zustände, Kandidatenvergleich, erlaubte Änderungen
src/contracts/      versionierte Anfrage- und Antwortschemas
server/auth/        OSM-Anmeldung und Sitzungen
server/osm/         PMTiles-AED-Suche, OSM-Versionen, Changesets, Wiederherstellung
server/storage/     Vorgangsstatus und Verbrauchsgrenzen
migrations/         Datenbankänderungen
tests/              Fachfälle, Fehlerfälle, Browserabläufe
evals/              rechtmäßig nutzbare Bildfälle und Bewertungsregeln
```

## Betrieb so klein wie möglich halten

GitHub Actions prüft Änderungen; ein zusammenhängendes Release veröffentlicht UI und API. Wrangler ist mit `keep_vars` konfiguriert, damit separat im Cloudflare-Dashboard gepflegte Pilotvariablen wie OAuth-Client-ID, Callback und Abschalter bei einem Code-Deployment erhalten bleiben. Secrets bleiben separat serverseitig gespeichert. Für Prototyp und kleinen Pilot zuerst Cloudflare Workers Free und die bereitgestellte `workers.dev`-Adresse verwenden. Workers Paid (mindestens 5 USD pro Monat) und eine eigene Domain sind spätere Optionen, falls ein konkreter Bedarf entsteht. Vor größerem öffentlichen Start die Domain festlegen, da ein späterer Wechsel Installation, Sitzungen und lokal gespeicherte Entwürfe beeinflusst.

Nur wenige Betriebswerte erfassen: Analysezeiten, Fehlerarten, Budgetverbrauch, unklare Uploads und App-/Modellversion. Keine Bewegungsprofile und keine dauerhaft gespeicherten Fotos. Ein Fehlerhinweis kann eine Vorgangsnummer enthalten, damit der Agent den technischen Status prüfen kann, ohne das Bild erneut zu veröffentlichen.

Abschalter für Analyse und OSM-Schreiben, ein dokumentierter Rückweg zur letzten Version und ein getesteter Wiederherstellungsweg gehören zum ersten produktiven Release. Eine Wiederherstellung der eigenen Datenbank macht bereits geschriebene OSM-Änderungen nicht rückgängig; unklare Vorgänge müssen danach erneut mit OSM abgeglichen werden.

## Was der Projektinitiator bereitstellen muss

Kein Quellcode. Hosting-Richtung Cloudflare und Bestätigungsablauf für OSM sind entschieden. Später benötigt werden Domain, sichere Kontozugänge, Prüfung der verfügbaren API-Guthaben und ausgewählte, rechtmäßig nutzbare Testfotos. Vorhandene Chat-Abos allein ersetzen keinen eingerichteten KI-API-Zugang. Eine kurze Erprobung am Handy ist für Kamera, Standort und Browserberechtigungen nötig; technische Vorbereitung und Auswertung übernimmt der Agent.
