# Umsetzung durch einen AI-Agenten

Stand: 17.10.2026. Ergänzung zum [Architekturentwurf](architektur.md). Die Phasen ordnen die Umsetzung in überprüfbare Etappen. Phase 2 ist als lokaler UI-Prototyp begonnen; es gibt noch keine echte KI-, Standort-, Konto- oder OSM-Anbindung.

## Reihenfolge und aktueller Stand

| Schritt | Ergebnis | Status |
| --- | --- | --- |
| A. Bedienprototyp | Mobil nutzbarer Fotoablauf mit simulierten Treffern, Rückfragen und Fehlern; sechs Sprachen | Begonnen |
| B. Vor-Ort-Prüfung | Kamera, Lesbarkeit und Sprachwechsel auf echten Mobilgeräten | Offen |
| C. Erkennungsvorprüfung | Rechtmäßig nutzbare Testbilder und manueller qualitativer Modellvergleich | Offen |
| D. API-Vorschau | Cloudflare-Worker, geschützte KI-Anfrage, validierte Bildbeobachtung und erfolgreiche Umgebungssuche; noch kein OSM-Schreiben | Offen |
| E. OSM-Testumgebung | Vorschau und bestätigte Schreibvorgänge ausschließlich gegen OSM-Entwicklungsinstanz | Offen |
| F. Kleiner Pilot | Begrenzter Betrieb, Kosten- und Qualitätsauswertung, reale Geräteprüfung | Offen |

Im ersten Code-Schritt ist Vite mit TypeScript ohne React gewählt. Der lokale Prototyp benötigt keine UI-Bibliothek; der App-Zustand bleibt in einem kleinen Fachmodul, damit spätere Worker-, KI- und OSM-Adapter getrennt ergänzt werden können. Produktive Dienste werden erst nach Abschluss und Prüfung der vorherigen Schritte angeschlossen.

## Rollen und Werkzeuge

Der Projektinitiator beschreibt gewünschtes Verhalten, bewertet vorzeigbare Ergebnisse und entscheidet über Konten, Ausgaben und Veröffentlichung. Der programmierende AI-Agent übernimmt Code, Tests, Konfiguration, Dokumentation und Fehlerbehebung. Er muss dafür Zugriff auf das Repository und eine Ausführungsumgebung haben; ein Chat, der nur Code ausgibt, erledigt diese Arbeit nicht vollständig.

ChatGPT/Codex kann bei vorhandenem Repository- und Werkzeugzugriff diese Arbeit ausführen. Chrome dient zum Prüfen des Browserablaufs. Die Bildauswertung der fertigen App benötigt separat eingerichteten API-Zugang. Chat-Abos können für manuelle Bildtests und die Entwicklung genutzt werden, ersetzen aber keine App-API. Phase 1 beginnt mit manuellem Vergleich in den vorhandenen Gemini- und ChatGPT-Apps; Claude kommt nur hinzu, wenn dafür ohne Zusatzkosten ein Zugang verfügbar ist. Anschließend wird der tatsächliche API-Ablauf zuerst mit Gemini Developer API Free geprüft. Kostenpflichtige Anbieter-APIs nur bei bestätigtem Guthaben oder mit einem ausdrücklich begrenzten Testbudget verwenden. Für den Produktbetrieb reicht anschließend ein aktiver KI-Anbieter.

Nicht mehrere Agenten unkoordiniert dieselben Dateien ändern lassen. Eine zweite Prüfung kann nützlich sein, muss aber einen klaren Auftrag und denselben Referenzstand bekommen. Besonders kritisch sind Anmeldung, Kostenlimits, Zuordnung und OSM-Schreibvorgänge.

## Sprachen im Entwicklungsauftrag

Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch gehören zur ersten Version. UI-Texte nicht auf Sichtbarkeit hin vervollständigen: Kamerazugriff verweigert, OSM-Login abgelaufen, Verbindung unterbrochen, Ergebnis unklar und Wiederherstellung müssen in allen sechs Sprachen funktionieren. Jede Sprache benötigt echte Tests im schmalen Mobilbildschirm. Kein automatisches Übersetzen in der Laufzeit.

Der Agent verwaltet die sechs Sprachdateien mit stabilen Schlüsseln und einer automatischen Vollständigkeitsprüfung. Der deutsche Ausgangstext wird gemeinsam geprüft, bevor derselbe Text in fünf weiteren Dateien verbreitet wird. Für Japanisch insbesondere Schriftgröße und Zeilenumbruch, für Polnisch und Französisch Sonderzeichen sowie Textlänge kontrollieren. Auch spätere Gamification-Kurztexte erhalten von Beginn an Übersetzungen, selbst wenn die entsprechende Funktion im Pilot noch verborgen bleibt.

## Gamification sauber klein halten

Das [AED-Signalnetz](gamification.md) bleibt für Nutzende im Pilot vollständig unsichtbar. Im Pilot werden erfolgreiche Vor-Ort-Prüfungen intern erst nach bestätigtem OSM-Vorgang gezählt. Es gibt keine Punkteanzeige, öffentliche Fortschritte oder Teilfunktion. Eine spätere sichtbare Funktion benötigt eine eigene Entscheidung und Datenschutzprüfung. Zählfehler oder ausgeschaltete Gamification dürfen niemals Fotoablauf, OSM-Upload oder Wiederherstellung blockieren.

## Phase 1: Die riskante Annahme überprüfen

**Ergebnis:** Eine kleine lokale Auswertung mit rechtmäßig nutzbaren Fotos und bestehenden OSM-Daten. Noch keine produktiven Änderungen.

Mit zunächst etwa 30–50 eigenen oder rechtmäßig nutzbaren Bildern anfangen. Positive Fälle: verschiedene Geräte, durch Glas sichtbare Geräte, Außenwand und Innenraum. Negative oder unklare Fälle: Wegweiser, geschlossener Kasten, leere Halterung, Poster, Bildschirmfoto, Feuerlöscher, mehrere Geräte, Reflexionen, Dunkelheit und Unschärfe.

Zu jedem Bild unabhängig festhalten, was tatsächlich sichtbar und lesbar ist. Einen Teil der Standorte ausschließlich zur Bewertung zurückhalten; Fotos desselben Geräts nicht auf Lern- und Prüfmenge verteilen. Das verhindert, dass die Erkennung nur bekannte Beispiele wiedererkennt.

Messen: falsche Gerätebestätigung, unberechtigte Zuordnung, erforderliche Rückfragen, korrekt übernommene Felder, Wartezeit und Kosten. Eine selbst gemeldete KI-Sicherheit von „99 %“ zählt nicht als gemessene Zuverlässigkeit. In der kleinen Testmenge darf kein klar negativer Fall als sichere Bestätigung durchgehen; selbst null beobachtete Fehler sind noch kein Beweis allgemeiner Fehlerfreiheit.

Zuerst denselben Testsatz und Prompt manuell in den vorhandenen Chat-Apps ausprobieren und Antworten qualitativ vergleichen. Diese Prüfung ist kein API-Benchmark. Danach API-Verfügbarkeit mit Gemini Developer API Free untersuchen; weitere kostenpflichtige APIs nur mit bestätigtem Guthaben oder festem Ausgabenlimit aufrufen. Für den Gemini-Free-Tarif nur eigens aufgenommene oder rechtmäßig nutzbare, nicht sensible Bilder ohne erkennbare Personen einsetzen, da Google Free-Tier-Inhalte zur Produktverbesserung verwenden kann. Nutzerfotos aus dem späteren Betrieb nicht automatisch an mehrere Dienste senden. Danach den Datensatz gezielt um beobachtete Fehlerfälle erweitern und einen Anbieter sowie ein Modell anhand der tatsächlichen API-Ergebnisse auswählen. Keine erfundenen Messergebnisse oder synthetischen Fotos als alleinigen Nachweis verwenden.

## Phase 2: Bedienbarer Ablauf mit simulierten Diensten

**Ergebnis:** Eine Vorschau auf dem Handy: Foto, Prüfung, Ergebnis, kurze Bestätigung. Beide Hauptfälle funktionieren mit festen Testdaten.

Der Agent implementiert explizite Zustände: bereit, Aufnahme, Analyse, Klärung nötig, Vorschlag bereit, Senden, Ergebnis unklar, gespeichert, wiederholbarer Fehler. Ungültige Übergänge sind nicht erlaubt. Ein Reset während eines unklaren Uploads darf die Wiederherstellung nicht verlieren.

Abnahme: Auf einem einfachen Fall ist nach dem Foto nur eine Speicherbestätigung nötig. Eine fehlende optionale Angabe erzeugt keine Frage. Mehrere plausible AEDs erzeugen eine kurze Auswahl. Fehlermeldungen sind verständlich und erhalten den Entwurf.

## Phase 3: Echte KI und Suche, weiter ohne OSM-Schreiben

**Ergebnis:** Der gesamte Ablauf verwendet echte Fotos und aktuelle Kandidaten, endet aber in einer Änderungsvorschau.

Serverdienst, Anmeldung für Pilotnutzer, KI-Adapter, Schema-Prüfung, Kandidatensuche, minimale Datenhaltung und Kostenlimits werden integriert. Staging hat eine eigene Adresse, Schlüssel und Datenbank. Produktive OSM-Schreibrechte sind technisch deaktiviert.

Abnahme: API-Schlüssel sind nicht im Browserbundle, Browsercache oder Repository. Nicht angemeldete Aufrufe werden abgewiesen. Gleichzeitige Anfragen überschreiten nicht das reservierte Budget. Ein fehlgeschlagener Suchaufruf erzeugt keinen Neuanlagevorschlag. Foto- und Token-Inhalte erscheinen nicht in Logs.

## Phase 4: OSM-Schreiben in der Testumgebung

**Ergebnis:** Neuanlage und Existenzbestätigung funktionieren gegen die separate OSM-Entwicklungsinstanz.

Der Agent richtet dafür eigene Testkonten und OAuth-Konfigurationen soweit mit den verfügbaren Zugängen möglich ein. Reale Zugangsschritte oder erforderliche Kontobestätigungen übernimmt der Inhaber. Vor dem bestätigten OSM-Schreibvorgang gibt es genau eine kurze, verständliche Bestätigung. Staging darf auch durch eine falsch gesetzte Frontendvariable nicht unbemerkt produktiv schreiben.

Pflichtfälle:

- Eine Existenzbestätigung ändert ausschließlich das vorgesehene Datum.
- Zweimal Tippen oder paralleles Wiederholen erzeugt keinen zweiten Vorgang.
- Ein erfolgreicher Upload mit verlorener Antwort wird erkannt, ohne erneut anzulegen.
- Ein Datum wird durch einen älteren Entwurf nicht zurückgesetzt.
- Zusätzliche Tags und fremde Bearbeitungen bleiben erhalten.
- Geänderte Objektidentität, Löschung oder Versionskonflikt führen zu einer erneuten Prüfung.
- Fehlgeschlagenes Changeset-Schließen wiederholt keinen bereits erfolgreichen Objekt-Upload.
- Fehlende Sitzung, Providerfehler, Rate-Limit und Datenbankfehler ergeben nachvollziehbare Zustände.

Die OSM-Entwicklungsinstanz hat eine eigene Datenbank und eigene Konten; sie ist nicht mit produktivem OSM gleichzusetzen. [OSM OAuth](https://wiki.openstreetmap.org/wiki/OAuth)

## Phase 5: Kleiner realer Pilot

**Ergebnis:** Wenige freigeschaltete Nutzer erfassen tatsächlich besuchte Geräte. Die ersten Änderungen werden einzeln in OSM nachkontrolliert.

Jetzt echte Android-Geräte mit Chrome und echte iPhones im Browser sowie als installierte PWA prüfen. Playwright-WebKit ist hilfreich, ersetzt aber nicht iPhone-Kamera, GPS, Betriebssystemdialoge und App-Wechsel. Ein AI-Agent kann simulierte Tests ausführen; reale Vor-Ort-Beobachtung und Hardwaregrenzen müssen durch jemanden vor Ort überprüft werden.

Als vorläufige Produktziele für eindeutige Fälle: genau ein Bestätigungsschritt nach dem Foto und auf brauchbarem Mobilfunk typischerweise unter zehn Sekunden bis zum Vorschlag. Das sind Zielwerte, keine garantierten Leistungsangaben. Median, langsame Fälle und Rückfragequote getrennt berichten. Geschwindigkeit nicht durch riskantere Zuordnungen erkaufen.

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

Vorgeschlagene Struktur, noch nicht angelegt:

```text
src/ui/             Ansichten, Kamera, lokale Entwürfe
src/domain/         Zustände, Kandidatenvergleich, erlaubte Änderungen
src/contracts/      versionierte Anfrage- und Antwortschemas
server/auth/        OSM-Anmeldung und Sitzungen
server/vision/      austauschbare KI-Anbindung
server/osm/         Suche, Versionen, Changesets, Wiederherstellung
server/storage/     Vorgangsstatus und Verbrauchsgrenzen
migrations/         Datenbankänderungen
tests/              Fachfälle, Fehlerfälle, Browserabläufe
evals/              rechtmäßig nutzbare Bildfälle und Bewertungsregeln
```

## Betrieb so klein wie möglich halten

GitHub Actions prüft Änderungen; ein zusammenhängendes Release veröffentlicht UI und API. Für Prototyp und kleinen Pilot zuerst Cloudflare Workers Free und die bereitgestellte `workers.dev`-Adresse verwenden. Workers Paid (mindestens 5 USD pro Monat) und eine eigene Domain sind spätere Optionen, falls ein konkreter Bedarf entsteht. Vor größerem öffentlichen Start die Domain festlegen, da ein späterer Wechsel Installation, Sitzungen und lokal gespeicherte Entwürfe beeinflusst.

Nur wenige Betriebswerte erfassen: Analysezeiten, Fehlerarten, Budgetverbrauch, unklare Uploads und App-/Modellversion. Keine Bewegungsprofile und keine dauerhaft gespeicherten Fotos. Ein Fehlerhinweis kann eine Vorgangsnummer enthalten, damit der Agent den technischen Status prüfen kann, ohne das Bild erneut zu veröffentlichen.

Abschalter für Analyse und OSM-Schreiben, ein dokumentierter Rückweg zur letzten Version und ein getesteter Wiederherstellungsweg gehören zum ersten produktiven Release. Eine Wiederherstellung der eigenen Datenbank macht bereits geschriebene OSM-Änderungen nicht rückgängig; unklare Vorgänge müssen danach erneut mit OSM abgeglichen werden.

## Was der Projektinitiator bereitstellen muss

Kein Quellcode. Hosting-Richtung Cloudflare und Bestätigungsablauf für OSM sind entschieden. Später benötigt werden Domain, sichere Kontozugänge, Prüfung der verfügbaren API-Guthaben und ausgewählte, rechtmäßig nutzbare Testfotos. Vorhandene Chat-Abos allein ersetzen keinen eingerichteten KI-API-Zugang. Eine kurze Erprobung am Handy ist für Kamera, Standort und Browserberechtigungen nötig; technische Vorbereitung und Auswertung übernimmt der Agent.
