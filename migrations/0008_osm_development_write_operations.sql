-- Keep development-server write attempts idempotent across retries and Worker restarts.
CREATE TABLE osm_development_write_operations (
  session_hash TEXT NOT NULL REFERENCES osm_sessions(session_hash) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('started', 'changeset-created', 'uploading', 'uncertain', 'uploaded', 'complete', 'conflict', 'failed')),
  changeset_id TEXT,
  result_version INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  PRIMARY KEY (session_hash, operation_id)
);

CREATE INDEX osm_development_write_operations_by_expiry
  ON osm_development_write_operations (expires_at);
