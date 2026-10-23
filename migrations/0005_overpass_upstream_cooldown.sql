-- An Overpass Retry-After applies to AEDjaeger's shared upstream client, not one OSM account.
CREATE TABLE IF NOT EXISTS overpass_upstream_cooldown (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  next_allowed_at INTEGER NOT NULL CHECK (next_allowed_at >= 0)
);
