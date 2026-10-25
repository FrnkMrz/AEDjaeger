# AEDjaeger-Testlauf

Stand: 25.10.2026. Diese Anleitung beschreibt den derzeit verfügbaren Handy-Test. Die öffentliche Vorschau ist erreichbar, aber KI-Analyse, OSM-Login und OSM-Schreibvorgänge sind noch nicht freigeschaltet.

## Einen lokalen Demoablauf starten

1. Auf der Startseite **„Vorschau testen“** öffnen.
2. Ein Beispielszenario auswählen, zum Beispiel **„Schon in OpenStreetMap“** oder **„Noch nicht eingetragen“**.
3. Optional **„Diesen Testlauf zur Fehlersuche protokollieren“** aktivieren. Das ist eine freiwillige Freigabe für wenige Ablaufereignisse.
4. Ein Foto aufnehmen oder aus der Mediathek auswählen.
5. **„Demoablauf simulieren“** antippen.

Die Demo wertet das Foto nicht aus. Sie zeigt das vorab ausgewählte Beispielszenario; deshalb kann auch ein Foto von Schuhen ein AED-Beispielergebnis anzeigen. Das ist kein KI-Ergebnis. Das Foto bleibt auf dem Gerät; die Demo sendet weder Bild noch Standort an den Server und ändert nichts in OpenStreetMap.

## Diagnose-Logs ansehen

Bei aktivierter Diagnose sendet die App nur feste Ereigniscodes und eine zufällige Lauf-ID. Die Logs enthalten keine Fotos, GPS-Koordinaten, OSM-Konto-IDs, URLs oder Tokens. Die Cloudflare-Einstellung schaltet automatische Request-Logs aus, damit insbesondere OAuth-Rücksprung-URLs nicht protokolliert werden.

In Cloudflare: **Workers & Pages → AEDjaeger → Observability → Logs**. Nach `source = aedjaeger-test` filtern. Ereignisse derselben Ausführung haben dieselbe `flowId` und können über `occurredAt` zeitlich sortiert werden. Mögliche Ereignisse sind `test_run_started`, `photo_selected`, `live_flow_blocked`, `demo_started`, `demo_result_shown` und `demo_confirmed`. Bei einem Live-Aufruf gibt es zusätzlich `live_analysis_*` und `nearby_search_*`.

Im Workers-Free-Tarif sind Workers Logs laut Cloudflare derzeit bis zu 3 Tage verfügbar und bis zu 200.000 Logereignisse pro Tag enthalten. Die Daten werden nicht in AEDjaeger-D1 gespeichert. Die genaue Kontonutzung ist im Cloudflare-Dashboard sichtbar.

## Live-Ablauf

Ein echter Foto-Test ist derzeit nicht verfügbar. Der Live-Button erscheint erst, wenn die OSM-Anmeldung und die KI-Route vollständig konfiguriert und das Konto ausdrücklich freigeschaltet sind. Der OSM-Testserver-Schreibweg bleibt davon getrennt und zusätzlich deaktiviert.
