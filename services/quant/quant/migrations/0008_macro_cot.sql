-- =============================================================================
-- 0008 Makrodaten mit Vintages (FRED/ALFRED) und CFTC Commitments of Traders.
-- Beide append-only; Revisionen sind neue Zeilen.
-- =============================================================================
CREATE TABLE macro_observations (
  series_id           text NOT NULL,
  observation_period  date NOT NULL,
  value               double precision NOT NULL,
  vintage_date        date NOT NULL,          -- ALFRED realtime_start: ab diesem Tag galt die Fassung
  revision_number     integer NOT NULL,       -- 0 = Erstveroeffentlichung
  release_time        timestamptz GENERATED ALWAYS AS (available_at) STORED,
  available_at        timestamptz NOT NULL,   -- Veroeffentlichung (bekannte Uhrzeit oder konservativ Tagesende NY)
  received_at         timestamptz NOT NULL,
  source              text NOT NULL,
  PRIMARY KEY (series_id, observation_period, vintage_date)
);
CREATE INDEX macro_pit ON macro_observations (series_id, available_at);
CREATE TRIGGER macro_observations_append_only BEFORE UPDATE OR DELETE ON macro_observations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE cot_reports (
  report_type      text NOT NULL CHECK (report_type IN ('legacy','disaggregated','tff')),
  contract_code    text NOT NULL,
  market_name      text NOT NULL,
  report_date      date NOT NULL,           -- Stichtag (Dienstag)
  revision         integer NOT NULL DEFAULT 0,
  open_interest    double precision,
  categories       jsonb NOT NULL,          -- {kategorie: {long, short, spread}}
  raw              jsonb NOT NULL,
  available_at     timestamptz NOT NULL,
  received_at      timestamptz NOT NULL,
  PRIMARY KEY (report_type, contract_code, report_date, revision)
);
CREATE INDEX cot_pit ON cot_reports (contract_code, report_type, available_at);
CREATE TRIGGER cot_reports_append_only BEFORE UPDATE OR DELETE ON cot_reports FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
