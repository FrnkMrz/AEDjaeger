-- Etappe Q3 (Schreiben ins echte OSM, Entscheidung vom 26.11.2026).
-- Rein additiv: zwei neue, leere Spalten und zwei Indizes. Bestehende Zeilen (Testserver) bleiben unverändert;
-- der Testserver-Schreibweg nutzt die Spalten nicht.
--   osm_environment: 'production' für Vorgänge am echten OSM, sonst NULL.
--   target_id:       das geänderte Objekt (z. B. 'node/123'), nur bei 'production'. Damit prüft der Worker die Regel
--                    „höchstens 5 Änderungen je Objekt in 24 Stunden“. Keine Koordinaten, keine Kontodaten.
ALTER TABLE osm_development_write_operations ADD COLUMN osm_environment TEXT
  CHECK (osm_environment IS NULL OR osm_environment = 'production');
ALTER TABLE osm_development_write_operations ADD COLUMN target_id TEXT;

-- Tageslimit je Konto: Zählt die Vorgänge eines Kontos seit Mitternacht UTC.
CREATE INDEX osm_development_write_operations_by_owner_time
  ON osm_development_write_operations (owner_hash, created_at);
-- Limit je Objekt: Findet frühere Vorgänge am selben Objekt.
CREATE INDEX osm_development_write_operations_by_target_time
  ON osm_development_write_operations (osm_environment, target_id, created_at);
