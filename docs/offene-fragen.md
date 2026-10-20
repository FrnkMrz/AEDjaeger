# Entscheidungen und nächste Schritte

Stand: 19.10.2026. Fotoaufnahme und maximale Einfachheit sind festgelegt: **Foto → prüfen → vorhandenen AED kurz bestätigen oder neuen AED eintragen.** GPT-6 Luna ist als erstes Bildmodell gewählt; der lokale Bedienprototyp enthält weiterhin keine echte KI-, Standort-, Server- oder OSM-Anbindung.

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
4. Der isolierte GPT-6-Luna-Adapter unter `server/vision/openai.ts` validiert Bildsignatur, Dateigröße und Modellantwort und ist mit simulierten Aufrufen getestet. Eine D1-Migration und atomare Kostenreservierung sind vorbereitet, aber noch nicht eingebunden. PKCE-Helfer für OSM verwenden den Login-Scope `openid` und erzeugen einen OIDC-Nonce; sie speichern keine OAuth-Transaktion, lösen keinen Code ein, prüfen keine OIDC-Identität und erzeugen keine Sitzung. Als Nächstes folgen kurzlebige, einmalig verwendbare, browsergebundene Transaktionen, serverseitige Code-zu-Token-Einlösung, kryptografische Prüfung von Signatur, Issuer, Audience und Nonce sowie geschützte Sitzung. Nutzer-/Gesamttageslimits und D1-Bindung müssen festgelegt werden; erst nach geschützter Anmeldung und Betreiberlimits darf eine Worker-Analyse-Route den Adapter aufrufen. Noch keine OSM-Schreibfunktion.
5. Den OSM-Abgleich mit Testdaten als Vorschau erproben, einschließlich mehrerer Geräte in einem Gebäude, ungenauem GPS und fehlgeschlagener Suche.

## Noch zu entscheiden

- Welche Erkennungsqualität erreicht GPT-6 Luna bei vorab annotierten positiven, negativen und unklaren Beispielen? Der erste Drei-Bilder-Test ist dafür zu klein.
- Welche maximalen KI-Ausgaben pro Nutzer und pro Tag sollen im Pilot gelten? Die Reservierungslogik setzt selbst keine Beträge oder Limits fest.
- Welche minimalen Pflichtangaben sind bei Neuanlagen tatsächlich nötig, und wann ist eine Standortkorrektur erforderlich?
- Reicht Cloudflare Free für den Pilot? Workers Paid (mindestens 5 USD pro Monat) erst aktivieren, falls Free-Grenzen oder ein konkreter Betriebsbedarf es erforderlich machen. Eigene Domain ebenfalls erst dann wählen, wenn sie gebraucht wird.
- Welche Lizenz passt zum Projekt?
- Nach dem Pilot: Ist eine sichtbare oder teilbare Fortschrittskarte den Aufwand und die Datenschutzprüfung wert?

Vor einem Pilot müssen Verarbeitung und Aufbewahrung beim ausgewählten Dienst geprüft und verständlich erklärt werden. Öffentliche Bildspeicherung ist keine Produktfunktion. Die lokale Demo überträgt weiterhin keine Fotos an externe Dienste.

## Bereits recherchiert

Für „noch vorhanden“ ist `check_date` laut OSM-Dokumentation geeignet. Die Anwendung bestätigt damit keine Gerätewartung und verändert keine anderen Eigenschaften. Für die technische Arbeit liegt ein [Plan mit überprüfbaren Etappen](umsetzungsplan.md) vor. Das [Repository](https://github.com/FrnkMrz/AEDjaeger) ist öffentlich; die Lizenz ist noch offen.
