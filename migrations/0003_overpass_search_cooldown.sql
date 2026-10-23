-- Store only the next permitted lookup time, never the user's location or results.
CREATE TABLE overpass_search_cooldowns (
  osm_subject TEXT PRIMARY KEY,
  next_allowed_at INTEGER NOT NULL
);
