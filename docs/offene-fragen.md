# Entscheidungen und nächste Schritte

Stand: 17.10.2026. Die Fotoaufnahme und maximale Einfachheit sind jetzt die festgelegte Richtung; die frühere Frage „Karte oder Kamera als Einstieg?“ ist entschieden.

## Festgelegt

- Vor dem AED ein Foto aufnehmen; die KI prüft das Gerät und übernimmt erkennbare Angaben.
- Vorhandene AEDs in OpenStreetMap automatisch anhand der Umgebung und verfügbarer Hinweise abgleichen.
- Kein passender Eintrag: neuen AED vorbereiten und eintragen.
- Passender Eintrag: nur bestätigen, dass das Gerät noch vorhanden ist.
- Nur notwendige offene Fragen stellen. Kein vollständiges Formular im normalen Ablauf.
- Vorbild bleibt Hydrantenjäger. Sprache ist zunächst Deutsch.
- Wir sammeln und konkretisieren das Konzept; Anwendungscode ist noch nicht implementiert.

## Als Nächstes praktisch prüfen

1. Wenige reale Fotos zusammenstellen: sichtbares Gerät, Beschriftung, geschlossener Kasten, Wegweiser, unscharfes Bild.
2. Erkennung und Auslesen sichtbarer Angaben testen; dabei Fehlentscheidungen und nötige Rückfragen festhalten.
3. Den Abgleich mit echten OSM-Standorten als Vorschau erproben, einschließlich mehrerer Geräte in einem Gebäude.
4. Einen durchgehenden Ablauf „Foto → Ergebnis → Speichern“ prototypisch zeigen.

## Noch zu entscheiden

- Welcher KI-Dienst liefert ausreichend gute Ergebnisse bei kurzer Wartezeit und passenden Kosten?
- Welche minimale technische Ergänzung zu Hydrantenjäger braucht die KI-Anfrage, einschließlich geschütztem API-Schlüssel und Fotoverarbeitung?
- Hosting und API-Anbieter anhand des [Architekturentwurfs](architektur.md) festlegen.
- Welche Angaben fehlen in echten Erfassungen so häufig, dass eine kurze Rückfrage erforderlich ist?
- PWA und Wiederverwendung der bestehenden Bausteine im Detail; endgültiger Name, Domain und Lizenz.

„AEDjäger“ bleibt der Arbeitsname. Das [Repository](https://github.com/FrnkMrz/AEDjaeger) ist zunächst privat. Öffentliche Bildspeicherung ist für die KI-Auswertung nicht als Produktfunktion vorgesehen; Übermittlung und Aufbewahrung beim gewählten Dienst sind noch festzulegen.

## Durch weitere Recherche geklärt

Für „noch vorhanden“ ist `check_date` laut OSM-Dokumentation geeignet. Die Anwendung bestätigt damit keine Gerätewartung und verändert keine anderen Eigenschaften. Für die Umsetzung liegt jetzt ein [Plan mit überprüfbaren Etappen](umsetzungsplan.md) vor.

## Neue Anforderungen

- UI-Sprachen ab erster Version: Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch.
- Gamification bleibt im normalen Ablauf unsichtbar und belohnt weder tägliche Nutzung noch reine Neuanlagen.
- Arbeitsname für eine mögliche gemeinschaftliche, freiwillig teilbare Fortschrittskarte: „AED-Signalnetz“.
