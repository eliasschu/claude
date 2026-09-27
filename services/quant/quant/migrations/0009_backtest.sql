-- =============================================================================
-- 0009 Backtest-Metadaten und erweiterte Ergebnishorizonte.
-- =============================================================================
ALTER TABLE signal_outcomes DROP CONSTRAINT signal_outcomes_horizon_check;
ALTER TABLE signal_outcomes ADD CONSTRAINT signal_outcomes_horizon_check
  CHECK (horizon IN ('1h','4h','1d','3d','5d','7d','10d','20d','30d','exit'));

-- Ein Backtest laeuft in einer EIGENEN Datenbank mit identischem Schema; diese Tabelle beschreibt den Lauf.
CREATE TABLE backtest_runs (
  run_id            uuid PRIMARY KEY,
  created_at        timestamptz NOT NULL,
  finished_at       timestamptz,
  status            text NOT NULL CHECK (status IN ('running','completed','failed')),
  config            jsonb NOT NULL,
  dataset           jsonb NOT NULL,
  bot_version       text NOT NULL,
  registry_version  text NOT NULL,
  feature_version   text NOT NULL,
  risk_version      text NOT NULL,
  report            jsonb,
  error             text
);
