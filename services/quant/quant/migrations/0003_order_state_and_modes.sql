-- =============================================================================
-- 0003 Zeitkorrektheit, Order-Zustaende, Betriebsart "backtest"
-- =============================================================================

-- Fix C: Der Wissenszeitpunkt MUSS von der Bot-/Simulationsuhr kommen.
-- Ohne Standardwert scheitert jeder Insert, der ihn vergisst, laut - statt still die DB-Uhr zu nehmen.
ALTER TABLE bars ALTER COLUMN received_at DROP DEFAULT;
ALTER TABLE observations ALTER COLUMN received_time DROP DEFAULT;

-- Backtests schreiben in eigene Datenbanken, aber mit demselben Schema und Kern.
ALTER TABLE signals DROP CONSTRAINT signals_mode_check;
ALTER TABLE signals ADD CONSTRAINT signals_mode_check CHECK (mode IN ('research','paper','live','backtest'));
ALTER TABLE bot_cycles DROP CONSTRAINT bot_cycles_mode_check;
ALTER TABLE bot_cycles ADD CONSTRAINT bot_cycles_mode_check CHECK (mode IN ('research','paper','live','backtest'));

-- Fix E (Defense in Depth, Ebene 4 - Datenbank):
-- Teilausfuehrungen als eigener Zustand; reservierte Menge = quantity - filled_quantity.
ALTER TABLE paper_orders DROP CONSTRAINT paper_orders_status_check;
ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_status_check
  CHECK (status IN ('pending','partially_filled','filled','rejected','cancelled'));
ALTER TABLE paper_orders ADD COLUMN filled_quantity double precision NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0);
ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_fill_le_qty CHECK (filled_quantity <= quantity * (1 + 1e-9));

-- Hoechstens EINE aktive Einstiegsorder je Konto und Instrument.
CREATE UNIQUE INDEX paper_orders_one_active_entry ON paper_orders (account_id, instrument_id)
  WHERE intent = 'open' AND status IN ('pending','partially_filled');

-- Keine neue Einstiegsorder, solange eine Position in diesem Instrument offen ist (tabellenuebergreifend).
CREATE OR REPLACE FUNCTION forbid_entry_while_position_open() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.intent = 'open' AND EXISTS (
       SELECT 1 FROM paper_positions p
       WHERE p.account_id = NEW.account_id AND p.instrument_id = NEW.instrument_id AND p.closed_at IS NULL) THEN
    RAISE EXCEPTION 'Einstieg abgewiesen: offene Position in % existiert bereits', NEW.instrument_id
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER paper_orders_no_entry_while_open BEFORE INSERT ON paper_orders
  FOR EACH ROW EXECUTE FUNCTION forbid_entry_while_position_open();
