import { describe, expect, it } from "vitest";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";
import { createOSMSession, deleteOSMSession, findOSMSession, OSM_SESSION_LIFETIME_MS, rotateOSMSession } from "../server/storage/osmSessions";

function createSessionDatabase() {
  const rows = new Map<string, { osm_subject: string; created_at: number; expires_at: number }>();
  const database: D1Database = {
    prepare(query: string): D1Statement {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) { values = bound; return this; },
        async run<T>() {
          if (query.includes("DELETE FROM osm_sessions WHERE expires_at")) {
            for (const [key, value] of rows) if (value.expires_at <= Number(values[0])) rows.delete(key);
            return { success: true, meta: { changes: 1 } } as D1Result<T>;
          }
          if (query.startsWith("INSERT INTO osm_sessions")) {
            rows.set(String(values[0]), { osm_subject: String(values[1]), created_at: Number(values[2]), expires_at: Number(values[3]) });
            return { success: true, meta: { changes: 1 } } as D1Result<T>;
          }
          if (query.includes("DELETE FROM osm_sessions WHERE session_hash")) {
            const deleted = rows.delete(String(values[0]));
            return { success: true, meta: { changes: Number(deleted) } } as D1Result<T>;
          }
          throw new Error(`Unexpected D1 query: ${query}`);
        },
        async first<T>() {
          const row = rows.get(String(values[0]));
          return row && row.expires_at > Number(values[1]) ? { osm_subject: row.osm_subject } as T : null;
        },
      };
    },
  };
  return { database, rows };
}

describe("OSM session storage", () => {
  it("stores only a hash of the browser token and enforces the server-side expiry", async () => {
    const { database, rows } = createSessionDatabase();
    const token = "a".repeat(43);
    const now = 1_800_000_000_000;

    await createOSMSession(database, token, "osm-user-42", now);
    const [storedHash, row] = [...rows.entries()][0];
    expect(storedHash).not.toBe(token);
    expect(row).toEqual({ osm_subject: "osm-user-42", created_at: now, expires_at: now + OSM_SESSION_LIFETIME_MS });
    await expect(findOSMSession(database, token, now + 1)).resolves.toEqual({ subject: "osm-user-42" });
    await expect(findOSMSession(database, token, now + OSM_SESSION_LIFETIME_MS)).resolves.toBeNull();
  });

  it("revokes a valid session without storing or returning the raw token", async () => {
    const { database, rows } = createSessionDatabase();
    const token = "b".repeat(43);
    await createOSMSession(database, token, "osm-user-42", 1_800_000_000_000);

    await deleteOSMSession(database, token);
    expect(rows.size).toBe(0);
    await expect(findOSMSession(database, token, 1_800_000_000_001)).resolves.toBeNull();
  });

  it("revokes the previous browser session before storing its replacement", async () => {
    const { database, rows } = createSessionDatabase();
    const oldToken = "c".repeat(43);
    const newToken = "d".repeat(43);
    const now = 1_800_000_000_000;
    await createOSMSession(database, oldToken, "old-osm-user", now - 1);

    await rotateOSMSession(database, oldToken, newToken, "new-osm-user", now);

    expect(rows.size).toBe(1);
    await expect(findOSMSession(database, oldToken, now)).resolves.toBeNull();
    await expect(findOSMSession(database, newToken, now)).resolves.toEqual({ subject: "new-osm-user" });
  });

  it("rejects malformed tokens and subjects before database access", async () => {
    const database: D1Database = { prepare: () => { throw new Error("database should not be used"); } };
    await expect(createOSMSession(database, "short", "subject", 1)).rejects.toThrow("Ungültige");
    await expect(findOSMSession(database, "short", 1)).resolves.toBeNull();
    await expect(createOSMSession(database, "a".repeat(43), "", 1)).rejects.toThrow("Ungültige");
  });
});
