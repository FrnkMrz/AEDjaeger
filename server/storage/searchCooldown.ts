import type { D1Database, D1Result } from "./d1";

const SEARCH_INTERVAL_MS = 30_000;
const SEARCH_INTERVAL_SECONDS = SEARCH_INTERVAL_MS / 1_000;

export type SearchSlotReservation =
  | { reserved: true; nextAllowedAt: number }
  | { reserved: false; retryAfterSeconds: number };

/**
 * Limit repeated searches by the same OSM account. The legacy D1 table name is
 * retained to avoid a destructive migration; it contains only a hashed subject
 * and expiry, not the chosen search provider or location.
 *
 * Historisch: Der Tabellenname stammt aus der früheren Overpass-Suche. Heute drosselt
 * die Tabelle die PMTiles-Umgebungssuche je OSM-Konto und Umgebung (Dev/Produktion).
 */
export async function reserveSearchSlot(database: D1Database, userId: string, now: number): Promise<SearchSlotReservation> {
  if (!userId || userId.length > 320 || !Number.isSafeInteger(now) || now < 0) throw new Error("Search cooldown cannot be prepared safely.");
  const hash = await hashSubject(userId);
  const cleanup = await database.prepare("DELETE FROM overpass_search_cooldowns WHERE next_allowed_at <= ?").bind(now).run();
  if (!cleanup.success) throw new Error("Search cooldown cleanup failed");
  const result: D1Result<unknown> = await database.prepare(
    `INSERT INTO overpass_search_cooldowns (osm_subject_hash, next_allowed_at)
     VALUES (?, ?)
     ON CONFLICT (osm_subject_hash) DO UPDATE SET next_allowed_at = excluded.next_allowed_at
     WHERE overpass_search_cooldowns.next_allowed_at <= ?`,
  ).bind(hash, now + SEARCH_INTERVAL_MS, now).run();
  if (!result.success) throw new Error("Search cooldown reservation failed");
  if ((result.meta?.changes ?? 0) === 1) return { reserved: true, nextAllowedAt: now + SEARCH_INTERVAL_MS };
  const existing = await database.prepare("SELECT next_allowed_at FROM overpass_search_cooldowns WHERE osm_subject_hash = ?")
    .bind(hash).first<{ next_allowed_at: number }>();
  if (!existing || !Number.isSafeInteger(existing.next_allowed_at)) return { reserved: false, retryAfterSeconds: 0 };
  return { reserved: false, retryAfterSeconds: Math.min(SEARCH_INTERVAL_SECONDS, Math.max(0, Math.ceil((existing.next_allowed_at - now) / 1_000))) };
}

async function hashSubject(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
