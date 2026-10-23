# Entscheidungen und nächste Schritte

Stand: 23.10.2026. Fotoaufnahme und maximale Einfachheit sind festgelegt: **Foto → prüfen → vorhandenen AED kurz bestätigen oder neuen AED eintragen.** GPT-6 Luna ist als erstes Bildmodell gewählt. Die Oberfläche kann nach bewusster Auswahl ein bereinigtes Foto an die geschützte Bildanalyse-Route senden; sie zeigt ausschließlich validierte Bildbeobachtungen und löst keine OSM-Änderung aus. Die Cloudflare-D1-Pilotdatenbank ist angelegt, gebunden und migriert. Der Worker wurde noch nicht veröffentlicht und die Analyse ist ohne die nötigen Betreiberfreigaben abgeschaltet.

## Festgelegt

- Die App ist als mobile PWA mit gemeinsam gehosteter Oberfläche und API auf Cloudflare vorgesehen. Ein lokaler PWA-Prototyp ist begonnen; ein Cloudflare-Deployment gibt es noch nicht.
- Vor dem AED wird ein Foto aufgenommen. Die KI prüft, ob ein AED zu sehen ist, und liest nur klar erkennbare Angaben aus.
- Der Standort wird mit bestehenden OpenStreetMap-Einträgen abgeglichen. Ein passender Treffer wird als „noch vorhanden“ bestätigt; ohne Treffer wird ein neuer Eintrag vorbereitet.
- Im eindeutigen Fall genügt eine kurze Bestätigung für den OSM-Schreibvorgang.
- Die erste Version soll Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch unterstützen.
- Im Pilot wird Gamification nur intern gezählt: erfolgreiche Vor-Ort-Prüfungen nach bestätigtem OSM-Vorgang. Es gibt keine sichtbare Anzeige und keine Teilfunktion. Teilen wird frühestens nach dem Pilot neu bewertet.
- Vorbild bleibt Hydrantenjäger. Der Produktname ist „AEDjaeger“ und wird in allen Sprachen gleich geschrieben.
- Der erste Prototyp nutzt Vite und TypeScript ohne React. Die Auswahl hält den mobilen Ablauf klein und benötigt kein React-spezifisches Zustandssystem. Die produktive Zielarchitektur bleibt Cloudflare Workers mit Static Assets.
- Die erste API-Bildanalyse soll OpenAI GPT-6 Luna (`gpt-6-luna`) verwenden. Kein höheres OpenAI-Modell ohne neue Entscheidung. Ein explorativer Test erkannte drei positive Testbilder als AED; negative und unklare Testfälle stehen noch aus.

## Nächste praktische Prüfungen

1. Den lokalen Fotoablauf auf Android und iPhone prüfen, einschließlich Berechtigungen, Sprachwechsel und schmaler Darstellung. Am 18.10.2026 meldete der Nutzer, dass Fotoaufnahme und Auswahl aus der Bibliothek über die private WLAN-/VPN-Vorschau funktionieren; Gerät und Browser sind nicht dokumentiert. Die HTTP-Vorschau prüft weder Installation noch Offlinebetrieb der PWA.
2. Die [erste explorative ChatGPT-Prüfung](bildtest.md#erste-explorative-chatgpt-prüfung) als qualitative Vorprüfung einordnen; die standardisierte Wiederholung mit dem einheitlichen Prompt und den fünf Bildklassen im Bildtest durchführen. Die sieben bereinigten lokalen Kopien wurden am 18.10.2026 mit ausdrücklicher Freigabe ausschließlich an ChatGPT gesendet. Für andere Anbieter oder weitere Bilder ist eine gesonderte Freigabe erforderlich.
3. Die [explorative OpenAI-API-Prüfung](bildtest.md) ist am 19.10.2026 mit drei bereinigten Spaziergangsfotos erfolgt. Sie ist ein Machbarkeitstest, kein kontrollierter Modellvergleich. Anschließend den Testsatz um leere Halterung, mehrere Geräte, Poster ohne Gerät, ähnliche Gegenstände und unklare Bilder erweitern; nur ausdrücklich freigegebene Fotos an Anbieter senden.
4. Der isolierte GPT-6-Luna-Adapter unter `server/vision/openai.ts` validiert Bildcontainer, Dateigröße und Modellantwort und ist mit simulierten Aufrufen getestet. Die geschützte Analyse-Route ist standardmäßig abgeschaltet und verlangt eine gültige OSM-Sitzung, eine serverseitige Pilot-Freigabeliste sowie D1-Budgetreservierung und explizite Betreiberlimits vor jedem Modellaufruf. Die PWA bietet für angemeldete Pilotnutzer einen getrennten, ausdrücklich ausgelösten Analyseknopf. Vor dem Senden wird das Bild im Browser komprimiert, auf 1600 Pixel begrenzt und als JPEG neu kodiert, wodurch EXIF-/GPS-Metadaten entfallen. Die Oberfläche validiert erneut die Antwort, markiert Beobachtungen als KI-Aussagen und wiederholt fehlgeschlagene oder unklare Anfragen nicht automatisch. Umgebungssuche und OSM-Schreiben sind noch nicht angebunden. OSM-Loginstart, Callback, OIDC-Prüfung, kurzlebige D1-Sitzungen und Abmeldung sind umgesetzt. Betreiberlimits und die konkrete Pilot-Freigabeliste müssen vor Aktivierung festgelegt werden. Der Worker wurde noch nicht veröffentlicht.
5. Den OSM-Abgleich mit Testdaten als Vorschau erproben, einschließlich mehrerer Geräte in einem Gebäude, ungenauem GPS und fehlgeschlagener Suche.

## Noch zu entscheiden

- Welche Erkennungsqualität erreicht GPT-6 Luna bei vorab annotierten positiven, negativen und unklaren Beispielen? Der erste Drei-Bilder-Test ist dafür zu klein.
- Welche maximale Kostenreservierung pro Anfrage sowie Nutzer- und Gesamt-Tageslimits sollen für die ersten API-Tests gelten? Die geschützte Analyse-Route ist implementiert, aber standardmäßig abgeschaltet und ruft ohne Freigabeliste und alle drei Kostenwerte kein Modell auf. Die Reservierung muss mindestens die aktuelle Obergrenze für ein maximal zulässiges GPT-6-Luna-Bild abdecken.
- Welche OSM-Subjekte dürfen die Analyse im Pilot nutzen? Der Endpunkt verlangt eine serverseitige `AI_ANALYSIS_ALLOWED_OSM_SUBJECTS`-Freigabeliste mit höchstens 100 Subjekten und bleibt ohne sie deaktiviert.
- Welche Kostenreservierung und Tageslimits sollen vor der Aktivierung der Bildanalyse gesetzt werden? Zusätzlich fehlen Umgebungssuche, Kandidatenvorschau und eine sichtbare Bestätigung; OSM-Schreiben bleibt ausgeschaltet.
- Welche minimalen Pflichtangaben sind bei Neuanlagen tatsächlich nötig, und wann ist eine Standortkorrektur erforderlich?
- Reicht Cloudflare Free für den Pilot? Workers Paid (mindestens 5 USD pro Monat) erst aktivieren, falls Free-Grenzen oder ein konkreter Betriebsbedarf es erforderlich machen. Eigene Domain ebenfalls erst dann wählen, wenn sie gebraucht wird.
- Welche Lizenz passt zum Projekt?
- Nach dem Pilot: Ist eine sichtbare oder teilbare Fortschrittskarte den Aufwand und die Datenschutzprüfung wert?

Für die spätere kontrollierte Aktivierung des API-Endpunkts sind serverseitig
`OPENAI_API_KEY`, `AI_ANALYSIS_ENABLED=true`, `AI_ANALYSIS_ALLOWED_OSM_SUBJECTS`, `AI_ANALYSIS_COST_RESERVATION_MICROS`,
`AI_ANALYSIS_USER_DAILY_LIMIT_MICROS` und `AI_ANALYSIS_GLOBAL_DAILY_LIMIT_MICROS`
erforderlich. Aktuell sind keine dieser Aktivierungswerte gesetzt. Die Reservierung
muss anhand einer belastbaren Obergrenze pro zulässigem Bild berechnet werden; ein
Kontolimit beim Anbieter ersetzt die anfragebezogene Reservierung in D1 nicht.

Vor einem Pilot müssen Verarbeitung und Aufbewahrung beim ausgewählten Dienst geprüft und verständlich erklärt werden. Öffentliche Bildspeicherung ist keine Produktfunktion. Die Beispielszenarien bleiben lokal; ausschließlich der sichtbare Analyseknopf übermittelt nach ausdrücklicher Betätigung ein bereinigtes Foto an die geschützte API, wenn sie konfiguriert und freigeschaltet ist.

## Bereits recherchiert

Für „noch vorhanden“ ist `check_date` laut OSM-Dokumentation geeignet. Die Anwendung bestätigt damit keine Gerätewartung und verändert keine anderen Eigenschaften. Für die technische Arbeit liegt ein [Plan mit überprüfbaren Etappen](umsetzungsplan.md) vor. Das [Repository](https://github.com/FrnkMrz/AEDjaeger) ist öffentlich; die Lizenz ist noch offen.
