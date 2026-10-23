import type { D1Database, D1Result } from "./d1";

const MINIMUM_SEARCH_INTERVAL_MS = 30_000;

/**
 * Keep a small per-account cooldown so accidental taps cannot flood the shared
 * public Overpass service. The table stores no coordinates or search results.
 */
export async function reserveOverpassSearchSlot(database: D1Database, userId: string, now: number): Promise<boolean> {
  if (typeof userId !== "string" || userId.length === 0 || userId.length > 256 || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  }

  let result: D1Result<unknown>;
  try {
    result = await database
      .prepare(
        `INSERT INTO overpass_search_cooldowns (osm_subject, next_allowed_at)
         VALUES (?, ?)
         ON CONFLICT (osm_subject) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
         WHERE overpass_search_cooldowns.next_allowed_at <= ?`,
      )
      .bind(userId, now + MINIMUM_SEARCH_INTERVAL_MS, now)
      .run();
  } catch {
    throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  }

  if (!result.success) throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  return (result.meta?.changes ?? 0) === 1;
}
