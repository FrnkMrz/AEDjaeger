import type { D1Database, D1Result } from "./d1";

const MINIMUM_SEARCH_INTERVAL_MS = 30_000;
const MINIMUM_SEARCH_INTERVAL_SECONDS = MINIMUM_SEARCH_INTERVAL_MS / 1_000;

export type OverpassSlotReservation =
  | { reserved: true; nextAllowedAt: number }
  | { reserved: false; retryAfterSeconds: number };

const MAX_UPSTREAM_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;

/**
 * Keep a small per-account cooldown so accidental taps cannot flood the shared
 * public Overpass service. The table stores neither coordinates, search results,
 * nor the raw OSM account subject; the account key is one-way hashed.
 */
export async function reserveOverpassSearchSlot(database: D1Database, userId: string, now: number): Promise<OverpassSlotReservation> {
  if (typeof userId !== "string" || userId.length === 0 || userId.length > 320 || !Number.isSafeInteger(now) || now < 0) {
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
  if ((result.meta?.changes ?? 0) === 1) return { reserved: true, nextAllowedAt: now + MINIMUM_SEARCH_INTERVAL_MS };

  // Read only the existing expiry, keyed by the same one-way hash. This lets the
  // client wait for the actual remaining cooldown instead of always waiting 30 s.
  try {
    const existing = await database
      .prepare("SELECT next_allowed_at FROM overpass_search_cooldowns WHERE osm_subject_hash = ?")
      .bind(subjectHash)
      .first<{ next_allowed_at: number }>();
    if (!existing || !Number.isSafeInteger(existing.next_allowed_at)) {
      return { reserved: false, retryAfterSeconds: 0 };
    }
    return {
      reserved: false,
      retryAfterSeconds: Math.min(MINIMUM_SEARCH_INTERVAL_SECONDS, Math.max(0, Math.ceil((existing.next_allowed_at - now) / 1_000))),
    };
  } catch {
    throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  }
}

/**
 * Overpass limits AEDjaeger's shared server identity, so this cooldown is global
 * across OSM accounts. It stores only one expiry timestamp, never a user or location.
 */
export async function getOverpassUpstreamCooldownSeconds(database: D1Database, now: number): Promise<number> {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  try {
    const row = await database
      .prepare("SELECT next_allowed_at FROM overpass_upstream_cooldown WHERE singleton = 1")
      .first<{ next_allowed_at: number }>();
    if (!row) return 0;
    if (!Number.isSafeInteger(row.next_allowed_at)) throw new Error("Invalid upstream cooldown");
    const remaining = Math.ceil((row.next_allowed_at - now) / 1_000);
    if (remaining <= 0) {
      const cleared = await database
        .prepare("DELETE FROM overpass_upstream_cooldown WHERE singleton = 1 AND next_allowed_at <= ?")
        .bind(now)
        .run();
      if (!cleared.success) throw new Error("Upstream cooldown cleanup failed");
      return 0;
    }
    return Math.min(remaining, MAX_UPSTREAM_COOLDOWN_SECONDS);
  } catch {
    throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  }
}

/** Extend the shared pause without shortening a longer pause already in D1. */
export async function extendOverpassUpstreamCooldown(database: D1Database, now: number, seconds: number): Promise<number> {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > MAX_UPSTREAM_COOLDOWN_SECONDS) {
    throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  }
  try {
    const result = await database
      .prepare(`INSERT INTO overpass_upstream_cooldown (singleton, next_allowed_at)
        VALUES (1, ?)
        ON CONFLICT (singleton) DO UPDATE SET next_allowed_at = MAX(overpass_upstream_cooldown.next_allowed_at, excluded.next_allowed_at)`)
      .bind(now + seconds * 1_000)
      .run();
    if (!result.success) throw new Error("Upstream cooldown write failed");
    return await getOverpassUpstreamCooldownSeconds(database, now);
  } catch {
    throw new Error("Die Umgebungssuche konnte nicht sicher vorbereitet werden.");
  }
}

async function hashSubject(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
