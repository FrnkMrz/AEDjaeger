#!/usr/bin/env node
/**
 * Deployment gate for D1 schema changes. This executes one read-only SELECT through
 * Wrangler, then compares the remote migration ledger with the SQL files in the repo.
 * It intentionally never applies migrations: a pending change stops the deployment.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function readAppliedMigrationNames(response) {
  if (!Array.isArray(response) || response.length !== 1) {
    throw new Error("Die D1-Antwort enthält nicht genau ein Abfrageergebnis.");
  }
  const [query] = response;
  if (query?.success !== true || !Array.isArray(query.results)) {
    throw new Error("Die D1-Abfrage war nicht erfolgreich oder hatte ein unerwartetes Format.");
  }
  const names = query.results.map((row) => row?.name);
  if (names.some((name) => typeof name !== "string" || !/^\d+_[a-z0-9_-]+\.sql$/u.test(name))) {
    throw new Error("Die D1-Migrationstabelle enthält einen ungültigen oder unbekannten Eintrag.");
  }
  if (new Set(names).size !== names.length) {
    throw new Error("Die D1-Migrationstabelle enthält doppelte Einträge.");
  }
  return names;
}

export function compareMigrationNames(localNames, appliedNames) {
  const local = new Set(localNames);
  const applied = new Set(appliedNames);
  return {
    pending: [...local].filter((name) => !applied.has(name)).sort(),
    unknown: [...applied].filter((name) => !local.has(name)).sort(),
  };
}

function checkRemoteMigrations() {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("CLOUDFLARE_API_TOKEN oder CLOUDFLARE_ACCOUNT_ID fehlt; der Deploy wird sicherheitshalber gestoppt.");
  }

  const wrapper = fileURLToPath(new URL("./run-wrangler.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [
    wrapper,
    "d1", "execute", "aedjaeger-pilot", "--remote", "--json",
    "--command", "SELECT name FROM d1_migrations ORDER BY name",
  ], { encoding: "utf8" });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const diagnostic = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Der D1-Migrationsstand ließ sich nicht lesen; der Deploy wird gestoppt.${diagnostic ? `\n${diagnostic}` : ""}`);
  }

  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    throw new Error("Die D1-Abfrage lieferte kein gültiges JSON; der Deploy wird gestoppt.");
  }
  const applied = readAppliedMigrationNames(response);
  const local = readdirSync(fileURLToPath(new URL("../migrations/", import.meta.url)))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();
  const difference = compareMigrationNames(local, applied);

  if (difference.pending.length > 0 || difference.unknown.length > 0) {
    const lines = ["D1-Schema und Repository stimmen nicht überein; der Deploy wird gestoppt."];
    if (difference.pending.length > 0) lines.push(`Noch nicht angewendet: ${difference.pending.join(", ")}`);
    if (difference.unknown.length > 0) lines.push(`Im Repository fehlen bereits angewendete Migrationen: ${difference.unknown.join(", ")}`);
    lines.push("Migrationen nach Prüfung manuell auf D1 anwenden; der Deploy führt keine SQL-Änderungen aus.");
    throw new Error(lines.join("\n"));
  }

  console.log(`D1-Migrationsstand stimmt mit ${local.length} lokalen Migrationen überein.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    checkRemoteMigrations();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "D1-Migrationsprüfung fehlgeschlagen.");
    process.exitCode = 1;
  }
}
