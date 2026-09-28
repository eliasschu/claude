-- =============================================================================
-- 0011 Abrufprotokoll: jeder Datenabruf-Durchlauf des Schedulers (append-only).
-- Grundlage fuer "letzter erfolgreicher Abruf" und die Kennzeichnung veralteter
-- Daten auf der Website - z. B. wenn der Rechner schlief oder offline war.
-- =============================================================================
CREATE TABLE ingest_runs (
  run_id        uuid PRIMARY KEY,
  task          text NOT NULL CHECK (task IN ('sec_insider')),
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz NOT NULL,
  ok            boolean NOT NULL,
  details       jsonb NOT NULL,
  error_summary text,
  CHECK (finished_at >= started_at)
);
CREATE INDEX ingest_runs_recent ON ingest_runs (task, finished_at DESC);
CREATE TRIGGER ingest_runs_append_only BEFORE UPDATE OR DELETE ON ingest_runs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
