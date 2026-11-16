-- Keep the historical name until no deployed Worker version queries it.
-- This reverses migration 0012 without losing the existing account hashes or expiries.
ALTER TABLE static_search_cooldowns RENAME TO overpass_search_cooldowns;
