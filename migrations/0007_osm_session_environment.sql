-- Preserve which OSM issuer authenticated a session; subjects are not globally unique.
ALTER TABLE osm_sessions
  ADD COLUMN osm_environment TEXT NOT NULL DEFAULT 'production'
  CHECK (osm_environment IN ('production', 'development'));
