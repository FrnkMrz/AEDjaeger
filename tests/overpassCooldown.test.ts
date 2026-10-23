import { describe, expect, it } from "vitest";
import { reserveOverpassSearchSlot } from "../server/storage/overpassCooldown";
import type { D1Database, D1Result, D1Statement } from "../server/storage/d1";

function createDatabase(options: { changes?: number; success?: boolean; runError?: boolean } = {}) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const database: D1Database = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement: D1Statement = {
        bind(...boundValues) { values = boundValues; return statement; },
        async run<T>() {
          calls.push({ query, values });
          if (options.runError) throw new Error("private D1 details");
          return { success: options.success ?? true, meta: { changes: options.changes ?? 1 } } as D1Result<T>;
        },
        async first<T>() { return null as T | null; },
      };
      return statement;
    },
  };
  return { database, calls };
}

describe("Overpass search cooldown", () => {
  it("atomically reserves a 30-second slot without storing coordinates", async () => {
    const { database, calls } = createDatabase();

    await expect(reserveOverpassSearchSlot(database, "osm-user-7", 1_000)).resolves.toBe(true);
    expect(calls[0].query).toContain("INSERT INTO overpass_search_cooldowns");
    expect(calls[0].query).toContain("next_allowed_at <= ?");
    expect(calls[0].values).toEqual(["osm-user-7", 31_000, 1_000]);
  });

  it("rejects concurrent searches until the next slot is available", async () => {
    const { database } = createDatabase({ changes: 0 });
    await expect(reserveOverpassSearchSlot(database, "osm-user-7", 1_000)).resolves.toBe(false);
  });

  it("fails closed when D1 cannot reserve a slot", async () => {
    const { database } = createDatabase({ success: false });
    await expect(reserveOverpassSearchSlot(database, "osm-user-7", 1_000)).rejects.toThrow("nicht sicher vorbereitet");
  });
});
