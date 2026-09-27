-- =============================================================================
-- 0005 Heartbeats der Dienste (Zustand, veraenderlich) fuer Health Checks.
-- =============================================================================
CREATE TABLE service_heartbeats (
  service      text NOT NULL,            -- bot-worker | scheduler | api | ws-ingestor
  instance_id  text NOT NULL,            -- Hostname/Container
  started_at   timestamptz NOT NULL,
  last_beat    timestamptz NOT NULL,
  status       text NOT NULL CHECK (status IN ('HEALTHY','DEGRADED','UNHEALTHY')),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics      jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (service, instance_id)
);
