-- =============================================================================
-- 0004 Shadow Execution: geplante Order + hypothetische Ausfuehrung fuer JEDE
-- Handelsidee (auch von der Risk Engine abgelehnte). Beeinflusst das
-- Paper-Konto nicht. Beides unveraenderlich.
-- =============================================================================
CREATE TABLE shadow_executions (
  shadow_id            uuid PRIMARY KEY,
  signal_id            uuid NOT NULL UNIQUE REFERENCES signals(signal_id),
  created_at           timestamptz NOT NULL,
  instrument_id        text NOT NULL REFERENCES instruments(instrument_id),
  strategy_id          text NOT NULL,
  direction            text NOT NULL CHECK (direction IN ('long','short')),
  score                numeric(5,2) NOT NULL,
  -- Kalibrierte Konfidenz existiert noch nicht (kein Out-of-Sample-Modell) - bewusst NULL
  confidence           double precision,
  confidence_status    text NOT NULL DEFAULT 'not_calibrated',
  feature_snapshot_id  uuid REFERENCES feature_snapshots(feature_snapshot_id),
  planned_side         text NOT NULL CHECK (planned_side IN ('buy','sell')),
  planned_order_type   text NOT NULL,
  planned_reference    double precision NOT NULL,
  planned_stop         double precision NOT NULL,
  planned_target       double precision,
  planned_time_exit    timestamptz,
  planned_quantity     double precision,
  planned_notional     double precision,
  eligible_at          timestamptz NOT NULL,
  risk_approved        boolean NOT NULL,
  rejection_reasons    jsonb NOT NULL,
  execution_model      jsonb NOT NULL,
  timeframe            text NOT NULL
);
CREATE TRIGGER shadow_executions_append_only BEFORE UPDATE OR DELETE ON shadow_executions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE shadow_outcomes (
  shadow_id         uuid PRIMARY KEY REFERENCES shadow_executions(shadow_id),
  resolved_at       timestamptz NOT NULL,
  entry_time        timestamptz,
  entry_price       double precision,
  entry_fee         double precision,
  entry_slippage_bps double precision,
  exit_time         timestamptz,
  exit_price        double precision,
  exit_fee          double precision,
  exit_reason       text CHECK (exit_reason IN ('stop','target','time','no_entry')),
  gap               boolean,
  quantity          double precision,
  pnl               double precision,
  pnl_pct           double precision,
  mfe_pct           double precision,
  mae_pct           double precision,
  calc_version      text NOT NULL
);
CREATE TRIGGER shadow_outcomes_append_only BEFORE UPDATE OR DELETE ON shadow_outcomes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
