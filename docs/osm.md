# OSM-Datenmodell und technische Grundlagen

Stand: 17.10.2026. Fachliche Grundlage: [deutsche Tagging-Seite](https://wiki.openstreetmap.org/wiki/DE:Tag:emergency=defibrillator) und [englische Tagging-Seite](https://wiki.openstreetmap.org/wiki/Tag:emergency=defibrillator). Die UI-Zuordnung ist unser Entwurf.

## Vorgeschlagene Formularfelder

| Frage / Information | OSM-Tag | Behandlung im Entwurf |
| --- | --- | --- |
| Objekttyp | `emergency=defibrillator` | Bei Neuanlage automatisch setzen. |
| Wo genau befindet sich der AED? | `defibrillator:location=*` | Kurzer Freitext mit Eingang, Raum oder Orientierungspunkt. |
| Wer hat Zugang? | `access=*` | Auswahl erläutern, etwa `yes`, `customers` oder `private`; Details vor Umsetzung abgleichen. |
| Wann ist er zugänglich? | `opening_hours=*` | `24/7` nur bei bestätigter durchgehender Zugänglichkeit. |
| Drinnen oder draußen? | `indoor=yes/no` | Explizite Auswahl. |
| Stockwerk | `level=*`, gegebenenfalls `level:ref=*` | Optional; Zählebene und Beschriftung unterscheiden. |
| Vor Ort gesehen am | `check_date=YYYY-MM-DD` | Nur bei tatsächlicher Sichtprüfung bestätigen lassen. |
| Betreiber | `operator=*` | Optional. |

Ein unbekannter Wert bleibt bei Neuanlage ohne Tag. Bei Bearbeitungen darf „nicht beantwortet“ bestehende Angaben nicht löschen. „Unbekannt“ ist keine pauschale Aufforderung, `unknown` nach OSM zu schreiben.

## Eigene Regeln für eine verlässliche Erfassung

- Einen Punkt am Gerät anlegen; ein AED-Hinweisschild ist nicht zwangsläufig der Gerätestandort.
- Zugang und Uhrzeiten getrennt behandeln: Ein öffentlich zugängliches Gerät kann nachts eingeschlossen sein.
- Keine Verfügbarkeit aus „draußen“ ableiten und keine automatische Übernahme von Gebäudeöffnungszeiten.
- Das Prüfdatum bezeichnet eine Ortsbesichtigung für die Kartierung, keine Funktionsprüfung oder Wartung.
- Einen vermuteten Standort zunächst als lokalen Entwurf behandeln. Keine scheinbar genaue Position aus ungenauen GPS-Daten erzeugen.
- Vorhandene fremde Tags erhalten. Entfernen, Umzug und widersprüchliche Angaben brauchen einen eigenen Bearbeitungsablauf.

## Daten lesen und schreiben

[Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) dient zum Lesen vorhandener Objekte. Schreibzugriffe laufen über die [OSM API v0.6](https://wiki.openstreetmap.org/wiki/API_v0.6) mit dem autorisierten Benutzerkonto. [OAuth 2.0 mit PKCE](https://wiki.openstreetmap.org/wiki/OAuth) ist dafür ein passender Ansatz.

Beispiel zum Erkunden eines sichtbaren Ausschnitts in [Overpass Turbo](https://overpass-turbo.eu/), hier nur als Recherchehilfe, nicht als getestete App-Implementierung:

```overpass
[out:json][timeout:25];
nwr["emergency"="defibrillator"]({{bbox}});
out center tags;
```

Die Abfrage umfasst bewusst auch Ways und Relations, damit auffällige bestehende Objekte sichtbar bleiben. `center` liefert bei diesen Objekten nur einen Darstellungsmittelpunkt, keinen verifizierten Gerätestandort. Neue AEDs sollen als Knoten erfasst werden.

## Technische Prüfpunkte vor Umsetzung

OSM-Objektversion vor Änderungen laden und Konflikte behandeln. Nach einem Upload-Timeout zunächst den tatsächlichen Serverzustand klären, bevor dieselbe Neuanlage wiederholt wird. Eigene erfolgreiche Änderungen sofort in der App darstellen, da abgeleitete Datenquellen verzögert sein können.

Fotos werden nicht als Bilddateien in OSM hochgeladen. Ein öffentlicher Bildlink wäre eine getrennte Funktion mit eigenem Hosting. Für den ersten Entwurf erscheint die lokale Fotoverarbeitung aus Hydrantenjäger ausreichend.
