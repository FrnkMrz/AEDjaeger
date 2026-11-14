# Cloudflare: API-Drosselung

Die Drosselungsregel wird im Cloudflare-Dashboard der Zone erstellt. Dieses Dokument ist die vorbereitete Einstellung; es ändert selbst nichts am Dashboard und aktiviert keinen kostenpflichtigen Tarif.

## Regel für den Pilot

1. Im Dashboard die Zone `aedjaeger.de` öffnen und **Security rules → Create rule → Rate limiting rules** wählen.
2. Name: `AEDjaeger API rate limit`.
3. Anfragen nach URI-Pfad filtern: **Path starts with `/api/`**.
4. Zähler nach **IP address** gruppieren.
5. Als Schwelle zunächst **60 Anfragen pro 1 Minute** einstellen.
6. Aktion: **Block**, Dauer **1 Minute**. Danach speichern und aktivieren.
7. Prüfen, dass die Regel nur `/api/` erfasst und die Startseite, Assets sowie Service-Worker-Dateien davon unberührt bleiben.

Die aktuelle Cloudflare-Tabelle nennt eine Rate-Limiting-Regel im Free-Tarif; dort stehen beim Ausdruck nur Pfadfelder zur Verfügung. Vor dem Speichern im Dashboard die für die Zone angezeigten Tarifoptionen prüfen. Falls Pfad, IP-Zähler, Zeitraum oder Aktion im bestehenden Free-Tarif nicht auswählbar sind, die Regel nicht durch einen Tarifwechsel oder Zusatzkauf erzwingen; stattdessen diese Einschränkung dokumentieren und Rücksprache halten. Siehe [Cloudflare: verfügbare Rate-Limiting-Funktionen](https://developers.cloudflare.com/waf/rate-limiting-rules/) und [Regel im Dashboard erstellen](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/).

Nach Aktivierung in der Sicherheitsereignis-Ansicht prüfen, ob normale Foto-, Such- und Speicherabläufe nicht gedrosselt werden. Bei Fehlalarmen die Schwelle anpassen oder die Regel deaktivieren. Cloudflare zählt pro IP-Adresse; gemeinsam genutzte Netze können daher mehrere Personen zusammenfassen.
