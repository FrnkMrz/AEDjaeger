-- Store only the next permitted lookup time per OSM subject, never location or results.
CREATE TABLE overpass_search_cooldowns (
  osm_subject TEXT PRIMARY KEY,
  next_allowed_at INTEGER NOT NULL
);
