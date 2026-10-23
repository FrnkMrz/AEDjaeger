-- A reservation can be resumed after an ambiguous insert response only until
-- an atomic claim marks that the external provider call is about to begin.
ALTER TABLE analysis_budget_reservations
  ADD COLUMN provider_started_at INTEGER;
