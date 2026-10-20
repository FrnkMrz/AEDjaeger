-- Kurzlebige OSM-Loginvorgänge enthalten nur verschlüsselte PKCE-/OIDC-Daten.
-- State und Browserbindung werden nie im Klartext in D1 gespeichert.
CREATE TABLE osm_oauth_transactions (
  state_hash TEXT PRIMARY KEY,
  browser_binding_hash TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX osm_oauth_transactions_by_expiry
  ON osm_oauth_transactions (expires_at);
