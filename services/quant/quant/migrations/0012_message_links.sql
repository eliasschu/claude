-- =============================================================================
-- 0012 Meldungen: Eingang beim Bot, Aussagekraft, Berichtigung; Verknuepfungen.
-- Aeltere Zeilen behalten NULL fuer received_at/materiality - ein Nachtragen wuerde
-- das Archiv veraendern. Verknuepfungen sind ebenfalls nur anhaengend.
-- =============================================================================
ALTER TABLE bot_messages ADD COLUMN received_at timestamptz;
ALTER TABLE bot_messages ADD COLUMN materiality text CHECK (materiality IN ('hoch','mittel'));
ALTER TABLE bot_messages ADD COLUMN amendment boolean NOT NULL DEFAULT false;
CREATE INDEX bot_messages_filter ON bot_messages (kind, materiality, detected_at DESC);

CREATE TABLE bot_message_links (
  from_id    uuid NOT NULL REFERENCES bot_messages(message_id),
  to_id      uuid NOT NULL REFERENCES bot_messages(message_id),
  relation   text NOT NULL CHECK (relation IN ('berichtigt','erweitert','fasst_zusammen')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (from_id, to_id, relation),
  CHECK (from_id <> to_id)
);
CREATE INDEX bot_message_links_to ON bot_message_links (to_id);
CREATE TRIGGER bot_message_links_append_only BEFORE UPDATE OR DELETE ON bot_message_links FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
