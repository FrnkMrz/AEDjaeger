# OSM-Datenmodell und technische Grundlagen

Stand: 17.10.2026. Fachliche Grundlage: [deutsche Tagging-Seite](https://wiki.openstreetmap.org/wiki/DE:Tag:emergency=defibrillator) und [englische Tagging-Seite](https://wiki.openstreetmap.org/wiki/Tag:emergency=defibrillator). Die UI-Zuordnung ist unser Entwurf.

> **Aktueller Pilot (8.11.2026):** Die Person bestätigt selbst, dass ein AED oder AED-Gehäuse im Foto sichtbar ist. Das Foto wird nicht an einen Bilddienst gesendet. Historische Abschnitte zur früher geplanten KI-Bildanalyse beschreiben keinen aktuellen Produktablauf.

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

## Aktueller OSM-Datenzugriff: versionierter AED-Snapshot

Die Umgebungssuche liest den AED-Index aus der OpenFireMap-Pipeline unter der festen Basisadresse `https://pipeline.openfiremap.org/`. Der Worker akzeptiert keine Feed-URL aus dem Browser. Er lädt `metadata.json` und `aed/manifest.json` bei jeder Suche ohne Cache und prüft Schema, Snapshot-ID, Region, Quellenalter und vollständige Coverage. Für den derzeit vereinbarten Vertrag gelten `aedjaeger-cells-v1`, die Region `dachlilu` und höchstens `max_source_age_hours` (im Feed derzeit 48 Stunden). Ein veraltetes Manifest, fehlende/inkomplette Zellen, Versions- oder Pfadabweichungen, Redirects und Providerfehler ergeben ein Fehlerresultat. Das Fehlerresultat ist niemals „keine AEDs“ und erlaubt in der UI keine Neuanlage. Es gibt keinen Overpass-Fallback.

Index und Shards sind durch Snapshot-ID unveränderliche GET-Objekte und dürfen mit Cloudflare Fetch-Caching abgerufen werden. Fehlerantworten werden nicht gecacht. Die Wurzelmetadaten und das Manifest bleiben stets frisch (`no-store`); dadurch kann ein Cache keinen alten Snapshot als aktuell ausgeben. Kandidaten tragen Feed-Tags und Feed-Cell-/Shard-Referenzen, aber keine OSM-Version. Vor einer bestätigten Testserver-Änderung liest die Schreibroute deshalb das konkrete OSM-Objekt erneut und validiert AED-Klassifikation sowie das bestätigte vorherige `check_date`; ein Existenzupdate ändert ausschließlich `check_date`. Die separate Suchbremse nutzt aus Migrationskompatibilität weiterhin die vorhandene D1-Tabelle `overpass_search_cooldowns`; das ist lediglich ein interner Tabellenname und kein Overpass-API-Aufruf oder Laufzeit-Fallback.

Der Browser sendet für eine ausdrücklich gestartete Suche nur die ausgewählten Koordinaten an AEDjaeger. Der Worker sendet diese an den festen Feed-Endpunkt und gibt dem Browser nur validierte Kandidaten, Snapshot-ID und Datenstand zurück. Foto, EXIF, Kontoidentität, Suchergebnisse und Koordinaten erscheinen nicht in Anwendungslogs. Das Foto und seine EXIF-Daten bleiben lokal. Kartenkacheln für die Standortkorrektur lädt die App nur für den jeweils sichtbaren Ausschnitt von `https://tile.openstreetmap.org/{z}/{x}/{y}.png` und zeigt `© OpenStreetMap contributors`; das ist unabhängig vom AED-Feed. Grundlage: [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

Für den OAuth-Login bestätigt die Worker-Anmeldung die OSM-Identität. Schreibzugriffe sind separat und standardmäßig deaktiviert. Die OSM-Entwicklungsinstanz bleibt einziges zulässiges Schreibziel für Tests; produktives OSM wird in Tests nicht verändert. [OSM OAuth-Dokumentation](https://wiki.openstreetmap.org/wiki/OAuth), [OSM API v0.6](https://wiki.openstreetmap.org/wiki/API_v0.6).

Der Feed-Consumer ist mit simulierten HTTP-Antworten geprüft. In diesem Änderungsschritt erfolgte kein Live-Aufruf an die Pipeline, kein Deployment und kein OSM-Schreibvorgang. Vor einer mobilen Pilotfreigabe müssen Pipeline-PR #63 bzw. die Veröffentlichung des passenden Snapshots, Region `dachlilu`, Coverage und Refresh-Alter separat bestätigt werden.

## Technische Prüfpunkte vor Umsetzung

### OSM-Login: nachgewiesener Cloudflare-Laufzeitfehler

Am 26.10.2026 scheiterten die OSM-Dev-Zustimmungsversuche nach der Rückkehr zur App mit `exchange_code` / `provider_discovery_unreachable`. Die Ursache wurde anschließend mit einer isolierten Probe sowohl lokal in workerd als auch in einer kurzlebigen Cloudflare-Preview reproduziert: Workers lehnt `redirect: "error"` mit `TypeError: Invalid redirect value` ab, bevor eine HTTP-Anfrage gesendet wird. Ein Abruf derselben festen OSM-Dev-Discovery-URL mit `redirect: "manual"` und demselben Zehn-Sekunden-Zeitlimit lieferte in beiden Umgebungen HTTP 200 und gültiges JSON. Die Probe verwendete weder Kontodaten noch Tokens oder Datenbank und wurde danach beendet.

Der vorherige Fehlercode bezeichnete dadurch irreführend einen nicht erreichbaren Anbieter. Ein Netzwerkfehler oder ein ungültiges Client-Secret war zu diesem Zeitpunkt nicht nachgewiesen; der Tokenaustausch wurde noch gar nicht erreicht. Die bisherigen Node-Mocks und der reine Worker-Build erkannten den ungültigen Runtime-Parameter nicht. Der [Cloudflare-Runtime-Quellcode](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B) bestätigt die absichtliche Beschränkung auf `follow` und `manual`.

Die Korrektur verwendet für Discovery, Tokenaustausch, Signaturschlüssel, AED-Feed und Testserver-API den gemeinsamen Baustein `fetchWithoutRedirects`: `manual` folgt keinem Ziel; jede 3xx-Antwort wird ohne Übernahme von Location oder Antworttext abgelehnt. OIDC-Signatur, Issuer, Audience, Nonce, PKCE und serverseitige Tokenspeicherung bleiben erforderlich. `npm run test:worker-http` prüft in CI mit echter lokaler Worker-Runtime und einem lokalen HTTP-Testserver einen erfolgreichen POST sowie 301, 302, 303, 307 und 308 ohne Folgeanfrage. Er benötigt keine Anbieterfreigabe, kein Cloudflare-Konto und keine Secrets. Ein echter vollständiger Dev-Login muss nach Merge und Bereitstellung der Korrektur noch bestätigt werden; OSM-Schreiben und Bildanalyse bleiben deaktiviert.

Für Feedfehler protokolliert der Worker ausschließlich eine zufällige Diagnose-ID, einen festen Fehlercode, HTTP-Status und Laufzeit. Diagnoseeinträge enthalten keine Koordinaten, Fotos, Kontoidentität, Kandidaten, Feed-Antworttexte oder Zugangsdaten. Erfolgsmeldungen werden nicht protokolliert. Die Oberfläche zeigt Snapshotkennung und Datenstand der erfolgreichen Suche; bei fehlendem oder veraltetem Snapshot bleibt Neuanlage gesperrt.

Zwei AEDs in unmittelbarer Nähe sind ungewöhnlich. Deshalb ist eine Neuanlage trotz naher Treffer ausdrücklich eine Ausnahme: Die Person muss jeden angezeigten Treffer einzeln prüfen und bestätigen, dass keiner das fotografierte Gerät ist; erst danach kann sie den tatsächlichen Gerätestandort auf der Karte prüfen. Nicht angezeigte Treffer bleiben Teil der Dublettenprüfung, auch wenn der Marker verschoben wird. Eine unvollständige oder fehlgeschlagene Suche bietet diesen Ausnahmeweg nicht an. Vor einer Neuanlage liest der OSM-Entwicklungsserver den begrenzten Kartenausschnitt erneut: Nur OSM-IDs aus der ausdrücklich bestätigten Trefferliste werden als bereits geprüfte andere Geräte toleriert; jeder neue oder ungeprüfte AED sowie eine unvollständige Antwort blockiert den Schreibvorgang. Dieser Ausschluss ist für den Testserver bestimmt; produktives OSM bleibt technisch ausgeschlossen.

OSM-Objektversion vor Änderungen laden und Konflikte behandeln. Nach einem Upload-Timeout zunächst den tatsächlichen Serverzustand klären, bevor dieselbe Neuanlage wiederholt wird. Eigene erfolgreiche Änderungen sofort in der App darstellen, da abgeleitete Datenquellen verzögert sein können.

Fotos werden im aktuellen Pilot weder an einen Bilddienst gesendet noch als Bilddateien in OSM hochgeladen. Ein öffentlicher Bildlink wäre eine getrennte Funktion mit eigenem Hosting. Frühere Überlegungen zu einer KI-Anfrage und Bildübermittlung sind durch den aktuellen Pilotentscheid ersetzt. Eine öffentliche Fotogalerie wird nicht benötigt.
