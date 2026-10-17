# Verdeckte Gamification: das AED-Signalnetz

Stand: 17.10.2026. Entwurf für eine Gamification, die den Fotoworkflow schlicht hält. Keine sichtbaren Level, Punkteanzeige, Bestenliste, Profilseite oder tägliche Serie. Viralität ist eine Hoffnung, kein planbarer Effekt.

## Leitidee: Die Stadt bekommt Signal

Jedes Mal, wenn jemand vor Ort einen AED fotografiert und anschließend erfolgreich in OSM einträgt oder dessen Vorhandensein bestätigt, bekommt die Karte der Umgebung still einen weiteren „Signalimpuls“. Wenn in einer Stadt oder Region genug AEDs vor Ort überprüft wurden, wird ein abstrakter Teil der städtischen AED-Karte nach und nach sichtbar. Die Idee: Nicht eine Person jagt einer Punktzahl hinterher – die Gemeinschaft bringt ein AED-Signalnetz in ihrer Stadt zum Leuchten.

Im normalen App-Ablauf existiert das als Hintergrundzähler: Foto, Ergebnis, speichern. Die Anzeige wird dadurch nicht länger. Die Spielmechanik steckt in gemeinschaftlichem Fortschritt, überraschender Visualisierung und optionalem Teilen.

## Der kleine, unerwartete Moment

Nach einem tatsächlich erfolgreichen OSM-Eintrag erscheint weiter nur die normale Erfolgsmeldung. Wenn ein längerfristiger Gemeinschafts-Meilenstein erreicht wurde, kann im Ergebnisbereich ein kleiner visueller Lichtimpuls auftauchen. Kein modaler Dialog und keine zusätzliche Aufgabe.

Eine Karte der betreffenden Stadt mit stilisierten grünen AED-Signalen und dem Text „Diese AED-Standorte wurden vor Ort überprüft.“ lässt sich bei Interesse teilen. Sie ist in allen sechs Startsprachen verfügbar: Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch. Die Karte enthält weder exakte Positionen noch den Namen des Beitragenden. Teilen ist ausschließlich eine bewusste Aktion. Die normalen Kernabläufe bleiben ohne Kenntnis der Mechanik verständlich.

## Mechanik, die gute Beiträge belohnt

- Nur ein erfolgreicher Vor-Ort-Ablauf zählt: AED fotografiert, eindeutig zugeordnet oder neu eingetragen, Speicherung durch OSM bestätigt.
- Ein Neuzugang und eine echte Bestätigung im Bestand zählen gleichwertig. So entsteht kein Anreiz, vorhandene AEDs nochmals anzulegen.
- Ein bereits heute geprüfter Standort erzeugt keinen mehrfachen Impuls. Es gibt keinen Tagesbonus und keine künstliche Serie.
- Fotos ohne Netz bleiben Entwürfe, bis der Vorgang abgeschlossen ist. Aufnahmen ohne bestätigten Erfolg verändern die Gemeinschaftsanzeige nicht.
- Schnelligkeit, Anzahl pro Person, persönliche GPS-Spuren und aufgenommene Fotos werden nicht belohnt.

Der Punkt lässt sich in die Umgebungskachel aggregieren und nach abgeschlossenem Upload von Rohdaten trennen. Für einen kleinen, fairen Pilot kann die Anzeige zunächst mit synthetischen Testdaten laufen oder vollständig verborgen bleiben, bis Aggregation und Missbrauchsschutz nachgewiesen sind. Die Arbeitsmechanik darf keine Sicherheitsfunktion, Erkennungsschwelle oder OSM-Datenqualität ändern.

## Wie könnte es viral gehen?

Am Teilpunkt liegt eine sauber gestaltete, automatisch lokalisierte Karte, die Nachbarschaft und Mitwirkung sichtbar macht. Nach einem echten Meilenstein entsteht ein einzelner teilbarer Link oder eine Bildkarte. Zum Beispiel: „Unser Viertel hat jetzt 25 AED-Standorte vor Ort geprüft.“ Das motiviert eher lokale Feuerwehrgruppen, Vereine und Kollegenkreise, gemeinsam hinzuschauen, als ein individuelles Ranking.

Um Privatsphäre zu schützen, erscheint die Karte erst, wenn eine Mindestmenge an Beobachtungen und eine ausreichend große Gruppe von Beteiligten zusammengekommen ist. Der genaue Schwellenwert muss vor öffentlicher Anzeige so gewählt und getestet werden, dass sich daraus keine einzelne Handlung ableiten lässt. Kleine Orte bekommen eine größere Region, eine längere Zeitspanne oder gar keine öffentliche Schwelle. Der Kartentext kommuniziert „Standorte im OSM-Bestand geprüft“, nicht „alle AEDs gefunden“, „jedes Gerät funktionsfähig“ oder „dieses Viertel ist sicher“.

Das Erreichen eines Meilensteins ist ein Angebot zum freiwilligen Teilen, kein automatisch öffentlicher Beitrag. Keine automatische Veröffentlichung in Social Media, kein Kontaktezugriff, kein Tracking-Pixel, kein Referral-Code mit Nutzerkennung und keine Belohnung für geworbene Personen.

## Weitere Konzepte, die ich vorerst nicht empfehlen würde

| Idee | Warum sie verlockend wirkt | Warum sie anfangs problematisch ist |
|---|---|---|
| Aufdeckbare Sammelkarte mit immer selteneren Symbolen | Überraschung und Sammlergefühl | Erzeugt Konten-, Inventar- und Profiloberflächen; bringt die Bedienung weg vom AED vor Ort. |
| Verdeckte lokale Entdeckungsserie | Kann wiederkehrende Beiträge motivieren | Verführt zu Masse statt Datenqualität, belohnt den Kalender und kann Besucherdaten dauerhaft binden. |
| Rangliste nach Gemeinde, Nutzer oder Feuerwehr | Liefert einen sichtbaren Vergleich | Belohnt Neuanlagen, nicht Verifizieren; erhöht Druck, Wettbewerbsstreit und Datenmanipulation. |
| AR- oder Abenteuerjagd zu vermuteten AEDs | Wirkt auf Videos und Demos spektakulär | Der AED muss vor Ort wirklich zugänglich sein. Suche nach unsicheren Vermutungen ist keine gute Belohnung. |
| Punkte für jedes Foto oder jeden OSM-Upload | Einfach zu implementieren | Fotos können fehlgehen, und viele Meldungen können falsch oder doppelt sein. |

Das Forschungsprojekt AEDHunter untersucht eine eigene spielerische App, die wiederholtes Auffinden von AEDs übt. Das ist eine sinnvolle Inspiration für gemeinschaftliche Aktivierung, aber kein Nachweis dafür, dass unsere „Signalnetz“-Mechanik viral wird oder die Datenqualität erhöht. [AEDHunter-Projektseite](https://www.yuukinishiyama.com/en/research/aed-hunter), [Folgearbeit von 2026](https://arxiv.org/abs/2603.01075)

## Kleinster sinnvoller Start

1. In der Vorschau bleibt Gamification vollständig verborgen. Jede Testaufnahme zählt nur auf einem lokalen Testzähler.
2. Beim Pilot werden ausschließlich erfolgreiche, bestätigte Beobachtungen in grobe lokale Gruppen zusammengeführt.
3. Vor dem Teilen kontrollieren, dass die Karte genug Beobachtungen von genügend Personen zusammenfasst.
4. Nur wenn Pilotnutzer die Gemeinschaftskarte aus eigenem Antrieb gern teilen, wird das freiwillige Teilen als separate Funktion ergänzt.
5. Im Test offen auf dieselben Fehler achten wie bei der App: künstliche Wiederholungen, falsche Zuordnungen, eine einzelne Person, die einen Ort dominiert, und Rückschlüsse auf Besuche.

**Empfehlung:** „AED-Signalnetz“ als Hintergrundkonzept einplanen und das automatische Zählen beim ersten funktionierenden Produkt weglassen. Den Kernablauf nicht mit Gamification-Funktionen erweitern. Erst nach einem kleinen Pilot entscheiden, ob die freiwillige, aggregierte Stadtkarte tatsächlich einen Nutzen hat.
