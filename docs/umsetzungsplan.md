# Umsetzung durch einen AI-Agenten

Stand: 23.10.2026. Ergänzung zum [Architekturentwurf](architektur.md). Die Phasen ordnen die Umsetzung in überprüfbare Etappen. GPT-6 Luna ist als erstes Bildmodell gewählt und mit drei Testfotos explorativ geprüft. Die Oberfläche enthält jetzt einen ausdrücklichen, geschützten Analysepfad; Umgebungssuche und OSM-Schreibzugriff sind noch nicht angebunden.

## Reihenfolge und aktueller Stand

| Schritt | Ergebnis | Status |
| --- | --- | --- |
| A. Bedienprototyp | Mobil nutzbarer Fotoablauf mit simulierten Treffern, Rückfragen und Fehlern; sechs Sprachen | Begonnen |
| B. Vor-Ort-Prüfung | Schmale Browseransicht, Info-Texte in sechs Sprachen, Auswahlablauf und Offline-Cache automatisiert geprüft; Kamera, Lesbarkeit und Berechtigungen auf echten Mobilgeräten | Teilweise: Nutzer hat über privaten WLAN-/VPN-Zugang Fotoaufnahme und Fotoauswahl in einem nicht näher dokumentierten mobilen Browser erfolgreich geprüft; Android/iPhone, Berechtigungen, PWA-Installation und Offlinebetrieb bleiben offen |
| C. Erkennungsvorprüfung | Rechtmäßig nutzbare Testbilder und qualitative Modellprüfung | Explorative ChatGPT-Prüfung mit sieben Bildern und OpenAI-API-Test mit drei positiven Bildern abgeschlossen; beides ist kein kontrollierter Genauigkeitsnachweis. Ergebnisse und Grenzen stehen in [Bildtest](bildtest.md). |
| D. API-Vorschau | Cloudflare-Worker, geschützte Anfrage an GPT-6 Luna, validierte Bildbeobachtung und erfolgreiche Umgebungssuche; noch kein OSM-Schreiben | Begonnen: UI-Anbindung an die standardmäßig abgeschaltete Analyse-Route mit explizitem Senden, Bildbereinigung und geprüfter Antwort. Noch offen: Betreiberlimits und Freigabeliste festlegen, Kandidatensuche integrieren und danach kontrolliert mit freigegebenen Bildern testen. Es gab kein Deployment und keinen API-Aufruf aus der App. |
| E. OSM-Testumgebung | Vorschau und bestätigte Schreibvorgänge ausschließlich gegen OSM-Entwicklungsinstanz | Offen |
| F. Kleiner Pilot | Begrenzter Betrieb, Kosten- und Qualitätsauswertung, reale Geräteprüfung | Offen |

Im ersten Code-Schritt ist Vite mit TypeScript ohne React gewählt. Der lokale Prototyp benötigt keine UI-Bibliothek; der App-Zustand bleibt in einem kleinen Fachmodul, damit spätere Worker-, KI- und OSM-Adapter getrennt ergänzt werden können. Produktive Dienste werden erst nach Abschluss und Prüfung der vorherigen Schritte angeschlossen.

## Rollen und Werkzeuge

Der Projektinitiator beschreibt gewünschtes Verhalten, bewertet vorzeigbare Ergebnisse und entscheidet über Konten, Ausgaben und Veröffentlichung. Der programmierende AI-Agent übernimmt Code, Tests, Konfiguration, Dokumentation und Fehlerbehebung. Er muss dafür Zugriff auf das Repository und eine Ausführungsumgebung haben; ein Chat, der nur Code ausgibt, erledigt diese Arbeit nicht vollständig.

ChatGPT/Codex kann bei vorhandenem Repository- und Werkzeugzugriff diese Arbeit ausführen. Chrome dient zum Prüfen des Browserablaufs. Die Bildauswertung der fertigen App benötigt einen separat eingerichteten API-Zugang. Chat-Abos ersetzen keine App-API. Der erste API-Test mit dem gewählten GPT-6 Luna ist erfolgreich authentifiziert und hat drei positive Bilder erkannt; er belegt noch keine ausreichende Qualität für einen Pilot. Für den Produktbetrieb ist nur dieser eine Anbieter vorgesehen; höhere OpenAI-Modelle sind ausgeschlossen.

Nicht mehrere Agenten unkoordiniert dieselben Dateien ändern lassen. Eine zweite Prüfung kann nützlich sein, muss aber einen klaren Auftrag und denselben Referenzstand bekommen. Besonders kritisch sind Anmeldung, Kostenlimits, Zuordnung und OSM-Schreibvorgänge.

## Sprachen im Entwicklungsauftrag

Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch gehören zur ersten Version. UI-Texte nicht auf Sichtbarkeit hin vervollständigen: Kamerazugriff verweigert, OSM-Login abgelaufen, Verbindung unterbrochen, Ergebnis unklar und Wiederherstellung müssen in allen sechs Sprachen funktionieren. Jede Sprache benötigt echte Tests im schmalen Mobilbildschirm. Kein automatisches Übersetzen in der Laufzeit.

Der Agent verwaltet die sechs Sprachdateien mit stabilen Schlüsseln und einer automatischen Vollständigkeitsprüfung. Der deutsche Ausgangstext wird gemeinsam geprüft, bevor derselbe Text in fünf weiteren Dateien verbreitet wird. Für Japanisch insbesondere Schriftgröße und Zeilenumbruch, für Polnisch und Französisch Sonderzeichen sowie Textlänge kontrollieren. Auch spätere Gamification-Kurztexte erhalten von Beginn an Übersetzungen, selbst wenn die entsprechende Funktion im Pilot noch verborgen bleibt.

## Gamification sauber klein halten

Das [AED-Signalnetz](gamification.md) bleibt für Nutzende im Pilot vollständig unsichtbar. Im Pilot werden erfolgreiche Vor-Ort-Prüfungen intern erst nach bestätigtem OSM-Vorgang gezählt. Es gibt keine Punkteanzeige, öffentliche Fortschritte oder Teilfunktion. Eine spätere sichtbare Funktion benötigt eine eigene Entscheidung und Datenschutzprüfung. Zählfehler oder ausgeschaltete Gamification dürfen niemals Fotoablauf, OSM-Upload oder Wiederherstellung blockieren.

## Phase 1: Die riskante Annahme überprüfen

**Ergebnis:** Eine kleine lokale Auswertung mit rechtmäßig nutzbaren Fotos und bestehenden OSM-Daten. Noch keine produktiven Änderungen.

Der manuelle Bildvergleich hat jetzt einen [eigenen Ablauf mit einheitlichem Prompt und Bewertungsbogen](bildtest.md). Die simulierten Beispielszenarien senden keine Bilder; der separate KI-Knopf kann ein bereinigtes Foto nur dann an die Worker-Route senden, wenn ein Nutzer ihn ausdrücklich betätigt und der Dienst serverseitig freigeschaltet ist.

Mit zunächst etwa 30–50 eigenen oder rechtmäßig nutzbaren Bildern anfangen. Positive Fälle: verschiedene Geräte, durch Glas sichtbare Geräte, Außenwand und Innenraum. Negative oder unklare Fälle: Wegweiser, geschlossener Kasten, leere Halterung, Poster, Bildschirmfoto, Feuerlöscher, mehrere Geräte, Reflexionen, Dunkelheit und Unschärfe.

Zu jedem Bild unabhängig festhalten, was tatsächlich sichtbar und lesbar ist. Einen Teil der Standorte ausschließlich zur Bewertung zurückhalten; Fotos desselben Geräts nicht auf Lern- und Prüfmenge verteilen. Das verhindert, dass die Erkennung nur bekannte Beispiele wiedererkennt.

Messen: falsche Gerätebestätigung, unberechtigte Zuordnung, erforderliche Rückfragen, korrekt übernommene Felder, Wartezeit und Kosten. Eine selbst gemeldete KI-Sicherheit von „99 %“ zählt nicht als gemessene Zuverlässigkeit. In der kleinen Testmenge darf kein klar negativer Fall als sichere Bestätigung durchgehen; selbst null beobachtete Fehler sind noch kein Beweis allgemeiner Fehlerfreiheit.

Die erste ChatGPT-Runde ist wegen abweichender Prompts und gemeinsamem Gesprächskontext nur explorativ; sie zeigt vor allem, dass die Sollklassen „AED-Gehäuse“ und „Defibrillator sichtbar“ getrennt annotiert werden müssen. Der anschließende API-Test mit GPT-6 Luna verwendete drei positive Testbilder in einer Anfrage und erkannte alle drei als AED. Das ist kein API-Benchmark: negative Fälle, unsichere Bilder, Wiederholungen und unabhängige Sollannotation fehlen. Als nächstes den Datensatz gezielt um diese Fälle erweitern, bevor Zuverlässigkeitsaussagen oder ein Pilot erfolgen. Weitere Fotos nur nach gesonderter Freigabe an einen Anbieter senden. Höhere OpenAI-Modelle nicht verwenden.

## Phase 2: Bedienbarer Ablauf mit simulierten Diensten

**Ergebnis:** Eine Vorschau auf dem Handy: Foto, Prüfung, Ergebnis, kurze Bestätigung. Beide Hauptfälle funktionieren mit festen Testdaten.

Der Agent implementiert explizite Zustände: bereit, Aufnahme, Analyse, Klärung nötig, Vorschlag bereit, Senden, Ergebnis unklar, gespeichert, wiederholbarer Fehler. Ungültige Übergänge sind nicht erlaubt. Ein Reset während eines unklaren Uploads darf die Wiederherstellung nicht verlieren.

Abnahme: Auf einem einfachen Fall ist nach dem Foto nur eine Speicherbestätigung nötig. Eine fehlende optionale Angabe erzeugt keine Frage. Mehrere plausible AEDs erzeugen eine kurze Auswahl. Fehlermeldungen sind verständlich und erhalten den Entwurf.

## Phase 3: Echte KI und Suche, weiter ohne OSM-Schreiben

**Ergebnis:** Der gesamte Ablauf verwendet echte Fotos und aktuelle Kandidaten, endet aber in einer Änderungsvorschau.

Der isolierte Adapter unter `server/vision/openai.ts` ist getestet. Die geschützte Worker-Route unter `server/vision/analyzeRoute.ts` bleibt standardmäßig abgeschaltet. Die UI-Anbindung verlangt eine bewusste Betätigung, kodiert das Bild lokal neu und prüft die strukturierte Antwort; unklare Anfragen werden nicht automatisch wiederholt. Der Worker verlangt eine gültige OSM-Sitzung, eine serverseitige Pilot-Freigabeliste, ein OpenAI-Secret und vor dem Provideraufruf eine atomare D1-Kostenreservierung. Dafür müssen Betreiberwerte für Freigabeliste, Reservierung pro Anfrage, Nutzer-Tageslimit und Gesamt-Tageslimit vorliegen. Die Worker-Routen `/api/auth/osm/start`, `/api/auth/osm/callback`, `/api/auth/session` und `/api/auth/logout` bilden den OSM-Login mit PKCE ab. OIDC-Discovery, RS256-Signatur, Issuer, Audience, Ablaufzeit und einmalige Nonce werden vor der Sitzung geprüft. Der Login fordert ausschließlich `openid` an und legt keinen OSM-Zugriffstoken ab; Schreibrechte bleiben weiterhin deaktiviert. Als Nächstes folgen Kandidatensuche und erst nach Kostenfreigabe ein kontrollierter KI-Test. Der Worker wurde noch nicht veröffentlicht. Schlüssel gehören ausschließlich in Worker-Secrets.

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
