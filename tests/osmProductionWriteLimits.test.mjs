// Prüft die Grenzen für Schreibvorgänge am echten OSM (Etappe Q3) gegen eine ECHTE SQLite-Datenbank.
//
// Warum nicht wie sonst mit einer nachgebauten Datenbank: Die Grenzen stecken in einer einzigen SQL-Anweisung
// (Prüfen und Anlegen zugleich). Nur eine echte Datenbank zeigt, ob diese Anweisung wirklich das Richtige tut.
// Die Datenbank entsteht im Speicher aus allen Migrationen des Repos, also auch aus 0014.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_OPERATION_LIFETIME_MS,
  reserveOSMDevelopmentWrite,
  reserveOSMProductionWrite,
} from "../server/storage/osmDevelopmentWriteOperations";

const migrationsDir = resolve(import.meta.dirname, "../migrations");

/** Kleine Brücke: bietet die Teile der D1-Schnittstelle an, die der Worker nutzt. */
function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(resolve(migrationsDir, file), "utf8"));
  }
  const d1 = {
    prepare(query) {
      let values = [];
      return {
        bind(...next) {
          values = next;
          return this;
        },
        async run() {
          const result = sqlite.prepare(query).run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        async first() {
          return sqlite.prepare(query).get(...values) ?? null;
        },
      };
    },
  };
  return { sqlite, d1 };
}

const owner = "a".repeat(64);
const otherOwner = "b".repeat(64);
const hash = "c".repeat(64);
const now = Date.UTC(2026, 10, 27, 12);
let counter = 0;
/** Neue, gültige Vorgangs-ID (UUID v4-Form). */
function nextId() {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

describe("Grenzen für das echte OSM (Migration 0014)", () => {
  it("legt einen Vorgang an, merkt sich Objekt und Umgebung und hält ihn 90 Tage", async () => {
    const { sqlite, d1 } = createDatabase();
    const id = nextId();
    const result = await reserveOSMProductionWrite(d1, {
      ownerHash: owner,
      operationId: id,
      requestHash: hash,
      targetId: "node/1",
      now,
    });
    expect(result).toMatchObject({ kind: "reserved", created: true, operation: { state: "started" } });
    expect(
      sqlite.prepare("SELECT osm_environment, target_id, expires_at FROM osm_development_write_operations").get(),
    ).toEqual({
      osm_environment: "production",
      target_id: "node/1",
      expires_at: now + PRODUCTION_OPERATION_LIFETIME_MS,
    });
  });

  it("erlaubt 20 Vorgänge je Konto und UTC-Tag und lehnt den 21. ab", async () => {
    const { d1 } = createDatabase();
    for (let index = 0; index < 20; index += 1) {
      const result = await reserveOSMProductionWrite(d1, {
        ownerHash: owner,
        operationId: nextId(),
        requestHash: hash,
        targetId: `node/${100 + index}`,
        now: now + index,
      });
      expect(result.kind).toBe("reserved");
    }
    const blocked = await reserveOSMProductionWrite(d1, {
      ownerHash: owner,
      operationId: nextId(),
      requestHash: hash,
      targetId: "node/999",
      now: now + 100,
    });
    expect(blocked).toEqual({ kind: "limited", reason: "daily_limit" });
    // Ein anderes Konto ist davon nicht betroffen.
    const other = await reserveOSMProductionWrite(d1, {
      ownerHash: otherOwner,
      operationId: nextId(),
      requestHash: hash,
      targetId: "node/998",
      now: now + 100,
    });
    expect(other.kind).toBe("reserved");
    // Am nächsten UTC-Tag geht es wieder.
    const nextDay = await reserveOSMProductionWrite(d1, {
      ownerHash: owner,
      operationId: nextId(),
      requestHash: hash,
      targetId: "node/997",
      now: now + 24 * 60 * 60 * 1_000,
    });
    expect(nextDay.kind).toBe("reserved");
  });

  it("sperrt dasselbe Objekt 24 Stunden lang, auch für ein anderes Konto", async () => {
    const { d1 } = createDatabase();
    await reserveOSMProductionWrite(d1, {
      ownerHash: owner,
      operationId: nextId(),
      requestHash: hash,
      targetId: "node/5",
      now,
    });
    const sameObject = await reserveOSMProductionWrite(d1, {
      ownerHash: otherOwner,
      operationId: nextId(),
      requestHash: hash,
      targetId: "node/5",
      now: now + 60_000,
    });
    expect(sameObject).toEqual({ kind: "limited", reason: "object_recently_changed" });
    const later = await reserveOSMProductionWrite(d1, {
      ownerHash: otherOwner,
      operationId: nextId(),
      requestHash: hash,
      targetId: "node/5",
      now: now + 24 * 60 * 60 * 1_000 + 1,
    });
    expect(later.kind).toBe("reserved");
  });

  it("zählt Vorgänge mit Konflikt oder Fehler nicht, weil sie nichts geändert haben", async () => {
    const { sqlite, d1 } = createDatabase();
    await reserveOSMProductionWrite(d1, {
      ownerHash: owner,
      operationId: nextId(),
      requestHash: hash,
      targetId: "node/7",
      now,
    });
    sqlite.prepare("UPDATE osm_development_write_operations SET state = 'conflict'").run();
    const retry = await reserveOSMProductionWrite(d1, {
      ownerHash: owner,
      operationId: nextId(),
      requestHash: hash,
      targetId: "node/7",
      now: now + 1,
    });
    expect(retry.kind).toBe("reserved");
  });

  it("gibt bei einer Wiederholung derselben Vorgangs-ID den Vorgang zurück, ohne ihn neu zu zählen", async () => {
    const { sqlite, d1 } = createDatabase();
    const id = nextId();
    await reserveOSMProductionWrite(d1, {
      ownerHash: owner,
      operationId: id,
      requestHash: hash,
      targetId: "node/8",
      now,
    });
    // Die Wiederholung kommt nach einem Netzabbruch, das Objekt ist schon „gesperrt“: Das darf sie nicht aufhalten.
    const replay = await reserveOSMProductionWrite(d1, {
      ownerHash: owner,
      operationId: id,
      requestHash: hash,
      targetId: "node/8",
      now: now + 1,
    });
    expect(replay).toMatchObject({ kind: "reserved", created: false });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM osm_development_write_operations").get()).toEqual({ n: 1 });
  });

  it("lässt den Testserver-Weg unberührt: dessen Vorgänge zählen nicht für das echte OSM", async () => {
    const { sqlite, d1 } = createDatabase();
    for (let index = 0; index < 25; index += 1) {
      await reserveOSMDevelopmentWrite(d1, owner, nextId(), hash, now + index);
    }
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM osm_development_write_operations WHERE osm_environment IS NULL").get(),
    ).toEqual({ n: 25 });
    const production = await reserveOSMProductionWrite(d1, {
      ownerHash: owner,
      operationId: nextId(),
      requestHash: hash,
      targetId: "node/9",
      now: now + 100,
    });
    expect(production.kind).toBe("reserved");
  });

  it("lehnt ein ungültiges Objekt ab, bevor etwas gespeichert wird", async () => {
    const { sqlite, d1 } = createDatabase();
    await expect(
      reserveOSMProductionWrite(d1, {
        ownerHash: owner,
        operationId: nextId(),
        requestHash: hash,
        targetId: "way/1",
        now,
      }),
    ).rejects.toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM osm_development_write_operations").get()).toEqual({ n: 0 });
  });
});
