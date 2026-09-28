-- =============================================================================
-- 0013 Handelsplan (Rule 10b5-1) mit vier Zustaenden statt ja/nein.
-- Bisher wurde eine FEHLENDE Angabe als "kein Plan" (false) gespeichert. Diese
-- Zeilen werden nicht ueberschrieben (append-only); plan_status bleibt dort NULL
-- und bedeutet "nicht sicher erfasst". plan_10b5_1 = true war immer belegt.
-- =============================================================================
ALTER TABLE insider_transactions ADD COLUMN plan_status text
  CHECK (plan_status IN ('confirmed','denied','unknown','not_applicable'));
