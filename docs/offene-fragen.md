# Entscheidungen und nächste Schritte

Stand: 18.10.2026. Fotoaufnahme und maximale Einfachheit sind festgelegt: **Foto → prüfen → vorhandenen AED kurz bestätigen oder neuen AED eintragen.** Der lokale Bedienprototyp ist begonnen; er enthält noch keine echte KI-, Standort-, Server- oder OSM-Anbindung.

## Festgelegt

- Die App ist als mobile PWA mit gemeinsam gehosteter Oberfläche und API auf Cloudflare vorgesehen. Ein lokaler PWA-Prototyp ist begonnen; ein Cloudflare-Deployment gibt es noch nicht.
- Vor dem AED wird ein Foto aufgenommen. Die KI prüft, ob ein AED zu sehen ist, und liest nur klar erkennbare Angaben aus.
- Der Standort wird mit bestehenden OpenStreetMap-Einträgen abgeglichen. Ein passender Treffer wird als „noch vorhanden“ bestätigt; ohne Treffer wird ein neuer Eintrag vorbereitet.
- Im eindeutigen Fall genügt eine kurze Bestätigung für den OSM-Schreibvorgang.
- Die erste Version soll Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch unterstützen.
- Im Pilot wird Gamification nur intern gezählt: erfolgreiche Vor-Ort-Prüfungen nach bestätigtem OSM-Vorgang. Es gibt keine sichtbare Anzeige und keine Teilfunktion. Teilen wird frühestens nach dem Pilot neu bewertet.
- Vorbild bleibt Hydrantenjäger. Der Produktname ist „AEDjaeger“ und wird in allen Sprachen gleich geschrieben.
- Der erste Prototyp nutzt Vite und TypeScript ohne React. Die Auswahl hält den mobilen Ablauf klein und benötigt kein React-spezifisches Zustandssystem. Die produktive Zielarchitektur bleibt Cloudflare Workers mit Static Assets.

## Nächste praktische Prüfungen

1. Den lokalen Fotoablauf auf Android und iPhone prüfen, einschließlich Berechtigungen, Sprachwechsel und schmaler Darstellung. Am 18.10.2026 meldete der Nutzer, dass Fotoaufnahme und Auswahl aus der Bibliothek über die private WLAN-/VPN-Vorschau funktionieren; Gerät und Browser sind nicht dokumentiert. Die HTTP-Vorschau prüft weder Installation noch Offlinebetrieb der PWA.
2. Die [erste explorative ChatGPT-Prüfung](bildtest.md#erste-explorative-chatgpt-prüfung) auswerten und die Bildklassen trennen: Gerät sichtbar, nur AED-Gehäuse, nur Wegweiser, anderer Gegenstand oder unklar. Die sieben bereinigten lokalen Kopien wurden am 18.10.2026 mit ausdrücklicher Freigabe ausschließlich an ChatGPT gesendet. Für andere Anbieter oder weitere Bilder ist eine gesonderte Freigabe erforderlich.
3. Einen erweiterten, rechtmäßig nutzbaren und vorab annotierten Bildtestsatz vervollständigen: leere Halterung, mehrere Geräte, Poster ohne Gerät, ähnliche medizinische Gegenstände und schwierige Bilder. Danach Prompt und Schema vereinheitlichen und jedes Bild in einer eigenen Unterhaltung bewerten. Der erste Durchgang ist wegen unterschiedlicher Prompts und gemeinsamem Gesprächskontext kein kontrollierter Vergleich.
4. Erst nach der standardisierten manuellen Vorprüfung Gemini Developer API Free für den tatsächlichen API-Ablauf prüfen. Kostenpflichtige OpenAI- oder Claude-API-Aufrufe nur bei bestätigtem Guthaben und gesetztem Ausgabenlimit.
5. Den OSM-Abgleich mit echten Standorten als Vorschau erproben, einschließlich mehrerer Geräte in einem Gebäude und ungenauem GPS.

## Noch zu entscheiden

- Welcher API-Anbieter besteht den Bildtest mit ausreichender Zuverlässigkeit, Datenschutzbedingungen, Wartezeit und Kosten? Chat-Abos erlauben manuelle Tests, sind aber kein API-Zugang. Vor API-Tests kostenlose Quoten, vorhandenes Guthaben und Abrechnung prüfen.
- Welche minimalen Pflichtangaben sind bei Neuanlagen tatsächlich nötig, und wann ist eine Standortkorrektur erforderlich?
- Reicht Cloudflare Free für den Pilot? Workers Paid (mindestens 5 USD pro Monat) erst aktivieren, falls Free-Grenzen oder ein konkreter Betriebsbedarf es erforderlich machen. Eigene Domain ebenfalls erst dann wählen, wenn sie gebraucht wird.
- Welche Lizenz passt zum Projekt?
- Nach dem Pilot: Ist eine sichtbare oder teilbare Fortschrittskarte den Aufwand und die Datenschutzprüfung wert?

Für die Anbieterbewertung wird ein aktiver Dienst für den Produktbetrieb ausgewählt. Vor dem Versand echter Fotos müssen die Verarbeitung und Aufbewahrung beim ausgewählten Dienst geprüft und verständlich erklärt werden. Öffentliche Bildspeicherung ist keine Produktfunktion. Der erste Prototyp überträgt keine Fotos an externe Dienste.

## Bereits recherchiert

Für „noch vorhanden“ ist `check_date` laut OSM-Dokumentation geeignet. Die Anwendung bestätigt damit keine Gerätewartung und verändert keine anderen Eigenschaften. Für die technische Arbeit liegt ein [Plan mit überprüfbaren Etappen](umsetzungsplan.md) vor. Das [Repository](https://github.com/FrnkMrz/AEDjaeger) ist öffentlich; die Lizenz ist noch offen.
