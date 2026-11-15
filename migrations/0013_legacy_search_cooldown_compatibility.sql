-- Migration 0012 renamed this table before the Worker rollout. Keep the old name
-- available while Cloudflare may still serve an older Worker version.
CREATE TABLE overpass_search_cooldowns (
  osm_subject_hash TEXT PRIMARY KEY,
  next_allowed_at INTEGER NOT NULL
);

INSERT INTO overpass_search_cooldowns (osm_subject_hash, next_allowed_at)
SELECT osm_subject_hash, next_allowed_at
FROM static_search_cooldowns;

-- Mirror successful reservations in either Worker version. Equality guards stop
-- the paired trigger from writing the same value back and recursing indefinitely.
CREATE TRIGGER static_cooldown_mirror_insert_to_legacy
AFTER INSERT ON static_search_cooldowns
WHEN NOT EXISTS (
  SELECT 1 FROM overpass_search_cooldowns
  WHERE osm_subject_hash = NEW.osm_subject_hash
    AND next_allowed_at = NEW.next_allowed_at
)
BEGIN
  INSERT INTO overpass_search_cooldowns (osm_subject_hash, next_allowed_at)
  VALUES (NEW.osm_subject_hash, NEW.next_allowed_at)
  ON CONFLICT (osm_subject_hash) DO UPDATE SET next_allowed_at = excluded.next_allowed_at;
END;

CREATE TRIGGER static_cooldown_mirror_update_to_legacy
AFTER UPDATE OF next_allowed_at ON static_search_cooldowns
WHEN NOT EXISTS (
  SELECT 1 FROM overpass_search_cooldowns
  WHERE osm_subject_hash = NEW.osm_subject_hash
    AND next_allowed_at = NEW.next_allowed_at
)
BEGIN
  INSERT INTO overpass_search_cooldowns (osm_subject_hash, next_allowed_at)
  VALUES (NEW.osm_subject_hash, NEW.next_allowed_at)
  ON CONFLICT (osm_subject_hash) DO UPDATE SET next_allowed_at = excluded.next_allowed_at;
END;

CREATE TRIGGER legacy_cooldown_mirror_insert_to_static
AFTER INSERT ON overpass_search_cooldowns
WHEN NOT EXISTS (
  SELECT 1 FROM static_search_cooldowns
  WHERE osm_subject_hash = NEW.osm_subject_hash
    AND next_allowed_at = NEW.next_allowed_at
)
BEGIN
  INSERT INTO static_search_cooldowns (osm_subject_hash, next_allowed_at)
  VALUES (NEW.osm_subject_hash, NEW.next_allowed_at)
  ON CONFLICT (osm_subject_hash) DO UPDATE SET next_allowed_at = excluded.next_allowed_at;
END;

CREATE TRIGGER legacy_cooldown_mirror_update_to_static
AFTER UPDATE OF next_allowed_at ON overpass_search_cooldowns
WHEN NOT EXISTS (
  SELECT 1 FROM static_search_cooldowns
  WHERE osm_subject_hash = NEW.osm_subject_hash
    AND next_allowed_at = NEW.next_allowed_at
)
BEGIN
  INSERT INTO static_search_cooldowns (osm_subject_hash, next_allowed_at)
  VALUES (NEW.osm_subject_hash, NEW.next_allowed_at)
  ON CONFLICT (osm_subject_hash) DO UPDATE SET next_allowed_at = excluded.next_allowed_at;
END;

CREATE TRIGGER static_cooldown_mirror_delete_to_legacy
AFTER DELETE ON static_search_cooldowns
WHEN EXISTS (
  SELECT 1 FROM overpass_search_cooldowns
  WHERE osm_subject_hash = OLD.osm_subject_hash
    AND next_allowed_at = OLD.next_allowed_at
)
BEGIN
  DELETE FROM overpass_search_cooldowns
  WHERE osm_subject_hash = OLD.osm_subject_hash
    AND next_allowed_at = OLD.next_allowed_at;
END;

CREATE TRIGGER legacy_cooldown_mirror_delete_to_static
AFTER DELETE ON overpass_search_cooldowns
WHEN EXISTS (
  SELECT 1 FROM static_search_cooldowns
  WHERE osm_subject_hash = OLD.osm_subject_hash
    AND next_allowed_at = OLD.next_allowed_at
)
BEGIN
  DELETE FROM static_search_cooldowns
  WHERE osm_subject_hash = OLD.osm_subject_hash
    AND next_allowed_at = OLD.next_allowed_at;
END;
