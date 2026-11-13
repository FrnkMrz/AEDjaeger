# Produktkonzept: Foto machen, AED eintragen oder bestätigen

Stand: 8.11.2026. **Aktueller Pilotentscheid (10.11.2026):** Eine optionale Fotoprüfung per OpenAI sortiert Fotos ohne erkennbaren AED aus; der Betreiber schaltet sie ein und aus. Ohne Freigabe läuft AEDjaeger wie bisher ohne externen Bilddienst, die Person bestätigt selbst, ob ein AED-Gerät oder AED-Gehäuse im Foto sichtbar ist, und das Foto bleibt lokal. Mit Freigabe geht das Foto nach ausdrücklichem Tippen ohne EXIF/GPS an OpenAI. Frühere Modelltests weiter unten sind historische Erkundungen, keine Laufzeitvoraussetzung.

## Oberstes Ziel: absolute Einfachheit

Ich stehe vor einem AED, mache ein Foto und die App erledigt die Zuordnung zu OpenStreetMap. Sie trägt ein neues Gerät ein oder bestätigt, dass ein vorhandenes noch da ist. Nur wirklich notwendige offene Fragen gehen an mich zurück.

Das Foto ist der Einstieg und hilft der Person, den konkreten AED zu prüfen. Die Anwendung behauptet keine sichere Erkennung: Die Fotoprüfung ist ein Filter, die Person bestätigt weiterhin selbst. Der normale Ablauf benötigt weder eine Kartensuche noch ein vollständiges Formular.

## Der normale Ablauf

1. **Foto machen oder auswählen.** Die Person bestätigt ausdrücklich, dass das AED-Gerät oder sein Gehäuse zu sehen ist. GPS aus dem Foto wird lokal zuerst ausgewertet. Fehlt es bei einem gerade mit der Kamera der App aufgenommenen Foto, nutzt die App den Handy-Standort, den die Person einmal erlaubt hat. Bei Galerie-Fotos und älteren Aufnahmen wird Handy-GPS oder eine Kartenposition nur nach bewusster Auswahl verwendet.
2. **Umgebung abgleichen.** Die App vergleicht den gewählten Standort mit vorhandenen AED-Daten. Sie zeigt Kandidaten zur Prüfung; Nähe allein entscheidet nicht über eine Zuordnung.
3. **Kurz bestätigen, fertig.** Bei einem passenden Eintrag: „Schon eingetragen. Noch vorhanden bestätigen.“ Bei einem neuen Gerät: „Neuen AED eintragen.“ Ein Tippen speichert die jeweils angekündigte Änderung.

Eine gültige OSM-Anmeldung ist Voraussetzung für die Arbeitsfunktionen. Das Ziel für den eindeutigen Fall: **Foto aufnehmen → Sichtbarkeit bestätigen → OSM-Vorschlag prüfen → fertig.**

## Bereits vorhanden

Der normale Weg bestätigt nur, dass der fotografierte AED noch vorhanden ist. Keine Pflicht zur Vervollständigung aller OSM-Felder. Bestehende Position, Öffnungszeiten und sonstige Angaben bleiben auf diesem Weg unverändert; wer mehr beitragen will, öffnet daneben den Detailweg (Abschnitt „Details ergänzen“). Die Bestätigung wird mit dem Beobachtungsdatum als `check_date` gespeichert. Die recherchierte Grundlage und die Regeln für ältere Aufnahmen stehen im [Architekturentwurf](architektur.md#8-bestehenden-aed-bestätigen).

Ein heutiges Foto bestätigt nicht automatisch die bisherigen Zugangszeiten oder die Funktionsfähigkeit des Geräts. Erkennt die App einen echten Widerspruch, stellt sie dazu genau eine kurze Frage, statt Daten still zu überschreiben.

## Noch nicht eingetragen

Die App bereitet den neuen Eintrag aus bestätigter Sichtbarkeit und gewählter Position vor. Das Gerät muss im Gehäuse nicht sichtbar sein. Angaben wie Hersteller, Modell oder Standortbeschriftung werden nicht automatisch aus dem Foto übernommen.

Fehlen entscheidende Angaben, fragt die App gezielt nach, zum Beispiel „Wo im Gebäude?“ oder bei unsicherer Position „Wo hängt der AED?“. Eine kleine Karte erscheint nur, wenn die Lage geklärt werden muss oder der Benutzer sie korrigieren möchte. Optionale Angaben dürfen fehlen; es gibt keinen Fragenkatalog zum vollständigen Ausfüllen.

## Details ergänzen (Entscheidung vom 13.11.2026)

Der Schnellweg bleibt der Standard und bleibt ein Tipp. Daneben gibt es einen freiwilligen **Detailweg**, bei Neuanlagen und bei bestehenden AEDs („Angaben ergänzen / korrigieren“). Die Person soll damit in wenigen Tipps festhalten, was im Notfall zählt: wo das Gerät hängt, wer es nutzen darf, wann es erreichbar ist, ob es drinnen oder draußen steht und auf welcher Ebene.

Bedienung (abgenommenes Mockup vom 13.11.2026, orientiert am Hydrantenjäger):

- Eine scrollbare Seite mit großen Auswahlfeldern statt Aufklapplisten, mindestens 48 px hoch, Schrift mindestens 14 px.
- „Weiß ich nicht“ ist überall die Vorgabe. Sie schreibt nichts und löscht nichts.
- Folgefelder erscheinen nur, wenn sie gebraucht werden: Zeiten bei „Zu bestimmten Zeiten“, Ebene bei „Drinnen“.
- Seltene Angaben (Betreiber, Telefon, Notiz, Nummer) stehen eingeklappt unter „Mehr Angaben“. Das Feld „Gehäuse“ folgt nach einer Entscheidung (siehe offene Fragen).
- Eine feste Fußleiste zeigt einen Hauptknopf mit der Zahl der Änderungen („Weiter · 3 Angaben“). Ohne Änderung bleibt er gesperrt.
- Die Vorschau zeigt jede Änderung. Bei bestehenden AEDs steht `alt → neu` da, unveränderte Tags erscheinen als „bleibt“. Gespeichert wird erst nach der Bestätigung für diesen Vorgang.

Die App liest Zugang, Zeiten oder Lage nie aus dem Foto. Die Tags, ihre Grenzen und die drei Schreibstufen (Neuanlage, Ergänzen, Korrigieren) stehen in [OSM-Datenmodell](osm.md#detailangaben-entscheidung-vom-13112026). Korrigieren bestehender Werte ist ein eigener Betreiber-Schalter und standardmäßig aus.

## Nur bei Unklarheit nachfragen

| Situation | Reaktion der App |
| --- | --- |
| Ein bestehender AED passt eindeutig | Vorhandensein mit einem Tippen bestätigen. |
| Erfolgreiche Umgebungssuche, kein passender Eintrag | Neuanlage vorbereiten; nur entscheidende Lücken klären. |
| Mehrere plausible Einträge | Kurze Auswahl: „Welcher ist es?“ mit unterscheidbaren Standortangaben. |
| Nur ein Wegweiser oder eine eindeutig leere Halterung erkennbar | Kein AED erkannt; um ein direktes Foto des Geräts oder Gehäuses bitten. Ein eindeutig erkennbares AED-Gehäuse zählt als positive Erkennung, auch wenn das Gerät darin nicht sichtbar ist. |
| Bild unscharf oder Erkennung unsicher | „Bitte noch ein Foto“ statt geratenen Daten. |
| OSM-Abfrage fehlgeschlagen | Erneut versuchen; ein Fehler bedeutet nicht, dass noch kein Eintrag existiert. |
| Upload fehlgeschlagen oder Ergebnis unklar | Aufnahme erhalten, Serverzustand prüfen und Doppelanlage vermeiden. |

Nähe allein reicht nicht zur Zuordnung: In einem Gebäude können mehrere AEDs stehen. Das Foto liefert sichtbare Hinweise, GPS die ungefähre Lage und OSM die vorhandenen Einträge. Die App führt diese Informationen zusammen; ein verlässlicher Abgleich setzt kein bereits vorhandenes Vergleichsfoto in OSM voraus.

## Umfang des ersten Prototyps

Fotoaufnahme, manuelle Sichtbestätigung, Suche in der Umgebung, Zuordnung und die beiden Speicherwege „neu eintragen“ und „noch vorhanden“. Rückfragen erscheinen ausschließlich dort, wo der konkrete Vorgang sie benötigt.

Karte, Tags und technische Details bleiben im Hintergrund. Punkte, Ranglisten, öffentliche Fotogalerien und zusätzliche Erfassungsfunktionen stehen hinter dem einfachen Hauptablauf zurück. Eine PWA wie Hydrantenjäger bleibt ein technischer Kandidat.

## Nächster praktischer Schritt

Mit wenigen echten Fotos den gesamten Ablauf erproben: neues Gerät, bereits eingetragenes Gerät, mehrere Geräte am selben Ort, Hinweisschild und undeutliches Foto. Dabei zunächst nur Änderungsvorschläge erzeugen. Entscheidend ist, ob die App zuverlässig zuordnet und wie oft sie eine Rückfrage braucht.
