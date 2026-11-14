# Betriebshandbuch

Dieses Handbuch beschreibt den bestehenden Pilotbetrieb auf Cloudflare Workers. Es enthält keine Zugangsdaten. Secrets bleiben in den GitHub-Environment- bzw. Cloudflare-Einstellungen.

## Zuständigkeiten und Zugänge

- Die produktive Worker-Bereitstellung erfolgt aus dem GitHub-Environment `production`. `CLOUDFLARE_API_TOKEN` ist dort ein Secret; `CLOUDFLARE_ACCOUNT_ID` ist eine Variable.
- Das Token braucht die für den Worker-Deploy nötigen Worker-Rechte sowie **D1 Read**. Der Deploy-Job liest damit ausschließlich das D1-Migrationsverzeichnis. Er benötigt keine Schreibrechte für D1-Migrationen.
- OAuth- und optionale Fotoprüfungs-Secrets werden direkt beim Cloudflare-Worker verwaltet. Sie gehören nicht in GitHub-Kommentare, Quellcode, Build-Ausgaben oder Logs.
- `OSM_DEV_WRITES_ENABLED` und `OSM_DETAIL_CORRECTIONS_ENABLED` sind Betreiberschalter. Der Agent aktiviert sie nicht. Beide sind standardmäßig aus; Korrekturen verlangen zusätzlich den ersten Schalter.

Die in `server/worker.ts` verwendeten Einstellungen sind:

| Einstellung | Art | Zweck |
| --- | --- | --- |
| `OSM_CLIENT_ID`, `OSM_REDIRECT_URI` | Variable | OSM-Anmeldung |
| `OSM_DEV_LOGIN_ENABLED`, `OSM_DEV_CLIENT_ID`, `OSM_DEV_REDIRECT_URI` | Variable | optionale OSM-Testanmeldung |
| `OSM_DEV_CLIENT_SECRET` | Secret | OSM-Testanmeldung |
| `OSM_OAUTH_ENCRYPTION_KEY` | Secret | verschlüsselte OSM-Token in D1 |
| `OSM_DEV_WRITES_ENABLED` | Variable | bestätigt Schreiben ausschließlich auf OSM Dev |
| `OSM_DETAIL_CORRECTIONS_ENABLED` | Variable | erlaubt Korrekturen bestehender Detailwerte, nur zusammen mit dem Schreibschalter |
| `OPENAI_API_KEY` | Secret | optionaler Bildfilter; standardmäßig aus |
| `AI_ANALYSIS_ENABLED`, `AI_ANALYSIS_ALLOWED_OSM_SUBJECTS`, `AI_ANALYSIS_COST_RESERVATION_MICROS`, `AI_ANALYSIS_USER_DAILY_LIMIT_MICROS`, `AI_ANALYSIS_GLOBAL_DAILY_LIMIT_MICROS` | Variable | Betreiberfreigabe, Zulassungsliste und Kostenlimits des Bildfilters |

`DB` ist das D1-Binding aus `wrangler.jsonc`. Die OAuth- und Fotoprüfungseinrichtung steht ausführlicher in [Pilot-Abnahme](pilot-abnahme.md) und [offene Fragen](offene-fragen.md).

## Datenbankmigrationen

SQL-Änderungen liegen dauerhaft unter `migrations/`; bereits angewendete Dateien werden weder umbenannt noch entfernt. Neue Dateien erhalten den nächsten freien Namen mit vierstelliger Nummer und beschreibendem Suffix, zum Beispiel `0012_add_example.sql`.

Vor jeder Worker-Bereitstellung fragt CI ausschließlich `d1_migrations` ab und vergleicht die Einträge mit den Dateien im Repository. Das SQL ist ein `SELECT`; der Deploy wendet keine Migration an. Eine fehlende, zusätzliche oder nicht lesbare Migration stoppt den Deploy. Damit bleibt der Worker auf dem bisherigen Stand, bis der Projektinhaber die Änderung geprüft und manuell angewendet hat.

```sh
npx wrangler d1 migrations list aedjaeger-pilot --remote
```

Nach Prüfung einer neuen Migration wendet der Projektinhaber sie kontrolliert an:

```sh
npx wrangler d1 migrations apply aedjaeger-pilot --remote
```

Danach lässt sich der geprüfte Deploy erneut über den regulären CI-Ablauf anstoßen. Zugangsdaten werden von Wrangler aus seiner sicheren lokalen Anmeldung bezogen; sie gehören nicht in Befehlszeilen oder Dokumentation. Für CI genügt für die Migrationsabfrage `D1 Read`; dort wird keine Migration ausgeführt.

## Prüfung und Bereitstellung

Pull Requests laufen durch den `validate`-Job: Unit-Tests, Build, Worker-Prüfung, HTTP-Grenztests und Chromium-/WebKit-E2E. Erst nach erfolgreichem Check und Merge auf `main` startet der Deploy-Job. Ein manueller Workflow-Lauf benötigt `deploy_to_workers=true` und verwendet ebenfalls das Environment `production`.

Vor dem Worker-Upload prüft der Deploy-Job das Remote-Schema. Wenn der Migrationsstand abweicht oder nicht lesbar ist, darf der Job nicht fortgesetzt werden. Dieser Schutz verhindert, dass neuer Code auf noch nicht vorhandene D1-Tabellen trifft. Der manuelle Migrationsschritt bleibt eine Betreiberaktion.

Der Workflow `Live-Check AED-Datenquelle` läuft täglich um 06:17 UTC und kann zusätzlich manuell gestartet werden. Er liest `metadata.json`, den PMTiles-Header und eine Kachel vom OpenFireMap-Host. Er hat keine Secrets, führt keinen Deploy aus und verändert weder OSM noch D1. Ein Fehlschlag bedeutet, dass die AED-Suche gegenwärtig nicht verlässlich belegt ist; er ist kein Nachweis, dass an einem Ort kein AED existiert. Die genaue Testkoordinate lässt sich beim manuellen Start festlegen.

## Diagnose und Wiederherstellung

- `GET /api/health` prüft nur, ob der Worker antwortet. Er belegt weder eine funktionierende Datenbank noch eine erreichbare AED-Datenquelle.
- Fehlgeschlagener Live-Check: Actions-Lauf öffnen und Fehlercode/Zeitpunkt prüfen. Keine AED-Neuanlage aus einer unvollständigen Suche ableiten; die App muss geschlossen fehlschlagen.
- `analysis_budget_unavailable` oder `missing_table`: D1-Binding und angewendete Migrationsdateien prüfen. Fotoprüfung bleibt optional und fällt bei einem Anbieter- oder Speicherfehler auf die Selbstbestätigung zurück.
- `analysis_budget_exceeded` oder `analysis_not_allowed`: Limits beziehungsweise Konto-Zulassung prüfen. Schalter und Kostenlimits nicht zur Fehlersuche unbedacht erhöhen.
- `development_write_unavailable`, `development_session_required` oder `corrections_disabled`: Betreiber-Schalter und Testserver-Sitzung prüfen. Eine Schreibanfrage nicht wiederholt absenden, wenn die App „Ergebnis unklar“ meldet; zuerst denselben Vorgang abgleichen.
- Bei einem Worker-Fehler zuerst den letzten funktionierenden Commit und den zugehörigen Actions-Deploy ermitteln. Ein Code-Rollback kann im Cloudflare-Dashboard auf eine vorherige Worker-Version erfolgen. D1 wird dadurch nicht zurückgesetzt; Schemaänderungen brauchen eine geprüfte Vorwärtsmigration. Ein OSM-Changeset wird durch einen Code- oder D1-Rollback nicht rückgängig gemacht.

## Schlüsselwechsel

Secrets werden direkt am zuständigen Anbieter ersetzt und weder protokolliert noch in Tickets kopiert. Den OSM-Client-Schlüssel beim Anbieter und die Worker-Konfiguration koordiniert aktualisieren; danach Login und Callback mit einem Testkonto prüfen.

`OSM_OAUTH_ENCRYPTION_KEY` hat derzeit keine Schlüsselversion oder Übergangsphase. Ein Wechsel macht vorhandene verschlüsselte OSM-Tokens unlesbar; betroffene Sitzungen müssen sich erneut anmelden. Vor dem Wechsel geplante Testkonten, Zeitpunkt und Rückweg festlegen und keine Schreibschalter aktivieren.

Beim Wechsel von `OPENAI_API_KEY` die Prüfung bis zum erfolgreichen Funktionstest ausgeschaltet lassen. Der Schlüssel wird nur als Cloudflare-Secret gespeichert; Tests und CI verwenden niemals die echte OpenAI-API.
