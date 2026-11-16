-- The cooldown is shared by the static PMTiles search and the authenticated Dev map check.
-- Keep current hashed subjects and expiry times while removing the obsolete Overpass name.
ALTER TABLE overpass_search_cooldowns RENAME TO static_search_cooldowns;
