-- The encrypted, session-bound token is used for both OSM issuers so logout
-- can revoke it regardless of which login environment created the session.
ALTER TABLE osm_development_tokens RENAME TO osm_oauth_tokens;
DROP INDEX osm_development_tokens_by_expiry;
CREATE INDEX osm_oauth_tokens_by_expiry ON osm_oauth_tokens (token_expires_at);
