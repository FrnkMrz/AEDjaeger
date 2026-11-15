import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

function createDatabaseWithCompatibility() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE overpass_search_cooldowns (
      osm_subject_hash TEXT PRIMARY KEY,
      next_allowed_at INTEGER NOT NULL
    );
    INSERT INTO overpass_search_cooldowns VALUES ('existing-subject-hash', 5000);
  `);
  database.exec(migration("0012_static_search_cooldown.sql"));
  database.exec(migration("0013_legacy_search_cooldown_compatibility.sql"));
  return database;
}

const nextAllowedAt = (database, tableName, subjectHash) =>
  database.prepare(`SELECT next_allowed_at FROM ${tableName} WHERE osm_subject_hash = ?`).get(subjectHash)
    ?.next_allowed_at;

describe("D1-Suchbremse während eines Worker-Rollouts", () => {
  it("erhält bestehende Sperren und spiegelt Reservierungen aus der alten Worker-Version", () => {
    const database = createDatabaseWithCompatibility();
    try {
      expect(nextAllowedAt(database, "static_search_cooldowns", "existing-subject-hash")).toBe(5000);

      database
        .prepare(`
          INSERT INTO overpass_search_cooldowns (osm_subject_hash, next_allowed_at)
          VALUES (?, ?)
          ON CONFLICT (osm_subject_hash) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
          WHERE overpass_search_cooldowns.next_allowed_at <= ?
        `)
        .run("existing-subject-hash", 32_000, 5_000);

      expect(nextAllowedAt(database, "overpass_search_cooldowns", "existing-subject-hash")).toBe(32_000);
      expect(nextAllowedAt(database, "static_search_cooldowns", "existing-subject-hash")).toBe(32_000);

      const newWorkerRetry = database
        .prepare(`
          INSERT INTO static_search_cooldowns (osm_subject_hash, next_allowed_at)
          VALUES (?, ?)
          ON CONFLICT (osm_subject_hash) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
          WHERE static_search_cooldowns.next_allowed_at <= ?
        `)
        .run("existing-subject-hash", 38_000, 6_000);
      expect(newWorkerRetry.changes).toBe(0);
      expect(nextAllowedAt(database, "static_search_cooldowns", "existing-subject-hash")).toBe(32_000);
    } finally {
      database.close();
    }
  });

  it("spiegelt neue Worker-Reservierungen zurück und bereinigt abgelaufene Sperren beidseitig", () => {
    const database = createDatabaseWithCompatibility();
    try {
      database
        .prepare("INSERT INTO static_search_cooldowns (osm_subject_hash, next_allowed_at) VALUES (?, ?)")
        .run("new-subject-hash", 40_000);

      expect(nextAllowedAt(database, "overpass_search_cooldowns", "new-subject-hash")).toBe(40_000);

      const oldWorkerRetry = database
        .prepare(`
          INSERT INTO overpass_search_cooldowns (osm_subject_hash, next_allowed_at)
          VALUES (?, ?)
          ON CONFLICT (osm_subject_hash) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
          WHERE overpass_search_cooldowns.next_allowed_at <= ?
        `)
        .run("new-subject-hash", 50_000, 10_000);
      expect(oldWorkerRetry.changes).toBe(0);

      database.prepare("DELETE FROM overpass_search_cooldowns WHERE next_allowed_at <= ?").run(40_000);
      expect(nextAllowedAt(database, "static_search_cooldowns", "new-subject-hash")).toBeUndefined();
      expect(nextAllowedAt(database, "overpass_search_cooldowns", "new-subject-hash")).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
