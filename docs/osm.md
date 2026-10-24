# OSM-Datenmodell und technische Grundlagen

Stand: 17.10.2026. Fachliche Grundlage: [deutsche Tagging-Seite](https://wiki.openstreetmap.org/wiki/DE:Tag:emergency=defibrillator) und [englische Tagging-Seite](https://wiki.openstreetmap.org/wiki/Tag:emergency=defibrillator). Die UI-Zuordnung ist unser Entwurf.

## Mögliche Datenfelder im Hintergrund

Diese Tabelle ist kein Pflichtformular. Die Fotoauswertung und vorhandene OSM-Daten liefern Angaben, soweit sie belastbar sind. Bei einem schon erfassten Gerät wird im Normalfall nur dessen Vorhandensein bestätigt; siehe [Produktkonzept](konzept.md).

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

## Eigene Regeln für eine verlässliche Erfassung

- Einen Punkt am Gerät anlegen; ein AED-Hinweisschild ist nicht zwangsläufig der Gerätestandort.
- Zugang und Uhrzeiten getrennt behandeln: Ein öffentlich zugängliches Gerät kann nachts eingeschlossen sein.
- Keine Verfügbarkeit aus „draußen“ ableiten und keine automatische Übernahme von Gebäudeöffnungszeiten.
- Das Prüfdatum bezeichnet eine Ortsbesichtigung für die Kartierung, keine Funktionsprüfung oder Wartung.
- Einen vermuteten Standort zunächst als lokalen Entwurf behandeln. Keine scheinbar genaue Position aus ungenauen GPS-Daten erzeugen.
- Vorhandene fremde Tags erhalten. Entfernen, Umzug und widersprüchliche Angaben brauchen einen eigenen Bearbeitungsablauf.

## Daten lesen und schreiben

[Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) dient zum Lesen vorhandener Objekte. Schreibzugriffe laufen über die [OSM API v0.6](https://wiki.openstreetmap.org/wiki/API_v0.6) mit dem autorisierten Benutzerkonto. [OAuth 2.0 mit PKCE](https://wiki.openstreetmap.org/wiki/OAuth) ist dafür ein passender Ansatz.

Die verschiebbare Standortkarte lädt für den jeweils sichtbaren Ausschnitt ausschließlich benötigte Kacheln von `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Die Kartenansicht zeigt dauerhaft `© OpenStreetMap contributors`. AEDjaeger lädt keine Kacheln im Voraus und speichert sie nicht für die Offline-Nutzung. Der Kacheldienst erhält beim Kartenaufruf die üblichen Webanfragen einschließlich IP-Adresse und sieht anhand der angeforderten Kacheln den ungefähren Kartenausschnitt. Die genaue GPS-Suche bleibt ein separater, ausdrücklich gestarteter Overpass-Aufruf. Grundlage: [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

Die Worker-Anmeldung verwendet vorerst ausschließlich den OSM-Scope `openid`. Sie bestätigt die OSM-Identität, speichert aber keinen OSM-Zugriffstoken und kann daher keine Kartendaten ändern. Für spätere Schreibtests müssen die OSM-Anwendung und ihr ausdrücklich freigegebener Scope separat eingerichtet werden; der erste produktive Schreibtest darf nicht gegen OpenStreetMap laufen. Die OSM-Dokumentation nennt für Production die Autorisierungs- und Token-Endpunkte auf `www.openstreetmap.org` und unterstützt Authorization Code mit PKCE. [OSM OAuth-Dokumentation](https://wiki.openstreetmap.org/wiki/OAuth)

Beispiel zum Erkunden eines sichtbaren Ausschnitts in [Overpass Turbo](https://overpass-turbo.eu/), hier nur als Recherchehilfe, nicht als getestete App-Implementierung:

```overpass
[out:json][timeout:25];
nwr["emergency"="defibrillator"]({{bbox}});
out center tags;
```

Die Abfrage umfasst bewusst auch Ways und Relations, damit auffällige bestehende Objekte sichtbar bleiben. `center` liefert bei diesen Objekten nur einen Darstellungsmittelpunkt, keinen verifizierten Gerätestandort. Neue AEDs sollen als Knoten erfasst werden.

## Technische Prüfpunkte vor Umsetzung

Die App verwendet für die lesende Kandidatensuche den öffentlichen Overpass-Endpunkt `https://overpass-api.de/api/interpreter`. Anfragen tragen einen AEDjaeger-User-Agent, laufen einzeln mit einer kurzen Zeitgrenze und werden pro OSM-Konto durch einen Cooldown begrenzt. Die D1-Tabelle enthält dafür nur einen einweg-gehashten Kontoschlüssel und den nächsten Abfragezeitpunkt; sie speichert weder Rohkennung, Suchkoordinaten noch Ergebnisse. Abgelaufene Cooldown-Zeilen werden bei der nächsten Suche entfernt. Die Instanz kann ausgelastet sein; bei Rate-Limit oder Lastfehlern mindestens 30 Sekunden warten und keine Neuanlage aus einer unvollständigen Antwort ableiten. Vor einem echten Pilotbetrieb die dann aktuelle Overpass-Nutzungsrichtlinie erneut prüfen und bei wachsendem Verkehr Caching oder einen geeigneten eigenen/vertraglichen Dienst bewerten. [Overpass API und öffentliche Instanzen](https://wiki.openstreetmap.org/wiki/Overpass_API), [Nutzungshinweise der öffentlichen Instanzen](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)

OSM-Objektversion vor Änderungen laden und Konflikte behandeln. Nach einem Upload-Timeout zunächst den tatsächlichen Serverzustand klären, bevor dieselbe Neuanlage wiederholt wird. Eigene erfolgreiche Änderungen sofort in der App darstellen, da abgeleitete Datenquellen verzögert sein können.

Fotos werden nicht als Bilddateien in OSM hochgeladen. Ein öffentlicher Bildlink wäre eine getrennte Funktion mit eigenem Hosting. Die geplante KI-Anfrage nutzt das Foto ausdrücklich als Eingabe. Bildübermittlung, Dienst und Aufbewahrung müssen dafür festgelegt werden; die bisherige rein lokale Fotoverarbeitung aus Hydrantenjäger deckt diesen neuen Schritt nicht ab. Eine öffentliche Fotogalerie wird dafür nicht benötigt.
