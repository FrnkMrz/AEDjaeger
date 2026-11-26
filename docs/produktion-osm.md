# Entwurf: sicherer Produktions-Schreibweg für OpenStreetMap

Stand: **26.11.2026**  
Status: **Entschieden und freigegeben am 26.11.2026 (Abschnitt 13); die Umsetzung läuft in den Etappen Q1 bis Q6 (Abschnitt 15). Bis eine Etappe gemergt und ihr Schalter vom Projektinhaber gesetzt ist, bleiben produktive Schreibvorgänge technisch aus.**

Dieses Dokument beschreibt, welche Voraussetzungen erfüllt sein müssen, bevor AEDjaeger Änderungen an der öffentlichen OpenStreetMap-API anbieten darf. Es knüpft an die vorhandenen Regeln für den Testserver an und macht sie für einen möglichen Produktionsbetrieb konkret. Bis eine gesonderte Freigabe vorliegt, bleiben Produktionsschreibzugriffe technisch unmöglich. Die aktive Pilotadresse ist weiterhin `workers.dev`.

## 1. Geltungsbereich und Freigabegrenzen

Der Entwurf umfasst:

- Anmeldung mit einem echten OSM-Konto und kleinsten nötigen API-Rechten;
- sichere, getrennte Ablage der Produktions-Tokens;
- feste Zuordnung von Sitzung, OSM-Host und API-URL;
- verlässlichen Nachweis, dass eine Suche erfolgreich und vollständig genug war, bevor eine Neuanlage angeboten wird;
- konkrete Änderungsbestätigung, Konfliktschutz, Änderungen an bestehenden Objekten und Wiederaufnahme unklarer Uploads;
- `source=survey` und nachvollziehbare Changeset-Metadaten;
- unabhängige Betreiber-Schalter, Kontozulassung und mengenbegrenzte Einführung;
- Überwachung, Störungsbehandlung, Korrektur/Rücknahme und öffentliche Ankündigung;
- schrittweise Umbenennung von `development*`-Bezeichnungen in neutrale Namen.

Seit dem 26.11.2026 ist der Code für Produktionsschreibzugriffe freigegeben (Abschnitt 13). Weiterhin **nicht** autorisiert sind: das Setzen von Secrets oder Schaltern durch einen Agenten, echte OSM-Schreibtests in Tests, CI oder Agentenläufen, kostenpflichtige Dienste, bezahlte Tarife und weitere Domains. Die Schalter setzt ausschließlich der Projektinhaber. Produktions-OSM darf in gewöhnlichen Tests, CI, Vorschauen und Agentenläufen nie geändert werden.

### Aktueller Stand

- Die Anmeldung kennt Produktionsidentität, fordert dort aber nur `openid`; das Produktions-Token wird nicht für API-Schreibzugriff abgelegt.
- Schreibvorschau und Schreibrouten sind an die Entwicklungsumgebung gebunden. Der feste Host lautet `master.apis.dev.openstreetmap.org`.
- `OSM_DEV_WRITES_ENABLED` schaltet die vorhandenen Entwicklungs-Schreibwege standardmäßig aus. Korrekturen bestehender Werte hängen zusätzlich von `OSM_DETAIL_CORRECTIONS_ENABLED` ab, ebenfalls standardmäßig aus.
- Die Umgebungssuche nutzt das AED-Layer im OpenFireMap-PMTiles-Archiv. Für mögliche Neuanlagen gibt es eine gezielte Nachsuche auf dem OSM-Entwicklungsserver. Ein leeres Archiv-Ergebnis allein ist kein Beweis, dass es in der Umgebung keinen AED gibt.
- Der Produktions-Login kann daher gegenwärtig keinen Produktions-Schreibvorgang auslösen. Das muss auch nach zukünftigen Änderungen gelten, solange alle Freigabegates dieses Dokuments nicht ausdrücklich umgesetzt und abgenommen wurden.

## 2. Sicherheitsziele und nicht verhandelbare Regeln

1. **Fail closed:** unbekannte Umgebung, fehlende Einstellung, ungültiger Token, unvollständige Suche oder nicht überprüfbarer Zustand führt zu keiner OSM-Änderung.
2. **Fester Zielhost:** Kein API-Host, Pfad oder vollständiges XML aus Browserdaten übernehmen. Host und API-Endpunkte kommen ausschließlich aus einer serverseitigen Umgebungszuordnung.
3. **Konkrete Einwilligung:** Vor dem Senden sieht die Person das konkrete Objekt, die konkrete Aktion und alle Tags als `alt → neu`. Die Bestätigung gilt für genau diesen Vorschlag und dessen Ablaufzeit.
4. **Unmittelbare Konfliktprüfung:** Vor dem Upload das Objekt erneut von OSM lesen. Bei Versionsänderung, abweichendem Vorwert, fehlendem Objekt oder veränderter Objektbedeutung abbrechen und einen neuen Vorschlag verlangen.
5. **Keine destruktiven Änderungen:** Keine Tags löschen, keine Position bestehender Objekte ändern, keine fremden Tags verändern und niemals `defibrillator:code` erfassen.
6. **Keine unsichere Neuanlage:** Nur eine erfolgreiche, ausreichend vollständige Suche plus ausdrückliche Bestätigung aller angezeigten nahen AEDs erlaubt den Vorschlag. Ein Fehler, eine Zeitüberschreitung, eine Datenlücke oder ein unvollständiger Ausschnitt sperrt den Weg.
7. **Keine blinden Wiederholungen:** Nach einem Netzabbruch bleibt der Ausgang „unklar“, bis der bekannte Vorgang anhand Changeset und Objektstand abgeglichen wurde. Dieselbe Vorgangs-ID darf keinen zweiten unabhängigen Upload beginnen.
8. **Schutz von Konto und Standort:** Tokens, OAuth-Codes, Fotos und vollständige API-Antworten nie protokollieren. Suchkoordinaten nur für die angeforderte Suche verwenden und nicht zur Nachverfolgung speichern.
9. **Getrennte Test- und Produktionswege:** Verschiedene API-Hosts, OAuth-Clients, Tokenkontexte, Flags und Testvorrichtungen. Produktionsdaten sind für Testkonten und E2E-Fixtures unerreichbar.

## 3. OAuth-Rechte und Identität

### Vorgeschlagene Rechte

Für einen produktiven Schreibvorgang braucht die App ein OSM-API-Token mit `write_api`. `openid` wird weiterhin nur für die Anmeldung und die verifizierte Kontoidentität benötigt. Zusätzliche Rechte wie `read_prefs`, `write_prefs`, `read_gpx` oder `write_gpx` sind für die beschriebenen AED-Abläufe nicht nötig und sollen nicht angefordert werden.

Die offizielle [OSM-OAuth-Dokumentation](https://wiki.openstreetmap.org/wiki/OAuth) nennt `write_api` zum Ändern der Karte; `write_changeset_comments` kann separat angefordert werden, falls Kartenänderungen nicht nötig sind, ist aber in `write_api` enthalten. Für AEDjaeger folgt daraus der kleinste Satz `openid write_api`; kein weiterer Scope ist nötig. Vor der Umsetzung sind die aktuelle OAuth-Anwendung und der tatsächlich erteilte Scope zu prüfen. Der Produktions-Callback muss Schreibfunktionen sperren, wenn `write_api` fehlt oder unerwartete Rechte vorliegen. Ein Konto, das nur angemeldet ist, erhält keinen Schreibzugriff.

### Identitätsbindung

- Identität anhand des verifizierten OSM-Subjects und der erwarteten OSM-Ausstellerkennung bestimmen; nicht anhand eines frei eingereichten Benutzernamens.
- Sitzung, OAuth-Client, API-Token und OSM-Umgebung fest zusammenbinden. Ein Dev-Token darf nicht an den Produktionshost und ein Produktions-Token nicht an den Dev-Host gesendet werden.
- Für die gestufte Freigabe eine explizite Zulassungsliste aus verifizierten OSM-Subjects verwenden. Namen und Anzeigenamen sind dafür nicht eindeutig genug.
- Änderungen am Allowlist-Eintrag werden als Betriebsänderung protokolliert (Zeitpunkt, Kennung der Änderung, keine Tokens). Ein nicht zugelassenes Konto kann sich weiterhin anmelden, aber nicht schreiben.
- Beim Logout oder Widerruf die serverseitige Sitzung und den Token nach dem bestehenden Löschkonzept entfernen. Ein Produktiv-Token wird nicht in `localStorage`, `sessionStorage`, IndexedDB, URL, HTML oder Browserantworten ausgegeben.

## 4. Token-Speicher und Lebenszyklus

Der Worker bleibt der einzige Tokenhalter. Wenn Produktions-API-Schreibzugriffe eingeführt werden, ist das gespeicherte Token serverseitig mit einem getrennt verwalteten Verschlüsselungs-Secret zu schützen. Dieses Secret liegt ausschließlich in der jeweiligen Worker-Umgebung. Kein Secret gehört in den Quelltext, D1-Klartext, Build-Artefakte oder Logs.

Vorgeschlagene Datenhaltung:

| Bereich | Vorschlag | Schutz / Löschung |
| --- | --- | --- |
| Sitzung | zufällige, undurchsichtige Kennung in einem Secure-, HttpOnly-, SameSite-Cookie; begrenzte Lebenszeit und Rotation | Keine OSM-Tokenfelder im Cookie; Logout löscht Sitzung. |
| API-Token | eigener verschlüsselter Datensatz, an verifizierte Subject-ID und `production` gebunden | Entschlüsselung nur im Worker und nur unmittelbar vor dem API-Aufruf; Löschung bei Logout/Widerruf oder Ablauf. |
| Schreibvorgang | minimale Vorgangs-ID, Subject-Hash/ID, Zieltyp und -ID, erwartete Version, erlaubte Änderung, Status, Changeset-ID und Ergebnis-ID | Keine Koordinaten, Fotos, OAuth-Werte oder komplette OSM-XML-Antworten; begrenzte Aufbewahrung und definierter Bereinigungsjob. |
| Verbrauchszähler | UTC-Tag, Subject-Hash, Schreibaktion/Tagklasse, Anzahl | Zweckgebundene Aggregation; Aufbewahrungsfrist festlegen, kein Bewegungsprofil. |

Vor Umsetzung sind D1-Verschlüsselbarkeit und Schlüsselrotation praktisch nachzuweisen. Ein rotierbarer Envelope-Schlüssel ist gegenüber einem langfristigen statischen Klartext-Schlüssel vorzuziehen. Kann der Worker einen Datensatz nicht entschlüsseln, muss die Schreibroute ohne API-Aufruf mit einem festen Fehlercode abbrechen. Secrets dürfen in Fehlerobjekten nicht auftauchen. Die bestehende Sessionbindung mit `ON DELETE CASCADE` darf nicht dazu führen, dass ein bereits gestarteter Upload seinen Idempotenz- oder Wiederherstellungsdatensatz verliert; Vorgangslebenszyklus und Tokenlebenszyklus sind getrennt zu entwerfen.

## 5. Host-Freigabe und Trennung der Umgebungen

Die Umgebung muss eine geschlossene Aufzählung sein, beispielsweise `development | production`. Für jede Umgebung existiert eine zentrale serverseitige Konfiguration, die OAuth-Aussteller/Client, Authorization- und Token-Endpunkte, API-Basis-URL und Callback-Allowlist zusammen enthält.

| Umgebung | API-Host | Schreibfreigabe |
| --- | --- | --- |
| `development` | `https://master.apis.dev.openstreetmap.org/api/0.6` | vorhandenes `OSM_DEV_WRITES_ENABLED`, standardmäßig aus |
| `production` | `https://api.openstreetmap.org/api/0.6` | neues, separates `OSM_PROD_WRITES_ENABLED`, standardmäßig aus |

Der tatsächliche Produktions-Host ist vor Implementierung gegen die offizielle OSM-Dokumentation zu prüfen. Es gilt eine Host-Allowlist aus exakten HTTPS-Ursprüngen; keine Suffixprüfung, keine HTTP-Weiterleitung und keine beliebigen Client-URLs. Redirects von API-Requests sind abzulehnen. Bei jedem Request wird die Umgebung serverseitig aus Sitzung und Route ermittelt, nicht aus einem Request-Feld. Der Status-Endpunkt gibt nur boolesche Verfügbarkeit zurück, nie Token oder Ziel-URL.

Produktionsfunktionen werden nur verfügbar, wenn **alle** unabhängigen Bedingungen erfüllt sind: korrektes Production-Deployment, Produktions-OAuth-Client und Callback, korrekt verschlüsselter Token, verifizierte Schreibberechtigung, Allowlist-Eintrag, globaler Schalter, Kontolimit und erfolgreiche Vorabprüfungen. Jede fehlende oder falsch geschriebene Variable bedeutet „aus“. Preview-, Test- und Fork-Deployments erhalten keine Produktionssecrets.

## 6. Suche und belastbarer Nachweis „kein Treffer“

Die aktuelle AED-Suche aus dem PMTiles-Archiv ist für Auffinden und Vorschau geeignet, aber nicht alleiniger Beleg für Abwesenheit: Daten können veraltet, räumlich nicht abgedeckt oder fehlerhaft geladen sein. Ein fehlgeschlagener/unvollständiger Archivabruf bleibt ein Fehler und wird nie als leere Ergebnismenge interpretiert.

Die offizielle OSM-API bietet `GET /api/0.6/map?bbox=...` für einen kleinen Ausschnitt. Die API-Capabilities geben die aktuelle maximale Fläche an; zu große Antworten können mit HTTP 400 oder 509 enden. Selbst HTTP 200 kann eine Fehlerzeile in einer ansonsten syntaktisch gültigen Antwort enthalten, die laut API-Dokumentation als unvollständig zu verwerfen ist. Die API liefert dort OSM-Objekte (kein AED-spezifisches Suchergebnis); die App muss die AED-Tags lokal auswerten. Sie darf diese eng begrenzte Prüfung nur im direkten Zusammenhang mit einem konkreten, kurzlebigen Neuanlagevorschlag nutzen, nicht als großflächigen oder regelmäßigen Extrakt-Dienst. Referenz: [OSM API v0.6 – Bounding-Box-Abfrage und Fehlerbehandlung](https://wiki.openstreetmap.org/wiki/Api06#Retrieving_map_data_by_bounding_box:_GET_/api/0.6/map).

Vor einer Produktions-Neuanlage braucht der Server direkt vor dem Vorschlag und erneut unmittelbar vor dem Upload eine gezielte Abfrage an der öffentlichen OSM-API. Das Design soll:

1. denselben serverseitig validierten Standort und Suchradius verwenden, der der Person angezeigt wurde;
2. die Abfrage gegen den festgelegten Produktionshost ausführen und Antwortstatus, Schema, Grenzen und Vollständigkeit prüfen;
3. AEDs mit der bestehenden fachlichen Radiusregel (`src/domain/matchPolicy.ts`) bestimmen; die 10-m-Bestätigung und 10–50-m-Duplikatprüfung bleiben maßgeblich;
4. bei Timeout, 429, 5xx, ungültigem JSON/XML, unerwartetem Elementtyp, Abdeckungslücke oder Größenlimit den Vorschlag sperren;
5. Flächengrenze aus `capabilities` und maximale Elementzahl beachten; HTTP-Fehler, zu große Antwort, Fehler-Element innerhalb eines 200-Ergebnisses, Parserfehler oder abgeschnittene Antwort sperren die Neuanlage;
6. eine erfolgreiche leere Antwort zeitlich kurz an genau den vorgeschlagenen Vorgang binden; ein anderer Punkt, ein abgelaufener Vorschlag oder eine geänderte Karte erzwingt eine neue Abfrage;
7. angezeigte nahe AEDs als „anderes Gerät“ durch die Person bestätigen lassen, bevor eine Neuanlage vorbereitet wird;
8. den erneuten Servercheck unmittelbar vor Upload wiederholen. Neue oder geänderte Kandidaten, fehlende Antworten und Konflikte stoppen den Upload.

Der API-Endpunkt und seine Eignung als vollständige Umkreissuche sind vor der Umsetzung mit aktueller offizieller OSM-Dokumentation und einem kontrollierten, rein lesenden Prototyp zu belegen. Ein Einzelobjekt-GET oder eine Antwort mit `200` beweist nicht, dass eine räumliche Suche alle nahen AEDs gefunden hat. Falls die API dafür keinen hinreichenden Nachweis liefert, ist eine Neuanlage mit dem bestehenden Archiv allein **nicht** freizugeben; dann braucht es eine separat geprüfte Datenquelle oder bleibt Neuanlage aus.

Auch ein erfolgreicher Suchbeleg ist nur zeitlich begrenzt. OSM kann sich nach dem letzten Check ändern. Das Restrisiko wird durch kurze Gültigkeit, Nachsuche, Doppelschutz am Server und Versionsprüfung vermindert, aber nicht als „garantiert keine Dublette“ dargestellt.

## 7. Zulässige Änderungen und Changeset-Metadaten

Die derzeit freigegebene Tagliste und Eingaberegeln in [OSM-Datenmodell](osm.md#detailangaben-entscheidung-vom-13112026) bleiben die alleinige Schreiballowlist. Browser- und Servervalidierung müssen dieselbe Laufzeitdefinition nutzen. `name`, unbekannte Schlüssel, `defibrillator:code`, Tag-Löschungen, Positionsänderungen und freie XML-Eingaben sind ausgeschlossen.

### Schnellweg: AED gesehen

Nur `check_date` aktualisieren. Ein älteres Datum darf kein neueres vorhandenes Datum ersetzen. Frischen Objektstand lesen, erwartete Version prüfen, alle anderen Tags unverändert übernehmen. Das Foto selbst wird nicht zu OSM hochgeladen.

### Neuanlage und Detailweg

Vor dem Upload jede Änderung konkret als `alt → neu` anzeigen. Bei Neuanlagen ist `alt` leer; die Vorschau zeigt alle automatisch und freiwillig ausgewählten Werte. Es braucht die normale Bestätigung, dass AED oder Gehäuse sichtbar ist, sowie die ausdrücklichen Bestätigungen der Neuanlage und des erfolglosen Suchabgleichs. Für Bestehendes gelten die vorhandenen Regeln: Ergänzen nur fehlender Felder; Korrektur nur bei einem gesonderten Betreiber-Schalter und zusätzlicher ausdrücklicher Bestätigung. Keine Löschung oder Bewegung.

### Changeset-Text

Die OSM-API-Dokumentation empfiehlt `created_by` und einen kurzen, menschlich lesbaren `comment`; sie rät, den Kommentar nicht automatisch zu erzeugen, sondern von der nutzenden Person eingeben zu lassen. Deshalb soll AEDjaeger einen verständlichen, optional vorbefüllten Vorschlag anbieten, den die Person vor dem Öffnen des Changesets prüft und bestätigt. Der eingereichte Kommentar muss genau zum bestätigten Vorgang passen und darf keine Fotos, exakten Koordinaten, Subject-Kennung oder unnötigen Gerätedaten enthalten. Referenz: [OSM API v0.6 – Changesets](https://wiki.openstreetmap.org/wiki/Api06#Changesets).

Als Source-Tag auf dem OSM-Objekt ist **`source=survey`** vorgesehen, sofern die Person die Vor-Ort-Erfassung bestätigt. Das ist vor Einführung mit OSM-Tagging-Konventionen und der Community zu prüfen; der Server setzt den Wert selbst, der Browser kann ihn nicht ändern. Ebenso ist zu entscheiden, ob `created_by=AEDjaeger` als Changeset-Metadatum gesetzt wird. Keine zusätzlichen Telemetrie-, Foto- oder Standort-Tags.

Changesets sollen knapp gehalten werden, nur die zusammengehörigen Änderungen einer Person enthalten und nach Upload zuverlässig geschlossen werden. Änderungen pro AED sollen vorzugsweise einen einzelnen Diff-Upload bilden. Scheitert das Schließen, wird ein bestätigter Objekt-Upload nicht wiederholt.

## 8. Schalter, Kontozulassung und Mengenlimits

Alle Grenzwerte sind konservative Startwerte zur Diskussion und noch keine Freigabe. Die Laufzeitkonfiguration muss bei fehlendem, ungültigem oder widersprüchlichem Wert geschlossen bleiben.

### Unabhängige Schalter

| Schalter | Zweck | Vorgabe |
| --- | --- | --- |
| `OSM_PROD_LOGIN_ENABLED` | Produktions-OAuth anbieten | `false` in allen neuen Umgebungen |
| `OSM_PROD_WRITES_ENABLED` | produktive Schreibroute freigeben | `false`; unabhängig vom Login |
| `OSM_PROD_NEW_AEDS_ENABLED` | Produktions-Neuanlagen freigeben | `false`; separat, da höheres Dublettenrisiko |
| `OSM_PROD_DETAIL_CORRECTIONS_ENABLED` | existierende Werte korrigieren | `false`; standardmäßig und nach Pilot deaktiviert |
| `OSM_PROD_ALLOWED_SUBJECTS` | freigegebene OSM-Subjects | leer bedeutet niemand |

`OSM_PROD_WRITES_ENABLED` darf allein keine Funktion freischalten. Für Neuanlagen/Korrekturen muss zusätzlich der jeweilige Stufenschalter aktiv sein. Ein globaler Kill-Switch muss ohne Deployment im Worker-Dashboard zurückstellbar sein. Beim Abschalten neuer Vorgänge bleiben bereits begonnene Vorgänge abrufbar und sicher auflösbar, aber ohne neue Uploads, soweit kein Upload bereits begonnen hat.

### Mengenbegrenzungen

Vorgeschlagener enger Pilotstart pro verifiziertem Konto: höchstens **5 Schreibvorgänge pro UTC-Tag**, davon zunächst höchstens **2 Neuanlagen pro UTC-Tag**. Zusätzlich höchstens **1 Änderung pro Objekt innerhalb von 24 Stunden**, vorbehaltlich Versionsschutz. Überschreitungen werden serverseitig vor jeder OSM-API-Schreibanfrage abgelehnt; Zähler werden atomar reserviert, sodass parallele Anfragen das Limit nicht umgehen. Fehlgeschlagene Vorabprüfungen zählen nicht als abgeschlossener OSM-Schreibvorgang, ein unklarer Upload blockiert den Vorgang und wird nicht als Freiraum für blinde Wiederholung gezählt.

Diese Werte sind ein Diskussionsvorschlag für einen kleinen Konto-Pilot, keine aus OSM-Vorgaben abgeleiteten Limits. Vor Umsetzung sind OSM-API-Nutzungsbedingungen und Rate-Limit-Hinweise zu prüfen. Es gibt keine bezahlte oder bezahlpflichtige Aufstockung. Der Betreiber muss Limits senken können; bei leerer/ungültiger Konfiguration gelten Null Schreibvorgänge.

Metriken werden aggregiert und datensparsam gehalten: Anzahl nach Aktion und Ergebnis, Limitverweigerungen, API-Statusklasse, Laufzeit und unklare Vorgänge. Keine exakten Koordinaten, Foto-IDs, OAuth-Daten oder vollständigen API-Antworten erfassen.

## 9. Fehlerbehandlung, Wiederaufnahme und Betreiber-Rückweg

Vor dem Senden wird ein minimaler Vorgangsdatensatz dauerhaft mit ID und bestätigtem Vorschlag gespeichert. Die Uploadlogik muss Zustände wie `prepared`, `sending`, `complete`, `failed`, `conflict` und `uncertain` unterscheiden. Statuswechsel werden atomar/vergleichend vorgenommen; parallele Requests dürfen nicht denselben Vorgang ein zweites Mal senden.

- Fehler vor Changeset-Eröffnung: als fehlgeschlagen anzeigen; keine OSM-Änderung behaupten.
- Changeset geöffnet, Upload sicher nicht begonnen: Vorgang beenden und Changeset schließen; kein Retry ohne erneute Bestätigung, wenn der Vorschlag abgelaufen ist.
- Upload wurde gestartet, Antwort fehlt: `uncertain`. Bekannte Changeset-ID, stabiler Inhalt und OSM-Status abgleichen. Nie automatisch denselben Create-Upload erneut senden.
- Objekt gefunden, das alle bestätigten Werte enthält und zur Changeset-Aktion passt: Ergebnis als angewendet markieren und Objekt-ID/Version speichern.
- Objektstand widersprüchlich, Suche unvollständig oder API nicht verfügbar: unklar lassen und Betreiberprüfung auslösen. Kein Erfolgstext und kein zweiter Schreibvorgang.
- Versionskonflikt: Vorschlag verwerfen, Objekt neu lesen und Person alle Änderungen erneut bestätigen lassen.

### Operativer Rückweg

1. `OSM_PROD_WRITES_ENABLED=false` setzen; für zusätzliche Sicherheit auch Neuanlage- und Korrekturschalter ausschalten.
2. Laufende Schreibvorgänge nicht blind abbrechen: bereits gestartete Uploads erhalten ihren Statusabgleich, neue Vorgänge bleiben gesperrt.
3. Betroffene Changesets, Objekt-ID, Vorgangs-ID, Status und Fehlerklasse prüfen. Zugriff auf diese Daten nur für den Betreiber, angemessen befristen und protokollieren.
4. Bei fehlerhaftem Inhalt einen Korrekturvorschlag nach OSM-Version und aktuellem Objektstand erstellen. Keine automatische Rücksetzung: OSM-Änderungen sind öffentliche, versionierte Beiträge; zwischenzeitliche Änderungen anderer Mapper müssen erhalten bleiben.
5. Bei Duplikaten fachlich prüfen, welches Objekt erhalten bleibt. Nicht automatisch löschen oder verschieben. Community/örtliche Mapper können bei der Klärung helfen.
6. Ursache, Auswirkung, Umfang und Gegenmaßnahme dokumentieren, ohne personenbezogene Details zu veröffentlichen.
7. Wiederfreigabe erst nach behobenem Fehler, grünen Mocks/CI, kontrollierter erneuter Prüfung und ausdrücklicher Betreiberentscheidung.

Ein „Rollback“ bedeutet hier daher nicht blindes Zurückschreiben eines alten XML-Schnappschusses. Korrekturen sind neue, geprüfte OSM-Änderungen mit derselben Vorschau- und Versionskontrolle wie normale Bearbeitungen.

## 10. Ankündigung und Rückmeldung an die OSM-Gemeinschaft

Vor dem ersten echten Schreibzugriff soll der Projektinhaber den geplanten kleinen Pilot öffentlich ankündigen, Feedback einholen und eine Kontaktmöglichkeit für Rückmeldungen nennen. Vorgeschlagene Schritte:

1. Entwurf mit Zweck, Umfang, Regionen, erlaubten Tags, `source=survey`, Changeset-Kommentar, automatischen Grenzen und Abschaltweg vorbereiten.
2. Auf einschlägigen OSM-Kanälen (z. B. lokalem Forum/Community-Kanal und passenden AED-/Tagging-Diskussionen) die konkreten Fragen stellen; keine Veröffentlichung ohne Nutzerfreigabe.
3. Vorab transparent sagen: freiwillige Vor-Ort-Prüfung, keine sichere Fotoklassifikation, keine dauerhafte Fotoablage, geringe Limits, keine Massenedits und keine automatische Neuanlage.
4. Rückmeldungen, Einwände und Anpassungen dokumentieren. Bei ungeklärtem Einwand gegen Tagging, Changeset-Text oder Datenquelle keine Produktionsfreigabe.
5. Erst nach ausdrücklicher Entscheidung des Projektinhabers mit einer kleinen Kontoliste und engem Limit starten.

Dieses Dokument ist kein Entwurf einer bereits versandten oder veröffentlichten Nachricht. Kontaktaufnahme oder öffentliche Ankündigung braucht einen eigenen Auftrag.

## 11. Umbenennung von `development*`-Namen

Das Wort „development“ steckt derzeit in Auth-Zuständen, API-Pfaden, Requesttypen, Statusfeldern, Storage-Keys, Logs, Tabellen und Variablennamen. Eine globale Ersetzung wäre riskant: Sie kann alte Browserentwürfe, Datenbankdaten, API-Verträge, Migrationen und offene Vorgänge unlesbar machen.

Vorgeschlagene Zielbegriffe:

| Heute | Zielbereich | Migrationsregel |
| --- | --- | --- |
| `development` als OSM-Umgebung | `OSMEnvironment = "development" | "production"` bleibt vorerst explizit; UI zeigt nutzerverständlich „OSM-Testserver“/„OpenStreetMap“. | Keine mehrdeutige implizite Default-Umgebung. |
| `/api/osm/development/...` | Umgebungsneutrale Routen oder getrennte explizite Routefamilien | Alte Routen erst nach gemessener Clientablösung entfernen; fremde oder veraltete Schreibaufrufe immer serverseitig ablehnen. |
| `DevelopmentWriteRequest`, `developmentWriteAvailable` | `OSMWriteRequest`, `osmWriteAvailable` oder fachlich genauere Typen | In einem verhaltensneutralen Schritt mit TypeScript-Fehlern, keine Datenmigration. |
| `osm_development_*` Tabellen | `osm_write_*` bzw. `osm_operations` | Erst additive Migration, Lesen beider Namen, Kopie/Abgleich, dann spätere Entfernung. Kein Umbenennen im selben PR wie Production-Write-Code. |
| `OSM_DEV_WRITES_ENABLED` | `OSM_DEVELOPMENT_WRITES_ENABLED` oder getrennte Umgebungsflags | Bestehenden Variablennamen als rückwärtskompatiblen Alias behandeln und ausdrücklich dokumentierten Abschalttermin festlegen. |
| Browser Storage-Key `aedjaeger-pending-osm-development-write*` | neutraler Schlüssel mit Versionskennung | Weiterhin Legacy-Key lesen; nur nach vollständiger Validierung migrieren; keine Entwürfe still löschen. |
| Logs/Status-/Fehlerkennungen | neutrale, feste Codes | Alte Codes für Beobachtungszeitraum akzeptieren; Logs enthalten weiterhin keine Tokens, Koordinaten oder Antworttexte. |

Die Migration erfolgt schrittweise: erst Typen/Konstanten ohne Verhaltensänderung, danach neue neutrale Server-API mit kompatiblen Aliasen, danach additive Datenbankschicht und Wiederaufnahme alter Cliententwürfe, zuletzt alte Bezeichner entfernen, wenn keine aktiven Sitzungen/Clients sie verwenden. Die getrennte Produktionshostprüfung bleibt auch während einer Übergangsphase zwingend.

## 12. Einführungs- und Abnahmeplan

| Tor | Inhalt | Erforderlicher Nachweis | Stop-Kriterium |
| --- | --- | --- | --- |
| 0. Entwurf | Produktumfang und Threat Model freigeben | Projektinhaber bestätigt Rollen, Limits, Regionen, Datenschutzhinweise, Changeset-Text und Tags | Offene Fragen oder fehlende Community-Rückmeldung |
| 1. Rein lesende Technikprobe | Produktions OAuth-Scopes, Read-API, Umkreisabdeckung und Hostzuordnung prüfen | Dokumentierte manuelle Abfragen mit Testkonto; keine Schreibroute, keine OSM-Änderung | Unklar, ob API-Suche vollständig genug ist |
| 2. Implementierung hinter Totalschaltern | getrennte Tokens, Datenvertrag, sichere Vorgänge, Allowlist und Limit | Mocks für Erfolgs-, Konflikt-, Rate-Limit-, OAuth-, Token-Decrypt-, Timeout- und unklaren Uploadfälle; keine echte API in CI | Irgendein Test könnte production OSM verändern |
| 3. Dev-Regressionsprüfung | bestehender Dev-Schreibweg und Legacy-Wiederaufnahme bleiben intakt | Alle vorhandenen Checks, isolierte Mock-Hosts und ausdrücklich freigegebener Testserver-Praxistest | Dev/Production-Verwechslung möglich |
| 4. Begrenzte Freischaltung | genau benannte Konten, kleine Zeitspanne, niedriges Limit | ausdrückliche Freigabe durch Projektinhaber nach Community-Feedback; manuelle Dashboard-Werte gegengeprüft | Geheimnis, Limit, Logging oder Rückweg nicht geprüft |
| 5. Pilotbeobachtung | Fehler, Dubletten, unklare Vorgänge, Supportaufwand bewerten | datensparsame Wochenübersicht und Entscheidung über Fortführung | Fehlerhäufung oder kein belastbarer OSM-Abgleich |

Zu jedem Tor gehört ein PR mit deutscher Beschreibung, genaue Schalterliste und Rückweg. PRs und CI erhalten niemals Produktions-Tokens. Ein Deployment mit standardmäßig ausgeschalteten Flags ist keine Freigabe, die Schalter später ohne gesonderte Entscheidung einzuschalten.

## 13. Entscheidungen des Projektinhabers (26.11.2026)

Die zehn offenen Fragen sind beantwortet. Wo die Antwort vom Vorschlag abweicht, steht der Hinweis auf das verbleibende Risiko dabei.

| Nr | Frage | Entscheidung | Folge und Risiko |
| --- | --- | --- | --- |
| 1 | Region und Nutzergruppe | **Weltweit, alle angemeldeten OSM-Konten, aber nur dort, wo die Person ist:** Ein neuer AED liegt höchstens 100 m vom Standort (Foto-GPS oder Handy) entfernt. | Das PMTiles-Archiv deckt nur DACH ab; außerhalb ist die frische OSM-API-Abfrage die einzige Quelle (Abschnitt 6). Ein Fehler trifft sofort fremde Daten; Schutz durch Schalter und Limit. `OSM_PROD_ALLOWED_SUBJECTS` entfällt. |
| 2 | `source=survey` | **Nur am Changeset**, nicht am Objekt. | Keine zusätzlichen Objekt-Tags. |
| 3 | Changeset-Kommentar | **Zweisprachig, Deutsch und Englisch**, vor dem Speichern sichtbar. | Muster wie beim Hydrantenjäger, etwa „AED als vorhanden bestätigt / Confirmed AED as present (via AEDjaeger)“; genauer Wortlaut mit Etappe Q3. |
| 4 | Neuanlage in Produktion | **Eingeschaltet** (eigener Schalter `OSM_PROD_NEW_AEDS_ENABLED`). | Wie beim Hydrantenjäger: PMTiles nur zum schnellen Anzeigen, vor dem Vorschlag und erneut vor dem Upload eine frische OSM-API-Abfrage. Ein Fehler sperrt die Neuanlage. |
| 5 | Limits | **20 Schreibvorgänge pro Konto und UTC-Tag** zum Testen; später eventuell weniger. Zusätzlich höchstens 1 Änderung je Objekt in 24 Stunden. | Kein eigenes Teil-Limit für Neuanlagen. |
| 6 | Aufbewahrung und Übersicht | **90 Tage**, Betreiberübersicht nur für den Projektinhaber. | Bereinigung über den vorhandenen Aufräumjob. |
| 7 | Korrekturen in Produktion | **Einbauen**, hinter `OSM_PROD_DETAIL_CORRECTIONS_ENABLED` (Standard aus). | Gleiche Schutzregeln wie auf dem Testserver (Vorwert-Prüfung, zweite Bestätigung). |
| 8 | Community-Ankündigung | **Entfällt**, wie beim bereits veröffentlichten Hydrantenjäger. | Das Changeset macht die Herkunft klar: `created_by=AEDjaeger`, `locale`, `source=survey` und ein Kommentar. Verbleibendes Risiko: Rückfragen anderer Mapper kommen über die Changeset-Kommentare. |
| 9 | Production-OAuth-Anwendung | **Ja, wird eingerichtet.** | Nur der Projektinhaber kann sie mit seinem Konto auf openstreetmap.org anlegen. Anleitung in Abschnitt 15, Etappe Q2. |
| 10 | Freigabezeitpunkt | **Freigegeben am 26.11.2026.** | Die Schalter setzt der Projektinhaber je Etappe selbst, nachdem sie gemergt und geprüft ist. |

## 14. Referenzen im Repository und externe Grundlagen

- [Projektregeln](../AGENTS.md) – Sicherheits- und Produktentscheidungen.
- [OSM-Datenmodell](osm.md) – Tagallowlist und Schreibregeln.
- [Architektur, Abschnitt 9](architektur.md#9-zuverlässig-nach-osm-schreiben) – Versionskonflikte und Wiederaufnahme.
- [Pilot-Abnahme](pilot-abnahme.md) – aktueller Testserver-Praxisablauf.
- [Offene Fragen](offene-fragen.md) – Betreiberentscheidungen und ausstehende Abnahmen.
- Gesamt-Review vom 13.11.2026 (P9/P10) – lokale Arbeitsgrundlage, nicht Bestandteil des veröffentlichten Repositories.
- [OSM OAuth](https://wiki.openstreetmap.org/wiki/OAuth) – OAuth-Hosts und Scopes.
- [OSM API v0.6](https://wiki.openstreetmap.org/wiki/Api06) – Bounding-Box-Abfrage, Capabilities, Changesets und Fehlerbehandlung.

## 15. Bauplan (Etappen Q1 bis Q6)

Jede Etappe ist ein eigener PR gegen `main`. Kein Test, keine CI und kein Agentenlauf ruft die echte OSM-API schreibend auf; lesende Aufrufe laufen in Tests nur gegen Mocks.

| Etappe | Inhalt | Schalter |
| --- | --- | --- |
| **Q1** Frische Umkreissuche | Nach dem Vorbild des Hydrantenjägers: PMTiles liefert in DACH weiter die schnelle erste Anzeige. Danach fragt der Worker `GET /api/0.6/map` für einen Ausschnitt von etwa 100 m um den Standort am Produktionshost `api.openstreetmap.org` ab: weltweit, minutenaktuell. Erst dieses frische Ergebnis entscheidet über Treffer, Hinweise und Neuanlage. Prüft Status, Grenzen, Fehlerzeilen und Größe; ein Fehler ist nie ein leeres Ergebnis. Rein lesend. **Umgesetzt auf dem Arbeitsbranch (26.11.2026), noch nicht gemergt.** | keiner (nur lesend) |
| **Q2** Produktions-Anmeldung mit Schreibrecht | OAuth mit `openid write_api`, eigene Production-OAuth-Anwendung (am 26.11.2026 vom Projektinhaber registriert, **vertraulich**: der Worker braucht dafür ein neues Secret `OSM_CLIENT_SECRET`, wie heute schon `OSM_DEV_CLIENT_SECRET` beim Testserver), Token verschlüsselt in D1 (eigenes Secret), feste Host-Zuordnung je Umgebung. Anleitung für den Projektinhaber zum Anlegen der OAuth-Anwendung. | `OSM_PROD_LOGIN_ENABLED` |
| **Q3** Schnellweg in Produktion | „Noch vorhanden“ schreibt `check_date` in das echte OSM. Changeset mit `created_by=AEDjaeger`, `source=survey` und zweisprachigem Kommentar. Limit 20 pro Tag und 1 je Objekt in 24 h, atomar in D1. Wiederaufnahme unklarer Uploads wie auf dem Testserver. | `OSM_PROD_WRITES_ENABLED` |
| **Q4** Ergänzen in Produktion | Detailweg (nur fehlende Tags) für bestehende AEDs. | `OSM_PROD_WRITES_ENABLED` |
| **Q5** Neuanlage in Produktion | Neuanlage mit erneuter OSM-API-Abfrage unmittelbar vor dem Upload. Der Kartenpunkt darf höchstens 100 m vom Standort (Foto-GPS oder Handy) entfernt liegen; Browser und Server prüfen das. | `OSM_PROD_NEW_AEDS_ENABLED` |
| **Q6** Korrekturen in Produktion | Ersetzen vorhandener Werte mit Vorwert-Prüfung und zweiter Bestätigung. | `OSM_PROD_DETAIL_CORRECTIONS_ENABLED` |

Die Umbenennung der `development*`-Namen (Abschnitt 11) bleibt ein eigener, späterer Schritt und gehört nicht in dieselben PRs.

