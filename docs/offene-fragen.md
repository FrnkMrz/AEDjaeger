# Entscheidungen und nächste Schritte

Stand: 8.11.2026. Fotoaufnahme und maximale Einfachheit sind festgelegt: **Foto → Sichtbarkeit selbst bestätigen → regionalen AED-Datenbestand prüfen → vorhandenen AED bestätigen oder neuen Eintrag vorbereiten.** Der Pilot verzichtet auf OpenAI und alle anderen externen Bilddienste; Foto und EXIF bleiben lokal. GPS aus dem Foto hat Vorrang. Ohne Foto-GPS wird Handy-GPS oder eine Kartenposition nur nach ausdrücklicher Auswahl genutzt. GPT-6-Luna- und Overpass-Überlegungen weiter unten sind historische Entscheidungen und durch den aktuellen Umbau überholt. OSM-Schreibzugriffe bleiben ausgeschaltet.

## Festgelegt

- Die App ist als mobile PWA mit gemeinsam gehosteter Oberfläche und API auf Cloudflare vorgesehen. Der öffentliche Pilot-Worker ist unter [aedjaeger.aedjaeger.workers.dev](https://aedjaeger.aedjaeger.workers.dev) erreichbar; API-Funktionen bleiben bis zu ihrer sicheren Konfiguration abgeschaltet.
- Vor Ort wird ein Foto aufgenommen oder ausgewählt; die Person bestätigt ausdrücklich, dass ein AED-Gerät oder -Gehäuse sichtbar ist. Das Foto und seine EXIF-Daten verlassen das Gerät nicht.
- Eine gültige OpenStreetMap-Anmeldung ist Voraussetzung für jede Arbeitsfunktion. Ohne Sitzung wird nur die Einstiegsseite mit Konto-Erstellung und OSM-Anmeldung gezeigt; Kamera, Fotos, Standort und Suche bleiben gesperrt.
- Der Standort wird mit bestehenden OpenStreetMap-Einträgen abgeglichen. Ein passender Treffer wird als „noch vorhanden“ bestätigt; ohne Treffer wird ein neuer Eintrag vorbereitet.
- Werden nahe AEDs gefunden, kann die Person jetzt ausdrücklich bestätigen, dass keiner davon das fotografierte Gerät ist. Nach einer vollständigen Suche führt das zur Standortkarte; der Testserver prüft vor einer Neuanlage erneut auf inzwischen erschienene oder nicht geprüfte AEDs. Eine echte OSM-Testserver-Schreibprobe steht noch aus.
- Im eindeutigen Fall genügt eine kurze Bestätigung für den OSM-Schreibvorgang.
- Die erste Version soll Deutsch, Englisch, Polnisch, Japanisch, Französisch und Spanisch unterstützen.
- Im Pilot wird Gamification nur intern gezählt: erfolgreiche Vor-Ort-Prüfungen nach bestätigtem OSM-Vorgang. Es gibt keine sichtbare Anzeige und keine Teilfunktion. Teilen wird frühestens nach dem Pilot neu bewertet.
- Vorbild bleibt Hydrantenjäger. Der Produktname ist „AEDjaeger“ und wird in allen Sprachen gleich geschrieben.
- Der erste Prototyp nutzt Vite und TypeScript ohne React. Die Auswahl hält den mobilen Ablauf klein und benötigt kein React-spezifisches Zustandssystem. Die produktive Zielarchitektur bleibt Cloudflare Workers mit Static Assets.
- Automatische Erkennung ist keine Pilotfunktion. Eine spätere Erprobung ist nur lokal auf dem Gerät und nach eigener Produktentscheidung vorgesehen.

## Nächste praktische Prüfungen

1. Phase 1 auf Android und iPhone prüfen: manuelle Sichtbestätigung, lokales Foto-GPS, ausdrückliche Standortwahl bei fehlendem GPS und Datum bei alten oder datumsfreien Kamera- wie Galerieaufnahmen. Bei fehlendem EXIF-Aufnahmedatum oder einem Datum ungleich heute wird vor Suche oder Prüfdatum eine ausdrückliche Datumsbestätigung verlangt.
2. Phase 2 planen und umsetzen: regionalen AED-Datenbestand aus der OpenFireMap-Pipeline ausliefern und in AEDjaeger konsumieren. Die laufende Suche darf nicht von Overpass abhängen. Die offizielle OSM-API wird nur für gezielte Aktualitäts-/Versionsprüfung und bestätigtes Schreiben eingesetzt.
3. Den Abgleich mit simulierten Kandidaten testen: keine Treffer, eindeutiger Treffer, mehrere nahe Treffer, unvollständiger regionaler Bestand, veralteter Snapshot und offline/Netzabbruch. Ein unvollständiger oder veralteter Datenstand darf keine Neuanlage als sicher darstellen.
4. Erst nach erfolgreicher Suche mit einer vollständigen regionalen Datenquelle die Vorschau und anschließend separat freigegebene OSM-Dev-Schreibwege prüfen. Produktives OSM bleibt in Tests ausgeschlossen.

## Einrichtung des OSM-Testlogins

Für einen echten Login muss eine **separate OAuth-Anwendung auf dem OSM-Entwicklungsserver** angelegt werden. Als Weiterleitungsadresse ist exakt `https://aedjaeger.aedjaeger.workers.dev/api/auth/osm/development/callback` einzutragen. Die OSM-Dev-OpenID-Konfiguration nennt `client_secret_basic` und `client_secret_post` als unterstützte Token-Endpunkt-Authentifizierung. AEDjaeger verwendet PKCE zusätzlich zu `client_secret_basic`; dafür wird `OSM_DEV_CLIENT_SECRET` ausschließlich als Cloudflare-Worker-Secret hinterlegt. Das Secret gelangt weder in Browsercode, Logs noch ins Repository. Für einen verfügbaren Testserver-Login müssen `OSM_DEV_LOGIN_ENABLED=true`, `OSM_DEV_CLIENT_ID`, `OSM_DEV_REDIRECT_URI`, `OSM_DEV_CLIENT_SECRET` und das serverseitige `OSM_OAUTH_ENCRYPTION_KEY` vorhanden sein. Für Testserver-Änderungen muss `OSM_DEV_WRITES_ENABLED=true` separat gesetzt werden; dieser Schalter bleibt standardmäßig aus. `OSM_DEV_REDIRECT_URI` muss zur tatsächlichen Worker-Adresse und zum registrierten Callback passen. Produktions-Client-ID, -Secret und -Callback werden nicht wiederverwendet. Ohne vollständige Konfiguration zeigt die App keinen Testserver-Login.

## Noch zu entscheiden

- Welches Update-Intervall und welches maximale Alter des regionalen AED-Datenbestands sind für einen Pilot akzeptabel? Ein Snapshot muss Alter und Abdeckungsstatus liefern, damit AEDjaeger bei veralteten oder unvollständigen Daten sicher stoppt.
- Welcher eng begrenzte OSM-API-Abgleich ist für gezielte Versionsprüfung und den späteren bestätigten Schreibvorgang nötig? Er darf keine flächige Ersatzsuche werden.
- `OSM_DEV_WRITES_ENABLED` bleibt aus. Vor einem echten Testserver-Schreibvorgang braucht es eine separate ausdrückliche Freigabe und einen konkreten Vorschlag.
- Vor einem Testserver-Schreiben muss die Standortbestätigung auf dem Mobilgerät nochmals geprüft werden; die Korrektur erfolgt über die verschiebbare Karte.
- Reicht Cloudflare Free für den Pilot? Workers Paid und eine eigene Domain bleiben bis zu einem belegten Bedarf ausgeschlossen.
- Welche Lizenz passt zum Projekt?
- Nach dem Pilot: Ist eine sichtbare oder teilbare Fortschrittskarte den Aufwand und die Datenschutzprüfung wert?

## Bereits recherchiert

Für „noch vorhanden“ ist `check_date` laut OSM-Dokumentation geeignet. Die Anwendung bestätigt damit keine Gerätewartung und verändert keine anderen Eigenschaften. Für die technische Arbeit liegt ein [Plan mit überprüfbaren Etappen](umsetzungsplan.md) vor. Das [Repository](https://github.com/FrnkMrz/AEDjaeger) ist öffentlich; die Lizenz ist noch offen.
