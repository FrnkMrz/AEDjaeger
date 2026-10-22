-- Sitzungen speichern keinen verwendbaren Cookie, sondern nur dessen SHA-256-Hash.
CREATE TABLE osm_sessions (
  session_hash TEXT PRIMARY KEY,
  osm_subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX osm_sessions_by_expiry ON osm_sessions (expires_at);
