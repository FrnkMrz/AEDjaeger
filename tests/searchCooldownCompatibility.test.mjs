import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

describe("D1-Suchbremse beim gestaffelten Worker-Rollout", () => {
  it("stellt den historischen Tabellennamen wieder her und erhält bestehende Sperren", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`
        CREATE TABLE overpass_search_cooldowns (
          osm_subject_hash TEXT PRIMARY KEY,
          next_allowed_at INTEGER NOT NULL
        );
        INSERT INTO overpass_search_cooldowns VALUES ('existing-subject-hash', 5000);
      `);
      database.exec(migration("0012_static_search_cooldown.sql"));
      database.exec(migration("0013_restore_legacy_search_cooldown.sql"));

      const restoredRow = database
        .prepare("SELECT next_allowed_at FROM overpass_search_cooldowns WHERE osm_subject_hash = ?")
        .get("existing-subject-hash");
      const renamedTable = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("static_search_cooldowns");

      expect(restoredRow?.next_allowed_at).toBe(5000);
      expect(renamedTable).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("lässt den alten Worker nach der Kompatibilitätsmigration weiter reservieren", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`
        CREATE TABLE overpass_search_cooldowns (
          osm_subject_hash TEXT PRIMARY KEY,
          next_allowed_at INTEGER NOT NULL
        );
      `);
      database.exec(migration("0012_static_search_cooldown.sql"));
      database.exec(migration("0013_restore_legacy_search_cooldown.sql"));

      const reservation = database
        .prepare(`
          INSERT INTO overpass_search_cooldowns (osm_subject_hash, next_allowed_at)
          VALUES (?, ?)
          ON CONFLICT (osm_subject_hash) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
          WHERE overpass_search_cooldowns.next_allowed_at <= ?
        `)
        .run("new-subject-hash", 31_000, 1_000);

      expect(reservation.changes).toBe(1);
      expect(
        database
          .prepare("SELECT next_allowed_at FROM overpass_search_cooldowns WHERE osm_subject_hash = ?")
          .get("new-subject-hash")?.next_allowed_at,
      ).toBe(31_000);
    } finally {
      database.close();
    }
  });
});
