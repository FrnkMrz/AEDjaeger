-- OSM-Testzugriffstokens bleiben an eine aktive App-Sitzung gebunden und werden verschlüsselt abgelegt.
CREATE TABLE osm_development_tokens (
  session_hash TEXT PRIMARY KEY REFERENCES osm_sessions(session_hash) ON DELETE CASCADE,
  token_iv TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL CHECK (token_expires_at > 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

CREATE INDEX osm_development_tokens_by_expiry ON osm_development_tokens (token_expires_at);
