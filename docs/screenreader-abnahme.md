# Screenreader-Abnahme für P7

Diese Abnahme ist ein manueller Durchlauf auf echten Geräten. Playwright und axe prüfen die Browserstruktur, können aber keine Ansagen von VoiceOver oder TalkBack bewerten. Vor dem Durchlauf muss die geprüfte P7-Version auf dem Gerät erreichbar sein.

## Geräte und Vorbereitung

- iPhone mit Safari und VoiceOver
- Android-Gerät mit Chrome und TalkBack
- In beiden Fällen mit einer angemeldeten Testserver-Sitzung und einem lokalen Beispielfoto arbeiten. Keine echten OSM-Schreibvorgänge ausführen.
- Je Gerät Datum, App-Version, Browser, Betriebssystem und Screenreader-Version notieren.

## Ablauf

1. Startbildschirm öffnen und die Fotowahl per Screenreader finden und aktivieren.
2. Ein Beispielfoto wählen. Prüfen, ob Bestätigung, Datum und Standortfrage in der richtigen Reihenfolge einmal verständlich angekündigt werden.
3. Die Kartenposition öffnen. Kartenname und Bedienhinweis anhören. Mit den Pfeiltasten verschieben (bei einer externen Tastatur) und mit Plus/Minus zoomen; auf dem Touchscreen Karte verschieben und mit zwei Fingern zoomen.
4. Koordinaten ändern und prüfen, ob die neue Position angesagt wird, ohne dass die ganze Ansicht mehrfach vorgelesen wird.
5. Eine Suche mit simuliertem Treffer durchführen. Prüfen, ob Ergebnis, AED-Name, Entfernung und Hauptaktion in sinnvoller Reihenfolge und je einmal angesagt werden.
6. Änderungsvorschau öffnen. Vorhandenen Wert, vorgeschlagenen Wert und Bestätigung prüfen. Nicht speichern.
7. Eine simulierte Suchstörung auslösen. Fehlermeldung, Wiederholen und Rückweg prüfen.
8. Info-Dialog öffnen und schließen. Prüfen, ob der Fokus im Dialog bleibt und nach dem Schließen zum Auslöser zurückkehrt.

## Ergebnis und Folgeentscheidung

Für jeden Schritt festhalten: **verständlich / doppelt / fehlt**, die konkrete Ansage und die Stelle, an der der Fokus landet. Danach eine der beiden Ansagestrategien für Zustandswechsel wählen: Fokus auf den neuen Schritt führen oder den Zustandsbereich als Live-Region ankündigen. Beides gleichzeitig kann doppelte Ansagen verursachen. Erst nach diesem Gerätetest wird die gewählte Strategie im Code angepasst.

Status: **offen**. Der automatisierte P7-Test ersetzt diese Geräteabnahme nicht.
