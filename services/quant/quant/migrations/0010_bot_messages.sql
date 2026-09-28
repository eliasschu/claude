-- =============================================================================
-- 0010 Bot-Meldungen: unveraenderliches Archiv verstaendlicher Meldungen.
-- detected_at = Bot-Uhr beim ERSTEN Erkennen (nie spaeter ueberschrieben);
-- published_at = fruehester oeffentlicher Zeitpunkt der Quelle (SEC-Annahme);
-- traded_from/to = Handelstage laut Meldung. Die drei Zeiten werden nie vermischt.
-- dedup_key verhindert, dass dieselbe Erkennung zweimal archiviert wird.
-- =============================================================================
ALTER TABLE insider_transactions ADD COLUMN issuer_name text;

CREATE TABLE bot_messages (
  message_id        uuid PRIMARY KEY,
  dedup_key         text NOT NULL UNIQUE,
  kind              text NOT NULL CHECK (kind IN ('insider_cluster','insider_buy','insider_sale')),
  rule_version      text NOT NULL,
  ticker            text,
  issuer_cik        text NOT NULL,
  issuer_name       text,
  title             text NOT NULL,
  relevance         text NOT NULL,
  uncertainty       text NOT NULL,
  counter_arguments jsonb NOT NULL,   -- Liste von Saetzen
  observations      jsonb NOT NULL,   -- zugrunde liegende Einzelangaben aus den Meldungen
  sources           jsonb NOT NULL,   -- [{label, url}]
  selection         text NOT NULL,    -- offengelegter Auswahlgrund
  value_usd         double precision,
  traded_from       date,
  traded_to         date,
  published_at      timestamptz NOT NULL,
  detected_at       timestamptz NOT NULL,
  mode              text NOT NULL CHECK (mode IN ('live','historical')),
  content_hash      text NOT NULL
);
CREATE INDEX bot_messages_recent ON bot_messages (detected_at DESC);
CREATE INDEX bot_messages_by_ticker ON bot_messages (ticker, detected_at DESC);
CREATE TRIGGER bot_messages_append_only BEFORE UPDATE OR DELETE ON bot_messages FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
