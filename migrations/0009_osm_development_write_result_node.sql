-- Store the OSM ID returned for development-server node creation.
ALTER TABLE osm_development_write_operations ADD COLUMN result_node_id TEXT;
