# OSM-Datenmodell und technische Grundlagen

Stand: **10.11.2026**. Fachliche Grundlage: [deutsche Tagging-Seite](https://wiki.openstreetmap.org/wiki/DE:Tag:emergency=defibrillator) und [englische Tagging-Seite](https://wiki.openstreetmap.org/wiki/Tag:emergency=defibrillator). Die UI-Zuordnung ist unser Entwurf.

> **Aktueller Pilot:** Die Person bestätigt selbst, dass ein AED oder AED-Gehäuse im Foto sichtbar ist. Das Foto wird nicht an einen Bilddienst gesendet. PR #49 hat die Umgebungssuche auf das bestehende OpenFireMap-PMTiles-Archiv umgestellt; der Stand wurde am 9.11.2026 gemergt und erfolgreich deployed. Der reale Handy-Suchlauf nach dem Deploy ist noch offen. `OSM_DEV_WRITES_ENABLED` bleibt aus. Frühere Abschnitte zur geplanten KI-Bildanalyse oder Overpass-Laufzeit beschreiben historische Zwischenstände.

Für die kompakte Übergabe siehe [Übergabe](uebergabe.md). `pipeline.openfiremap.org` ist für AEDjaeger ausschließlich der Host der lesend genutzten PMTiles-Datei und Metadaten. AEDjaeger löst keinen Pipeline-Lauf aus und hat keine Verbindung zu Proxmox oder VM102. Leere PMTiles-Suchen werden in einer angemeldeten Dev-Sitzung zusätzlich mit einem begrenzten OSM-Dev-`map.json`-Abruf abgesichert; dieser Endpunkt ist kein Overpass-Fallback und ersetzt keine Kandidatensuche.

## Mögliche Datenfelder im Hintergrund

Diese Tabelle ist kein Pflichtformular. Die Sichtbestätigung der Person und vorhandene OSM-Daten liefern Angaben, soweit sie belastbar sind. Bei einem schon erfassten Gerät wird im Normalfall nur dessen Vorhandensein bestätigt; siehe [Produktkonzept](konzept.md).

| Frage / Information | OSM-Tag | Behandlung im Entwurf |
| --- | --- | --- |
| Objekttyp | `emergency=defibrillator` | Bei Neuanlage automatisch setzen. |
| Wo genau befindet sich der AED? | `defibrillator:location=*` | Kurzer Freitext mit Eingang, Raum oder Orientierungspunkt. |
| Wer hat Zugang? | `access=*` | Auswahl erläutern, etwa `yes`, `customers` oder `private`; Details vor Umsetzung abgleichen. |
| Wann ist er zugänglich? | `opening_hours=*` | `24/7` nur bei bestätigter durchgehender Zugänglichkeit. |
| Drinnen oder draußen? | `indoor=yes/no` | Nur bei eindeutiger Bildinformation oder gezielter Antwort. |
| Stockwerk | `level=*`, gegebenenfalls `level:ref=*` | Optional; Zählebene und Beschriftung unterscheiden. |
| Vor Ort noch vorhanden am | `check_date=YYYY-MM-DD` | Nach tatsächlicher Sichtung und Benutzerbestätigung; Beobachtungsdatum verwenden. |
| Betreiber | `operator=*` | Optional. |

Ein unbekannter Wert bleibt bei Neuanlage ohne Tag. Bei Bearbeitungen darf „nicht beantwortet“ bestehende Angaben nicht löschen. „Unbekannt“ ist keine pauschale Aufforderung, `unknown` nach OSM zu schreiben.

Die [Dokumentation zu `check_date`](https://wiki.openstreetmap.org/wiki/Key:check_date) erlaubt ausdrücklich die Dokumentation der überprüften Existenz. Unsere frühere Forderung nach einem noch zu bestimmenden gesonderten Tag war daher zu streng. Spezifische Prüfdatums-Tags anderer Eigenschaften bleiben unverändert.

Das Prüfdatum beschreibt den Tag der tatsächlichen Beobachtung, auch wenn ein älteres Foto verwendet wird. Beide OSM-Entwicklungs-Schreibrouten akzeptieren deshalb vergangene, gültige Kalenderdaten, nachdem die Person sie ausdrücklich bestätigt hat. Ungültige oder zukünftige Daten werden serverseitig abgewiesen. Ein älteres Prüfdatum darf ein neueres vorhandenes Datum weiterhin nicht zurücksetzen.

## Eigene Regeln für eine verlässliche Erfassung

- Einen Punkt am Gerät anlegen; ein AED-Hinweisschild ist nicht zwangsläufig der Gerätestandort.
- Zugang und Uhrzeiten getrennt behandeln: Ein öffentlich zugängliches Gerät kann nachts eingeschlossen sein.
- Keine Verfügbarkeit aus „draußen“ ableiten und keine automatische Übernahme von Gebäudeöffnungszeiten.
- Das Prüfdatum bezeichnet eine Ortsbesichtigung für die Kartierung, keine Funktionsprüfung oder Wartung.
- Einen vermuteten Standort zunächst als lokalen Entwurf behandeln. Keine scheinbar genaue Position aus ungenauen GPS-Daten erzeugen.
- Vorhandene fremde Tags erhalten. Entfernen, Umzug und widersprüchliche Angaben brauchen einen eigenen Bearbeitungsablauf.

## Aktueller OSM-Datenzugriff: AED-Ebene im PMTiles-Archiv

Die Umgebungssuche liest vorhandene AED-Knoten direkt aus der `defibrillators`-Vektorebene im Kartenarchiv `https://pipeline.openfiremap.org/openfiremap.pmtiles`. Der Worker verwendet ausschließlich diesen fest eingebauten HTTPS-Ursprung; der Browser kann keine andere Datenquelle vorgeben. Vor der Suche prüft er `metadata.json`: erfolgreicher DACHLiLu-Datenlauf, Archivname und -größe, AED-Zähler, Datenalter von höchstens 48 Stunden sowie frische erfolgreiche Extrakte für Deutschland, Österreich, die Schweiz, Luxemburg und Liechtenstein.

PMTiles ist ein gekacheltes Archiv. Der Worker lädt nicht das gesamte Archiv herunter: Er liest den Header und ruft danach nur die wenigen Zoom-14-Kacheln um den gewählten Standort mit HTTP-Range-Anfragen ab. Jede Antwort muss den angeforderten Bytebereich exakt als HTTP 206 liefern; Weiterleitungen, Antworten ohne Range und übergroße Bereiche werden abgewiesen. Der Worker prüft zusätzlich den MVT-Kartentyp, die Zoomstufe und dass das Archiv den Suchbereich abdeckt. AED-Punkte werden aus der Vektorebene dekodiert, auf erlaubte OSM-Tags reduziert und im festen Suchradius mit der Positionsgenauigkeit abgeglichen. Die Snapshotkennung wird aus den geprüften Metadaten gebildet.

Veraltete oder fehlende Metadaten, unvollständige Länderextrakte, ungültige Kacheln, fehlende Range-Unterstützung, ein nicht abgedeckter Suchbereich oder ein Upstream-Fehler ergeben einen Fehler. Das ist niemals „keine AEDs“ und erlaubt keine Neuanlage. Das PMTiles-Headerrechteck allein beweist keine vollständige geografische Abdeckung der Länderextrakte. Liefert das Archiv im kleinen Suchradius keinen Treffer, bestätigt die Testserver-Sitzung den Bereich deshalb zusätzlich über den festen, authentifizierten OSM-Dev-Endpunkt `/api/0.6/map.json`. Nur eine vollständige und gültige Antwort dieses begrenzten Ausschnitts kann eine leere Suche bestätigen; ein Fehler, eine zu große Antwort oder ein AED als Fläche/Relation lässt die Suche unvollständig. Diese direkte OSM-Kartenabfrage ist kein Overpass-Aufruf und wird nur für angemeldete Dev-Sitzungen verwendet. Eine leere PMTiles-Suche mit Produktionssitzung bleibt gesperrt. Es gibt weder Overpass-Fallback noch einen zweiten AED-JSON-Feed.

Ein gefundener Kandidat enthält OSM-Tags einschließlich eines vorhandenen `check_date` und die exakte Punktposition, aber keine aktuelle OSM-Objektversion. Vor einer bestätigten Testserver-Änderung liest die Schreibroute das konkrete OSM-Objekt erneut und validiert AED-Klassifikation sowie das bestätigte vorherige `check_date`; ein Existenzupdate ändert ausschließlich `check_date`. Vor einer Neuanlage prüft die Schreibroute den kleinen Zielbereich nochmals auf inzwischen erschienene AEDs. Die Suchbremse verwendet aus Migrationskompatibilität weiterhin den internen D1-Tabellennamen `overpass_search_cooldowns`; es gibt keinen entsprechenden Overpass-API-Aufruf.

Der Browser sendet für eine ausdrücklich gestartete Suche nur die ausgewählten Koordinaten an AEDjaeger. Der Worker fragt damit Metadaten und Kacheln am festen PMTiles-Ursprung ab und gibt dem Browser nur validierte Kandidaten, Snapshotkennung und Datenstand zurück. Foto und EXIF bleiben lokal. Foto, Kontoidentität, Suchergebnisse und Koordinaten erscheinen nicht in Anwendungslogs. Kartenkacheln für die Standortkorrektur lädt die App nur für den sichtbaren Ausschnitt von `https://tile.openstreetmap.org/{z}/{x}/{y}.png` und zeigt `© OpenStreetMap contributors`; das ist unabhängig vom AED-Kartenarchiv. Grundlage: [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

Für den OAuth-Login bestätigt die Worker-Anmeldung die OSM-Identität. Schreibzugriffe sind separat und standardmäßig deaktiviert. Die OSM-Entwicklungsinstanz bleibt einziges zulässiges Schreibziel für Tests; produktives OSM wird in Tests nicht verändert. [OSM OAuth-Dokumentation](https://wiki.openstreetmap.org/wiki/OAuth), [OSM API v0.6](https://wiki.openstreetmap.org/wiki/API_v0.6).

Der vorherige Entwurf mit einem gesonderten AED-Manifest, Index und Zell-Shards ist verworfen. Der aktuelle Code sucht im vorhandenen PMTiles-Archiv. Der Build prüft nur Typen und Frontend-Bundle; ein Live-Abruf des Archivs und ein mobiler Ende-zu-Ende-Test sind damit nicht belegt. Das muss vor einer Pilotfreigabe noch auf der deployten App gegen den öffentlichen Archivserver geprüft werden. Es erfolgten in dieser Änderung kein Deployment und kein OSM-Schreibvorgang.

## Technische Prüfpunkte vor Umsetzung

### OSM-Login: nachgewiesener Cloudflare-Laufzeitfehler

Am 26.10.2026 scheiterten die OSM-Dev-Zustimmungsversuche nach der Rückkehr zur App mit `exchange_code` / `provider_discovery_unreachable`. Die Ursache wurde anschließend mit einer isolierten Probe sowohl lokal in workerd als auch in einer kurzlebigen Cloudflare-Preview reproduziert: Workers lehnt `redirect: "error"` mit `TypeError: Invalid redirect value` ab, bevor eine HTTP-Anfrage gesendet wird. Ein Abruf derselben festen OSM-Dev-Discovery-URL mit `redirect: "manual"` und demselben Zehn-Sekunden-Zeitlimit lieferte in beiden Umgebungen HTTP 200 und gültiges JSON. Die Probe verwendete weder Kontodaten noch Tokens oder Datenbank und wurde danach beendet.

Der vorherige Fehlercode bezeichnete dadurch irreführend einen nicht erreichbaren Anbieter. Ein Netzwerkfehler oder ein ungültiges Client-Secret war zu diesem Zeitpunkt nicht nachgewiesen; der Tokenaustausch wurde noch gar nicht erreicht. Die bisherigen Node-Mocks und der reine Worker-Build erkannten den ungültigen Runtime-Parameter nicht. Der [Cloudflare-Runtime-Quellcode](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B) bestätigt die absichtliche Beschränkung auf `follow` und `manual`.

Die Korrektur verwendet für Discovery, Tokenaustausch, Signaturschlüssel, AED-Feed und Testserver-API den gemeinsamen Baustein `fetchWithoutRedirects`: `manual` folgt keinem Ziel; jede 3xx-Antwort wird ohne Übernahme von Location oder Antworttext abgelehnt. OIDC-Signatur, Issuer, Audience, Nonce, PKCE und serverseitige Tokenspeicherung bleiben erforderlich. `npm run test:worker-http` prüft in CI mit echter lokaler Worker-Runtime und einem lokalen HTTP-Testserver einen erfolgreichen POST sowie 301, 302, 303, 307 und 308 ohne Folgeanfrage. Er benötigt keine Anbieterfreigabe, kein Cloudflare-Konto und keine Secrets. Ein echter vollständiger Dev-Login muss nach Merge und Bereitstellung der Korrektur noch bestätigt werden; OSM-Schreiben und Bildanalyse bleiben deaktiviert.

Für Feedfehler protokolliert der Worker ausschließlich eine zufällige Diagnose-ID, einen festen Fehlercode, HTTP-Status und Laufzeit. Diagnoseeinträge enthalten keine Koordinaten, Fotos, Kontoidentität, Kandidaten, Feed-Antworttexte oder Zugangsdaten. Erfolgsmeldungen werden nicht protokolliert. Die Oberfläche zeigt Snapshotkennung und Datenstand der erfolgreichen Suche; bei fehlendem oder veraltetem Snapshot bleibt Neuanlage gesperrt.

Zwei AEDs in unmittelbarer Nähe sind ungewöhnlich. Deshalb ist eine Neuanlage trotz naher Treffer ausdrücklich eine Ausnahme: Die Person muss jeden angezeigten Treffer einzeln prüfen und bestätigen, dass keiner das fotografierte Gerät ist; erst danach kann sie den tatsächlichen Gerätestandort auf der Karte prüfen. Nicht angezeigte Treffer bleiben Teil der Dublettenprüfung, auch wenn der Marker verschoben wird. Eine unvollständige oder fehlgeschlagene Suche bietet diesen Ausnahmeweg nicht an. Vor einer Neuanlage liest der OSM-Entwicklungsserver den begrenzten Kartenausschnitt erneut: Nur OSM-IDs aus der ausdrücklich bestätigten Trefferliste werden als bereits geprüfte andere Geräte toleriert; jeder neue oder ungeprüfte AED sowie eine unvollständige Antwort blockiert den Schreibvorgang. Dieser Ausschluss ist für den Testserver bestimmt; produktives OSM bleibt technisch ausgeschlossen.

OSM-Objektversion vor Änderungen laden und Konflikte behandeln. Nach einem Upload-Timeout zunächst den tatsächlichen Serverzustand klären, bevor dieselbe Neuanlage wiederholt wird. Eigene erfolgreiche Änderungen sofort in der App darstellen, da abgeleitete Datenquellen verzögert sein können.

Fotos werden im aktuellen Pilot weder an einen Bilddienst gesendet noch als Bilddateien in OSM hochgeladen. Ein öffentlicher Bildlink wäre eine getrennte Funktion mit eigenem Hosting. Frühere Überlegungen zu einer KI-Anfrage und Bildübermittlung sind durch den aktuellen Pilotentscheid ersetzt. Eine öffentliche Fotogalerie wird nicht benötigt.
