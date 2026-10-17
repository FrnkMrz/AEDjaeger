# Produktkonzept: Foto machen, AED eintragen oder bestätigen

Stand: 17.10.2026. Die Produktrichtung wurde vom Projektinitiator konkretisiert. Umsetzung und KI-Anbieter sind noch offen.

## Oberstes Ziel: absolute Einfachheit

Ich stehe vor einem AED, mache ein Foto und die App erledigt die Zuordnung zu OpenStreetMap. Sie trägt ein neues Gerät ein oder bestätigt, dass ein vorhandenes noch da ist. Nur wirklich notwendige offene Fragen gehen an mich zurück.

Das Foto ist der Einstieg und die Grundlage für die KI-Erkennung. Der normale Ablauf benötigt weder eine Kartensuche noch ein vollständiges Formular.

## Der normale Ablauf

1. **Foto machen.** Die App ermittelt die Position und fragt vorhandene AEDs in der Umgebung ab. Eine KI-Anfrage prüft das Foto auf einen AED und liest erkennbare Angaben aus.
2. **Automatisch zuordnen.** Die App gleicht Position, vorhandene OSM-Daten und Bildinformationen ab. Sie entscheidet, ob ein vorhandener Eintrag passt oder ein neues Gerät einzutragen ist.
3. **Kurz bestätigen, fertig.** Bei einem passenden Eintrag: „Schon eingetragen. Noch vorhanden bestätigen.“ Bei einem neuen Gerät: „Neuen AED eintragen.“ Ein Tippen speichert die jeweils angekündigte Änderung.

OSM-Anmeldung und Erklärung der Fotoübermittlung gehören in die einmalige Einrichtung. Nach dieser Einrichtung ist das Ziel für den eindeutigen Fall: **Foto aufnehmen → Ergebnis bestätigen → fertig.**

## Bereits vorhanden

Der normale Weg bestätigt nur, dass der fotografierte AED noch vorhanden ist. Keine Pflicht zur Vervollständigung aller OSM-Felder. Bestehende Position, Öffnungszeiten und sonstige Angaben bleiben unverändert. Die Bestätigung wird mit dem Beobachtungsdatum als `check_date` gespeichert. Die recherchierte Grundlage und die Regeln für ältere Aufnahmen stehen im [Architekturentwurf](architektur.md#6-bestehenden-aed-bestätigen).

Ein heutiges Foto bestätigt nicht automatisch die bisherigen Zugangszeiten oder die Funktionsfähigkeit des Geräts. Erkennt die App einen echten Widerspruch, stellt sie dazu genau eine kurze Frage, statt Daten still zu überschreiben.

## Noch nicht eingetragen

Die App bereitet den neuen Eintrag aus Position und Foto vor. Die KI soll erkennen, ob das Gerät sichtbar ist, und klar lesbare Angaben übernehmen, beispielsweise Hersteller, Modell oder eine Beschriftung zum Standort. Diese Erkennungsleistung muss an echten Fotos erprobt werden.

Fehlen entscheidende Angaben, fragt die App gezielt nach, zum Beispiel „Wo im Gebäude?“ oder bei unsicherer Position „Wo hängt der AED?“. Eine kleine Karte erscheint nur, wenn die Lage geklärt werden muss oder der Benutzer sie korrigieren möchte. Optionale Angaben dürfen fehlen; es gibt keinen Fragenkatalog zum vollständigen Ausfüllen.

## Nur bei Unklarheit nachfragen

| Situation | Reaktion der App |
| --- | --- |
| Ein bestehender AED passt eindeutig | Vorhandensein mit einem Tippen bestätigen. |
| Erfolgreiche Umgebungssuche, kein passender Eintrag | Neuanlage vorbereiten; nur entscheidende Lücken klären. |
| Mehrere plausible Einträge | Kurze Auswahl: „Welcher ist es?“ mit unterscheidbaren Standortangaben. |
| Nur ein Wegweiser oder ein geschlossener, nicht einsehbarer Kasten erkennbar | Nachfragen, ob das Gerät tatsächlich vorhanden ist; kein automatischer Existenznachweis. |
| Bild unscharf oder Erkennung unsicher | „Bitte noch ein Foto“ statt geratenen Daten. |
| OSM-Abfrage fehlgeschlagen | Erneut versuchen; ein Fehler bedeutet nicht, dass noch kein Eintrag existiert. |
| Upload fehlgeschlagen oder Ergebnis unklar | Aufnahme erhalten, Serverzustand prüfen und Doppelanlage vermeiden. |

Nähe allein reicht nicht zur Zuordnung: In einem Gebäude können mehrere AEDs stehen. Das Foto liefert sichtbare Hinweise, GPS die ungefähre Lage und OSM die vorhandenen Einträge. Die App führt diese Informationen zusammen; ein verlässlicher Abgleich setzt kein bereits vorhandenes Vergleichsfoto in OSM voraus.

## Umfang des ersten Prototyps

Fotoaufnahme, KI-Auswertung, Suche in der Umgebung, Zuordnung und die beiden Speicherwege „neu eintragen“ und „noch vorhanden“. Rückfragen erscheinen ausschließlich dort, wo der konkrete Vorgang sie benötigt.

Karte, Tags und technische Details bleiben im Hintergrund. Punkte, Ranglisten, öffentliche Fotogalerien und zusätzliche Erfassungsfunktionen stehen hinter dem einfachen Hauptablauf zurück. Eine PWA wie Hydrantenjäger bleibt ein technischer Kandidat.

## Nächster praktischer Schritt

Mit wenigen echten Fotos den gesamten Ablauf erproben: neues Gerät, bereits eingetragenes Gerät, mehrere Geräte am selben Ort, Hinweisschild und undeutliches Foto. Dabei zunächst nur Änderungsvorschläge erzeugen. Entscheidend ist, ob die App zuverlässig zuordnet und wie oft sie eine Rückfrage braucht.
