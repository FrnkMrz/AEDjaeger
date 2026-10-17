# Recherche und Linksammlung

Recherchestand und Abrufdatum aller folgenden Quellen: **17.10.2026**. Erste Auswahl, keine vollständige Marktübersicht. Die Angaben beruhen auf Projektseiten, Dokumentation und den jeweils genannten Forschungsquellen; es wurde kein praktischer Vergleich der Apps durchgeführt.

## 1. Der ursprüngliche ACM-Link: AEDHunter

**Helinyi Peng, Akihito Taya, Yuuki Nishiyama und Kaoru Sezaki (2025): _AEDHunter: Investigating and Enhancing AED Retrieval through a Mobile Application._ CHI Extended Abstracts 2025.**

- [Originalbeitrag / DOI 10.1145/3706599.3719746](https://dl.acm.org/doi/10.1145/3706599.3719746)
- [Projektseite des Mitautors Yuuki Nishiyama](https://www.yuukinishiyama.com/en/research/aed-hunter)
- [Bibliografischer Nachweis bei dblp](https://dblp.uni-trier.de/rec/conf/chi/PengTNS25.html)

Die Autoren beschreiben eine standortbasierte, spielerische Anwendung zum Üben des Auffindens von AEDs. Smartphone-Sensorik und wiederholte Erkundungen dienen der Untersuchung des Suchverhaltens. Die Projektseite berichtet von verbessertem Zutrauen und höherer Bereitschaft zum Auffinden der Geräte.

**Einordnung für AEDjäger:** Anregung für Motivation und Ortskenntnis. Die eingesehenen Quellen belegen keine direkte OSM-Erfassungsfunktion. Trainingswirkung und Qualität von Karteneinträgen sind unterschiedliche Fragen.

**Zugriffsgrenze:** Die ACM-Seite war über das Recherchewerkzeug nicht abrufbar. Der Volltext des Beitrags von 2025 wurde nicht ausgewertet. Die Zusammenfassung stützt sich auf die Autorenseite; bibliografische Angaben wurden zusätzlich abgeglichen.

### Weiterführende Veröffentlichung von 2026

[AEDHunter: Investigating AED Retrieval in the Real World via Gamified Mobile Interaction and Sensing – arXiv:2603.01075](https://arxiv.org/abs/2603.01075).

Das Abstract beschreibt wiederholte Suchübungen, Smartphone-Sensorik und Bluetooth-Tags zur Ankunftsbestätigung. Berichtet werden kürzere Suchzeiten nach wiederholtem Üben und höheres selbst eingeschätztes Zutrauen. Diese spätere Arbeit ist eine eigene Veröffentlichung; ihre Ergebnisse werden hier nicht dem Beitrag von 2025 zugeschrieben. Studiendetails und Effektgrößen wurden nicht geprüft.

**Eigene Ableitung:** Wiederbesuche könnten später motivieren, Zugang und Standortbeschreibung zu überprüfen. Bluetooth-Hardware wäre für eine einfache Erfassungsapp zusätzlicher Aufwand und gehört vorerst nicht zum Konzept.

## 2. Bestehende Anwendungen

| Angebot | Belegter Schwerpunkt | Interesse für unser Vorhaben |
| --- | --- | --- |
| [OpenAEDMap](https://openaedmap.org/) | AED-Karte; das [Frontend-Repository](https://github.com/openstreetmap-polska/openaedmap-frontend) beschreibt auch das Hinzufügen von Geräten. | Wichtigster direkter Vergleich für eine spezialisierte Erfassung. |
| [MapComplete: Defibrillatoren](https://mapcomplete.org/aed) | Themenkarte zum Finden und Eintragen von AEDs auf OSM-Basis, auch auf Deutsch. | Geführte Fragen und kleiner thematischer Umfang als Bedienvorbild prüfen. |
| [Mapa AED](https://aedmapa.pl/) | Laut Anbieter mobile App mit OSM-Anmeldung, Anlegen und Bearbeiten, Standortdetails, Fotos und Offline-Funktionen. | Vergleich für eine native mobile Umsetzung; Funktionen bislang nur anhand der Anbieterbeschreibung erfasst. |
| [Defikarte.ch](https://defikarte.ch/) | Schweizer Angebot zum Finden und Erfassen von Defibrillatoren; siehe [Beschreibung von AED.ch](https://www.aed.ch/news-blog/dokumente/2022/Defikarte-App.php?lang=FR). | Deutschsprachige regionale Ansprache und Erfassung ansehen; die ergänzende Beschreibung stammt von 2022. |
| [Defi-League](https://defi-league.de/) | Die Projektseite bewirbt das Melden von Defibrillatoren mit Belohnungen. | Naheliegender Vergleich für Motivation; Ablauf, Datenübergabe und Regeln noch näher prüfen. |

**Eigene Schlussfolgerung:** Der Mehrwert von AEDjäger müsste in besonders einfacher Erfassung und guter Datenpflege liegen. Eine weitere reine Standortkarte allein wäre wenig unterscheidbar. Vor der Umsetzung zwei oder drei bestehende Erfassungsabläufe am Handy durchspielen.

## 3. OSM und praktische Mapping-Projekte

- [Deutsche OSM-Tagging-Dokumentation](https://wiki.openstreetmap.org/wiki/DE:Tag:emergency=defibrillator): Grundlage für Felder und deutsche Erläuterungen; siehe unser [Datenmodell](osm.md).
- [Englische OSM-Tagging-Dokumentation](https://wiki.openstreetmap.org/wiki/Tag:emergency=defibrillator): ergänzende Details und Diskussion zur Positionierung. Der Punkt soll am tatsächlichen Gerät liegen; ein ganzes Gebäude mit diesem Tag zu versehen ist ungeeignet.
- [OSM Ireland: AED Defibrillator Mapping](https://www.openstreetmap.ie/missions/aed-defibrillator-mapping/): Beispiel für gemeinschaftliche Erfassung und Zusammenarbeit mit lokalen Akteuren.
- [Britisches Mapping-Projekt, Q2 2024](https://wiki.openstreetmap.org/wiki/UK_Quarterly_Project/2024/2024_Q2_Project:_Defibrillators): praktische Erfassungsansätze. Die Seite weist ausdrücklich darauf hin, dass bestimmte externe Register nicht direkt nach OSM übernommen werden dürfen.

**Eigene Ableitung:** Ortsbesuche und selbst erhobene Informationen sind der passende Ausgangspunkt. Ein Datenimport aus fremden Registern ist ein separates Vorhaben und setzt die Klärung der jeweiligen Nutzungsrechte voraus.

## 4. Technische Einstiegsquellen

- [OSM OAuth](https://wiki.openstreetmap.org/wiki/OAuth): Anmeldung und Autorisierung; OAuth 2.0 mit PKCE wird unterstützt.
- [OSM API v0.6](https://wiki.openstreetmap.org/wiki/API_v0.6): Knoten, Versionen, Changesets und Schreibzugriffe.
- [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API): Abfragen vorhandener OSM-Objekte.
- [Hydrantenjäger-Repository](https://github.com/FrnkMrz/hydranten-app): vorhandene eigene Umsetzung und wichtigste technische Referenz.

## Recherchegrenzen

Keine Überprüfung von App-Store-Verfügbarkeit, keine vollständige Codeprüfung der Vergleichsprojekte, keine Aussagen über medizinische Wirksamkeit unserer geplanten App. Quellen beschreiben den jeweils verfügbaren Stand; Funktionen und Links können sich ändern.

## 5. Architektur-Recherche vom 17.10.2026

Der [Architekturentwurf](architektur.md) ergänzt überprüfte Primärquellen zu GitHub Pages, Cloudflare Workers, KI-Bildauswertung, Kostenbegrenzung, PWA-Grenzen und sicheren OSM-Uploads. Dort stehen die jeweiligen Belege direkt bei den Aussagen. Der [Umsetzungsplan](umsetzungsplan.md) übersetzt die Empfehlung in praktische Aufträge für einen AI-Agenten.

Neu geklärt wurde die OSM-Abbildung von Existenzbestätigungen über [check_date](https://wiki.openstreetmap.org/wiki/Key:check_date). Eine Modellbewertung mit eigenen Fotos steht noch aus; es wurden keine Genauigkeits- oder Laufzeitmessungen durchgeführt.
