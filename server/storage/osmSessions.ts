import type { OSMEnvironment } from "../auth/osmProvider";
import type { D1Database } from "./d1";

export const OSM_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;

type StoredOSMSession = { osm_subject: string; osm_environment: OSMEnvironment };

/** Speichert nur einen Hash des Browser-Cookies sowie OSM-Kennung und Anbieterumgebung. */
export async function createOSMSession(
  database: D1Database,
  sessionToken: string,
  osmSubject: string,
  now: number,
  osmEnvironment: OSMEnvironment = "production",
  cryptoApi: Crypto = crypto,
): Promise<void> {
  if (!isSecret(sessionToken) || !isSubject(osmSubject) || !isOSMEnvironment(osmEnvironment) || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("Ungültige OSM-Sitzung.");
  }

  try {
    const sessionHash = await sha256Hex(sessionToken, cryptoApi);
    const cleanup = await database.prepare("DELETE FROM osm_sessions WHERE expires_at <= ?").bind(now).run();
    if (!cleanup.success) throw new Error("D1 cleanup failed");
    const result = await database
      .prepare("INSERT INTO osm_sessions (session_hash, osm_subject, osm_environment, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(sessionHash, osmSubject, osmEnvironment, now, now + OSM_SESSION_LIFETIME_MS)
      .run();
    if (!result.success || result.meta?.changes !== 1) throw new Error("D1 insert failed");
  } catch {
    throw new Error("Die OSM-Sitzung konnte nicht sicher angelegt werden.");
  }
}

export async function findOSMSession(
  database: D1Database,
  sessionToken: string,
  now: number,
  cryptoApi: Crypto = crypto,
): Promise<{ subject: string; environment: OSMEnvironment } | null> {
  if (!isSecret(sessionToken) || !Number.isSafeInteger(now) || now < 0) return null;

  try {
    const sessionHash = await sha256Hex(sessionToken, cryptoApi);
    const session = await database
      .prepare("SELECT osm_subject, osm_environment FROM osm_sessions WHERE session_hash = ? AND expires_at > ?")
      .bind(sessionHash, now)
      .first<StoredOSMSession>();
    return session && isSubject(session.osm_subject) && isOSMEnvironment(session.osm_environment)
      ? { subject: session.osm_subject, environment: session.osm_environment }
      : null;
  } catch {
    throw new Error("Die OSM-Sitzung konnte nicht geprüft werden.");
  }
}

export async function deleteOSMSession(
  database: D1Database,
  sessionToken: string,
  cryptoApi: Crypto = crypto,
): Promise<void> {
  if (!isSecret(sessionToken)) return;
  try {
    const sessionHash = await sha256Hex(sessionToken, cryptoApi);
    const result = await database.prepare("DELETE FROM osm_sessions WHERE session_hash = ?").bind(sessionHash).run();
    if (!result.success) throw new Error("D1 delete failed");
  } catch {
    throw new Error("Die OSM-Sitzung konnte nicht beendet werden.");
  }
}

/** Widerruft eine vorhandene Sitzung, bevor ein neues Cookie ausgegeben wird. */
export async function rotateOSMSession(
  database: D1Database,
  previousToken: string | null,
  nextToken: string,
  osmSubject: string,
  now: number,
  osmEnvironment: OSMEnvironment = "production",
  cryptoApi: Crypto = crypto,
): Promise<void> {
  if (previousToken === nextToken) throw new Error("Ungültige OSM-Sitzungsrotation.");
  if (previousToken) await deleteOSMSession(database, previousToken, cryptoApi);
  await createOSMSession(database, nextToken, osmSubject, now, osmEnvironment, cryptoApi);
}

function isOSMEnvironment(value: unknown): value is OSMEnvironment {
  return value === "production" || value === "development";
}

function isSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function isSubject(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255;
}

async function sha256Hex(value: string, cryptoApi: Crypto): Promise<string> {
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
