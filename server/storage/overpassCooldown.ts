import type { D1Database, D1Result } from "./d1";

const MINIMUM_SEARCH_INTERVAL_MS = 30_000;

/**
 * Keep a small per-account cooldown so accidental taps cannot flood the shared
 * public Overpass service. The table stores neither coordinates, search results,
 * nor the raw OSM account subject; the account key is one-way hashed.
 */
export async function reserveOverpassSearchSlot(database: D1Database, userId: string, now: number): Promise<boolean> {
  if (typeof userId !== "string" || userId.length === 0 || userId.length > 256 || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  }

  const subjectHash = await hashSubject(userId);
  try {
    const cleanup = await database
      .prepare("DELETE FROM overpass_search_cooldowns WHERE next_allowed_at <= ?")
      .bind(now)
      .run();
    if (!cleanup.success) throw new Error("D1 cooldown cleanup failed");
  } catch {
    throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  }

  let result: D1Result<unknown>;
  try {
    result = await database
      .prepare(
        `INSERT INTO overpass_search_cooldowns (osm_subject_hash, next_allowed_at)
         VALUES (?, ?)
         ON CONFLICT (osm_subject_hash) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
         WHERE overpass_search_cooldowns.next_allowed_at <= ?`,
      )
      .bind(subjectHash, now + MINIMUM_SEARCH_INTERVAL_MS, now)
      .run();
  } catch {
    throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  }

  if (!result.success) throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  return (result.meta?.changes ?? 0) === 1;
}

async function hashSubject(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
