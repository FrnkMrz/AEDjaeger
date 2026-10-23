-- These short-lived reservations contain no durable user data; replace raw OSM IDs
-- with one-way account hashes and discard any reservations created by older builds.
DROP TABLE overpass_search_cooldowns;

CREATE TABLE overpass_search_cooldowns (
  osm_subject_hash TEXT PRIMARY KEY,
  next_allowed_at INTEGER NOT NULL
);
