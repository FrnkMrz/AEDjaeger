# Domain aedjaeger.de

Stand: **13.11.2026**

## Entscheidung

- Der Projektinhaber hat **aedjaeger.de** am 13.11.2026 bei united domains für **12 Monate** gesichert.
- Die Domain bleibt bei united domains registriert. Cloudflare bekommt nur das DNS (Free-Tarif, 0 €). Es gibt keinen Registrar-Umzug.
- Das Enddatum der Laufzeit steht im united-domains-Konto. **Offen:** Datum dort ablesen, automatische Verlängerung prüfen und eine Erinnerung für rund 4 Wochen vorher setzen. Läuft die Domain ab, fällt die App unter dieser Adresse aus und OSM-Anmeldungen schlagen fehl.
- Hauptadresse soll `https://aedjaeger.de` werden (ohne `www`). `www.aedjaeger.de` leitet später dorthin um; das ist kein Pilotbedarf.
- **Zeitpunkt (Entscheidung des Projektinhabers, 13.11.2026):** Die Domain ist vorerst nur gesichert. Der Umzug der App erfolgt erst, wenn das Projekt öffentlich online geht. Bis dahin bleibt `aedjaeger.aedjaeger.workers.dev` die Pilotadresse.
- Die Weiterleitung zu Cloudflare ist möglich und kostenlos: Man trägt bei united domains die Cloudflare-Nameserver ein; die Domain bleibt dort registriert. Der Code ändert sich erst, wenn die Zone bei Cloudflare aktiv ist (siehe Reihenfolge).

## Warum früh umziehen (spätestens vor dem öffentlichen Start)

Der Pilot ist klein. Jede Adresse ist für den Browser ein eigener Ursprung (Origin). Beim Wechsel gehen deshalb verloren oder müssen neu erteilt werden:

- Anmeldung und Sitzung,
- lokal gespeicherte Entwürfe,
- installierte PWA (neu zum Home-Bildschirm hinzufügen),
- die einmalige Standort-Erlaubnis pro Gerät.

Mit wenigen Testpersonen kostet das jetzt wenig. Nach einem größeren Start kostet es deutlich mehr.

## Reihenfolge

| Nr. | Schritt | Wer | Hinweis |
| --- | --- | --- | --- |
| 1 | Bei united domains prüfen: Laufzeit, Verlängerung, **DNSSEC** (vor dem Nameserver-Wechsel ausschalten), vorhandene **E-Mail-Postfächer oder -Weiterleitungen** | Projektinhaber | Hängen Postfächer an der Domain, muss man MX- und SPF-Einträge zuerst bei Cloudflare nachbauen. Sonst fällt die Post aus. |
| 2 | Im Cloudflare-Dashboard die Domain `aedjaeger.de` als Website hinzufügen, Tarif **Free** | Projektinhaber | Cloudflare nennt zwei Nameserver. Kein Bezahltarif nötig. |
| 3 | Bei united domains die zwei Nameserver von Cloudflare eintragen | Projektinhaber | Dauert Minuten bis Stunden. Der Status in Cloudflare springt auf „Aktiv“. |
| 4 | Im Worker `aedjaeger` unter „Domains und Routen“ `aedjaeger.de` als **Custom Domain** hinzufügen | Projektinhaber oder Agent per PR in `wrangler.jsonc` | Cloudflare legt DNS-Eintrag und Zertifikat selbst an. Ein CNAME bei united domains reicht nicht, weil die Hauptdomain (Apex) die Zone bei Cloudflare braucht. |
| 5 | Auf dem **OSM-Dev-Server** die OAuth-Anwendung um die Redirect-URI `https://aedjaeger.de/api/auth/osm/development/callback` ergänzen | Projektinhaber | Die alte URI bleibt zunächst stehen. |
| 6 | Im Cloudflare-Dashboard die Variable `OSM_DEV_REDIRECT_URI` auf die neue URI setzen | Projektinhaber | Der Worker akzeptiert genau **einen** Ursprung (`server/worker.ts` vergleicht `request.url` mit der Redirect-URI). Ab jetzt schlägt die Anmeldung auf der workers.dev-Adresse fehl. |
| 7 | Anmeldung, Foto, Suche und Abmelden auf `https://aedjaeger.de` prüfen (Handy und Desktop) | Projektinhaber, Agent begleitet | Keine OSM-Schreibvorgänge. `OSM_DEV_WRITES_ENABLED` bleibt aus. |
| 8 | Repo anpassen: `.github/workflows/ci.yml` (`environment.url`), Links in `docs/`, Redirect-URI in `docs/pilot-abnahme.md` (C0.2), Eintrag in `CHANGELOG.md` | Agent, als PR | Erst nach Schritt 7. |
| 9 | Entscheiden, ob `workers_dev` danach ausgeschaltet wird | Projektinhaber | Empfehlung: **ja**. Zwei Adressen bedeuten zwei Sitzungen, zwei PWA-Installationen und eine kaputte Anmeldung auf der alten Adresse. |

## Warum der Code noch nicht angefasst ist

Trägt `wrangler.jsonc` eine Custom Domain ein, bevor die Zone bei Cloudflare aktiv ist, schlägt der automatische Deploy nach jedem Merge auf `main` fehl. Die Pilotadresse bliebe dann auf dem alten Stand stehen. Darum kommt die Code-Änderung erst nach Schritt 3.

## Offene Entscheidungen

- Soll `www.aedjaeger.de` auf `aedjaeger.de` umleiten? (Empfehlung: ja, später.)
- Läuft die OSM-Produktionsanwendung später ebenfalls unter `aedjaeger.de`? Dann braucht sie eine eigene Redirect-URI (`/api/auth/osm/callback`) und eine eigene Registrierung auf openstreetmap.org. Das ist nicht Teil dieses Umzugs.
- Lizenz: weiterhin offen.

## Kosten

- Cloudflare-Zone im Free-Tarif: 0 €.
- Custom Domain am Worker (Workers Free): 0 €.
- Domain bei united domains: bezahlt, 12 Monate. Verlängerung danach ist eine eigene Entscheidung.
