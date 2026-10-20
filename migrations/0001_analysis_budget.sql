-- Each accepted analysis reserves its worst-case cost before a provider call.
-- Rows are deliberately small: photos, provider payloads and API credentials
-- never belong in this ledger.
CREATE TABLE analysis_budget_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  cost_micros INTEGER NOT NULL CHECK (cost_micros > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'released')),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, request_id)
);

CREATE INDEX analysis_budget_by_day
  ON analysis_budget_reservations (utc_day, status, cost_micros);

CREATE INDEX analysis_budget_by_user_day
  ON analysis_budget_reservations (user_id, utc_day, status, cost_micros);
