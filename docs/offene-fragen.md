# Entscheidungen und nächste Schritte

Stand: 17.10.2026. Fotoaufnahme und maximale Einfachheit sind festgelegt: **Foto → prüfen → vorhandenen AED kurz bestätigen oder neuen AED eintragen.**

## Festgelegt

- Die App ist als mobile PWA mit gemeinsam gehosteter Oberfläche und API auf Cloudflare vorgesehen. Implementierung und Deployment haben noch nicht begonnen.
- Vor dem AED wird ein Foto aufgenommen. Die KI prüft, ob ein AED zu sehen ist, und liest nur klar erkennbare Angaben aus.
- Der Standort wird mit bestehenden OpenStreetMap-Einträgen abgeglichen. Ein passender Treffer wird als „noch vorhanden“ bestätigt; ohne Treffer wird ein neuer Eintrag vorbereitet.
- Im eindeutigen Fall genügt eine kurze Bestätigung für den OSM-Schreibvorgang.
- Die erste Version soll Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch unterstützen.
- Im Pilot wird Gamification nur intern gezählt: erfolgreiche Vor-Ort-Prüfungen nach bestätigtem OSM-Vorgang. Es gibt keine sichtbare Anzeige und keine Teilfunktion. Teilen wird frühestens nach dem Pilot neu bewertet.
- Vorbild bleibt Hydrantenjäger. „AEDjäger“ ist ein Arbeitsname.
- Das Repository sammelt Recherche und Umsetzungskonzept; Anwendungscode ist noch nicht implementiert.

## Nächste praktische Prüfungen

1. Einen kleinen, rechtmäßig nutzbaren Bildtestsatz für Gemini, OpenAI und Claude zusammenstellen: sichtbares Gerät, Beschriftung, Kasten, Wegweiser, leere Halterung, mehrere Geräte und schwierige Bilder.
2. Alle Anbieter mit identischem Testsatz und Auftrag vergleichen: falsche Erkennung, korrekte Felder, nötige Rückfragen, Wartezeit und gemessene Kosten. Keine Nutzerfotos automatisch an mehrere Anbieter weiterreichen.
3. Den OSM-Abgleich mit echten Standorten als Vorschau erproben, einschließlich mehrerer Geräte in einem Gebäude und ungenauem GPS.
4. Einen durchgehenden Ablauf „Foto → Ergebnis → kurze Bestätigung“ auf einem Mobilgerät vorführen.

## Noch zu entscheiden

- Welcher der drei KI-Anbieter besteht den Bildtest mit ausreichender Zuverlässigkeit, Datenschutzbedingungen, Wartezeit und Kosten? Der Initiator berichtet von ungefähr 20 US-Dollar API-Guthaben oder Budget je Anbieter sowie bereits erprobten API-Tokens bei OpenAI und Claude. Guthaben, Abrechnung und nutzbare Modelle vor dem Vergleich prüfen.
- Welche minimalen Pflichtangaben sind bei Neuanlagen tatsächlich nötig, und wann ist eine Standortkorrektur erforderlich?
- Welche Domain wird verwendet, und wie werden Cloudflare-Konto, API-Schlüssel und Kostenlimits sicher eingerichtet?
- Welcher endgültige App-Name und welche Lizenz passen zum Projekt?
- Nach dem Pilot: Ist eine sichtbare oder teilbare Fortschrittskarte den Aufwand und die Datenschutzprüfung wert?

Für die Anbieterbewertung wird ein aktiver Dienst für den Produktbetrieb ausgewählt. Vor dem Versand echter Fotos müssen die Verarbeitung und Aufbewahrung beim ausgewählten Dienst geprüft und verständlich erklärt werden. Öffentliche Bildspeicherung ist keine Produktfunktion.

## Hosting-Optionen: Stand der Diskussion

Stand: 17.10.2026. Noch keine Entscheidung; Cloudflare Workers bleibt die Architekturempfehlung (siehe [Architektur](architektur.md#hosting-alternativen)).

**Kosten Cloudflare** (laut Cloudflare-Dokumentation, abgerufen am 17.10.2026):

- Free: 100.000 Worker-Anfragen pro Tag, 10 ms CPU-Zeit je Anfrage; D1 mit 5 Mio. gelesenen und 100.000 geschriebenen Zeilen pro Tag sowie 5 GB Speicher. Statische Dateien kosten nichts.
- Workers Paid: ab 5 US-Dollar pro Monat, 20 Mio. Anfragen inklusive.
- Offenes Risiko: Die 10 ms CPU-Zeit im Free-Tarif können bei Bildprüfung und Token-Verschlüsselung knapp werden. Früh messen.
- Zusätzlich fallen Domain (ca. 10–15 € pro Jahr) und KI-Kosten pro Foto an. Die KI-Kosten sind der größere Posten und noch nicht gemessen.

**Nur GitHub Pages:** kostenlos (private Repos brauchen einen bezahlten GitHub-Plan), Limits 1 GB Seitengröße und 100 GB Traffic pro Monat (weich). Es läuft kein Servercode, also bleibt der KI-Schlüssel nicht geheim. Geeignet für Phase 2 (Vorschau mit simulierten Diensten), ab Phase 3 (echte KI) wird ein Server nötig. Pages und ein Cloudflare Worker nur für die API lassen sich kombinieren; Aufwand: zwei Deployments und CORS.

**Eigener Server in einer VM:**

- Kamera und Standort brauchen HTTPS. Das Handy muss die VM erreichen; bei Heimanschlüssen mit DS-Lite oder CGNAT scheitert Port-Weiterleitung.
- Lösung ist ein Cloudflare Tunnel. Er baut die Verbindung von der VM nach außen auf, deshalb ist keine Port-Weiterleitung nötig.
- **Quick Tunnel** (`trycloudflare.com`): kostenlos, aber die Adresse wechselt bei jedem Start. Das OSM-Login braucht eine feste Rückkehr-Adresse; PWA-Installation und lokale Entwürfe hängen an der Adresse. Nur für kurze Handytests geeignet; Cloudflare sagt keine Verfügbarkeit zu.
- **Benannter Tunnel** mit eigener Domain: feste Adresse, kostenlos plus Domain. Nötig, sobald das OSM-Login dazukommt (Phase 3 und 4).
- **Tailscale:** kostenlos für den privaten Gebrauch, aber nur eigene Geräte erreichen den Server. Gut für Tests allein, nicht für Pilotnutzer.
- Bei dieser Variante entfallen Workers und D1; es gäbe einen Node-Server mit SQLite. Updates, Backups und Absicherung der VM liegen beim Betreiber. Die Architekturdokumente müssten dann angepasst werden.
- Eine VM läuft nur, solange der Host läuft. Für den Pilot mit Fremden eher ungeeignet, weil Uploads sonst im Zustand „Ergebnis unklar“ hängen.

**Zu klären (Projektinitiator):**

- Wie war die Tunnel-Adresse beim früheren Test für ODM: eigene Domain (benannter Tunnel) oder `trycloudflare.com` (Quick Tunnel)? Nachsehen mit `cloudflared tunnel list` auf der VM oder im Cloudflare-Dashboard unter Zero Trust → Networks → Tunnels.
- Existiert ein Cloudflare-Konto, und gibt es eine eigene Domain?

**Vorläufige Empfehlung:** Phase 1 lokal ohne Tunnel; Phase 2 auf Pages oder lokal; erster Handytest per Quick Tunnel oder Tailscale; ab Phase 3 benannter Tunnel oder Cloudflare Workers; Pilot mit fremden Nutzern auf Cloudflare Workers.

## Bereits recherchiert

Für „noch vorhanden“ ist `check_date` laut OSM-Dokumentation geeignet. Die Anwendung bestätigt damit keine Gerätewartung und verändert keine anderen Eigenschaften. Für die technische Arbeit liegt ein [Plan mit überprüfbaren Etappen](umsetzungsplan.md) vor. Das [Repository](https://github.com/FrnkMrz/AEDjaeger) ist zunächst privat.
