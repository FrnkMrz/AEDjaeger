-- Keep write outcomes for seven days after the browser session changes. The
-- Worker replaces each legacy session partition with a keyed account hash.
ALTER TABLE osm_development_write_operations RENAME TO osm_development_write_operations_legacy;
DROP INDEX osm_development_write_operations_by_expiry;

CREATE TABLE osm_development_write_operations (
  owner_hash TEXT NOT NULL CHECK (length(owner_hash) = 64),
  legacy_session_hash TEXT,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('started', 'changeset-created', 'uploading', 'uncertain', 'uploaded', 'complete', 'conflict', 'failed')),
  changeset_id TEXT,
  result_version INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  result_node_id TEXT,
  PRIMARY KEY (owner_hash, operation_id)
);

-- Existing rows start in a temporary session partition. Session rotation/logout
-- re-key them to the HMAC of the matching OSM account before removing the session.
INSERT INTO osm_development_write_operations
  (owner_hash, legacy_session_hash, operation_id, request_hash, state, changeset_id, result_version, created_at, updated_at, expires_at, result_node_id)
SELECT session_hash, session_hash, operation_id, request_hash, state, changeset_id, result_version, created_at, updated_at, expires_at, result_node_id
FROM osm_development_write_operations_legacy;

DROP TABLE osm_development_write_operations_legacy;
CREATE INDEX osm_development_write_operations_by_expiry
  ON osm_development_write_operations (expires_at);
