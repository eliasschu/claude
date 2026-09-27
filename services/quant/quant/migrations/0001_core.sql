-- =============================================================================
-- 0001 Kernschema: Security Master, Datenquellen, Zeitreihen, Point-in-Time-
-- Beobachtungen, Bot-Zyklen, Signal-Audit-Log, Paper Trading, Provider-Health.
--
-- Grundsaetze
--  * Alle Zeitstempel sind timestamptz und werden in UTC geschrieben.
--  * Audit-Tabellen (signals, signal_outcomes, bot_events, paper_fills,
--    observations) sind append-only; UPDATE/DELETE/TRUNCATE werden von
--    Triggern abgewiesen - unabhaengig davon, welcher Code schreibt.
--  * Zeitreihen (bars, observations) sind so geschnitten, dass sie spaeter
--    ohne Schemaaenderung zu TimescaleDB-Hypertables werden koennen
--    (Zeitspalte im Primaerschluessel, keine Fremdschluessel AUF sie).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Hilfsfunktion: Schreibschutz fuer Audit-Tabellen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabelle % ist append-only: % ist nicht erlaubt', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ---------------------------------------------------------------------------
-- Datenquellen und ihre Lizenzlage (§81)
-- ---------------------------------------------------------------------------
CREATE TABLE data_sources (
  source_id              text PRIMARY KEY,
  name                   text NOT NULL,
  homepage               text,
  -- Rangfolge bei Widerspruechen (§54): kleiner = vertrauenswuerdiger
  priority               smallint NOT NULL,
  source_kind            text NOT NULL CHECK (source_kind IN ('regulator','exchange','company_filing','premium_vendor','secondary_vendor','aggregator')),
  license_note           text NOT NULL,
  -- Darf abgeleitete Information oeffentlich angezeigt werden? NULL = ungeprueft.
  display_allowed        boolean,
  redistribution_allowed boolean,
  commercial_use_allowed boolean,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Security Master (§70/71): interne ID ist Primaerschluessel, nie der Ticker
-- ---------------------------------------------------------------------------
CREATE TABLE instruments (
  instrument_id    text PRIMARY KEY CHECK (instrument_id ~ '^ins_[a-z0-9_]+$'),
  asset_class      text NOT NULL CHECK (asset_class IN ('equity','etf','index_proxy','crypto_spot','crypto_perp','crypto_future','fx','rate','commodity')),
  name             text NOT NULL,
  currency         text,
  country          text,
  exchange_mic     text,
  base_asset       text,
  quote_asset      text,
  chain            text,
  contract_address text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Kennungen mit Gueltigkeit: Tickerwechsel, Neulistings, Symbole je Boerse.
CREATE TABLE instrument_identifiers (
  instrument_id text NOT NULL REFERENCES instruments(instrument_id),
  scheme        text NOT NULL CHECK (scheme IN ('ticker','isin','wkn','figi','cik','cusip','exchange_symbol','coingecko_id')),
  value         text NOT NULL,
  -- Fuer exchange_symbol: auf welchem Handelsplatz / bei welcher Quelle
  venue         text NOT NULL DEFAULT '',
  valid_from    date NOT NULL DEFAULT DATE '1900-01-01',
  valid_to      date,
  source_id     text REFERENCES data_sources(source_id),
  PRIMARY KEY (scheme, value, venue, valid_from),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX instrument_identifiers_by_instrument ON instrument_identifiers (instrument_id);

-- ---------------------------------------------------------------------------
-- OHLCV-Balken. Spaeter: SELECT create_hypertable('bars', 'ts');
-- ---------------------------------------------------------------------------
CREATE TABLE bars (
  instrument_id     text NOT NULL,
  source_id         text NOT NULL,
  timeframe         text NOT NULL CHECK (timeframe IN ('1m','5m','15m','1h','4h','1d','1w')),
  -- Beginn des Balkens (UTC)
  ts                timestamptz NOT NULL,
  open              double precision NOT NULL,
  high              double precision NOT NULL,
  low               double precision NOT NULL,
  close             double precision NOT NULL,
  volume            double precision NOT NULL,
  quote_volume      double precision,
  trade_count       integer,
  -- Aggressor-Kaufvolumen (Taker Buy), falls die Quelle es liefert -> CVD
  taker_buy_volume  double precision,
  -- Ist der Balken abgeschlossen? Offene Balken duerfen nie in Features einfliessen.
  is_final          boolean NOT NULL,
  -- Kursbereinigung: 'raw' = unbereinigt, 'split' / 'split_dividend'
  adjustment        text NOT NULL DEFAULT 'raw' CHECK (adjustment IN ('raw','split','split_dividend')),
  received_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_id, source_id, timeframe, adjustment, ts),
  CHECK (high >= low AND high >= open AND high >= close AND low <= open AND low <= close),
  CHECK (volume >= 0)
);
CREATE INDEX bars_latest ON bars (instrument_id, timeframe, ts DESC);

-- ---------------------------------------------------------------------------
-- Point-in-Time-Beobachtungen (§51): alles, was kein Balken ist.
-- Funding, Open Interest, Basis, Makro-Releases, Insider-Transaktionen ...
-- Jede Revision ist eine neue Zeile; nichts wird ueberschrieben.
-- ---------------------------------------------------------------------------
CREATE TABLE observations (
  observation_id  bigint GENERATED ALWAYS AS IDENTITY,
  series_key      text NOT NULL,            -- z. B. 'funding_rate', 'open_interest', 'fred:CPIAUCSL'
  instrument_id   text,                     -- NULL bei marktweiten Reihen (Makro)
  source_id       text NOT NULL,
  event_time      timestamptz NOT NULL,     -- worauf sich der Wert bezieht
  published_time  timestamptz,              -- wann die Quelle ihn veroeffentlicht hat
  received_time   timestamptz NOT NULL DEFAULT now(), -- wann wir ihn erhalten haben
  effective_time  timestamptz NOT NULL,     -- ab wann der Bot ihn kennen durfte
  value           double precision,
  value_json      jsonb,
  unit            text,
  revision        integer NOT NULL DEFAULT 0,
  version         text NOT NULL DEFAULT '1',
  PRIMARY KEY (observation_id, event_time),
  UNIQUE NULLS NOT DISTINCT (series_key, instrument_id, source_id, event_time, revision)
);
CREATE INDEX observations_pit ON observations (series_key, instrument_id, effective_time DESC);
CREATE TRIGGER observations_append_only BEFORE UPDATE OR DELETE ON observations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER observations_no_truncate BEFORE TRUNCATE ON observations
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Bot-Zyklen, Feature- und Regime-Schnappschuesse
-- ---------------------------------------------------------------------------
CREATE TABLE bot_cycles (
  cycle_id       uuid PRIMARY KEY,
  scope          text NOT NULL CHECK (scope IN ('crypto','equity_us')),
  mode           text NOT NULL CHECK (mode IN ('research','paper','live')),
  started_at     timestamptz NOT NULL,
  finished_at    timestamptz,
  status         text NOT NULL CHECK (status IN ('running','completed','failed','halted')),
  universe_size  integer,
  counts         jsonb,
  bot_version    text NOT NULL,
  error          text
);

CREATE TABLE feature_snapshots (
  feature_snapshot_id uuid PRIMARY KEY,
  cycle_id            uuid NOT NULL REFERENCES bot_cycles(cycle_id),
  instrument_id       text NOT NULL REFERENCES instruments(instrument_id),
  as_of               timestamptz NOT NULL,   -- Wissensstand: nur Daten mit effective_time <= as_of
  feature_version     text NOT NULL,
  features            jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feature_snapshots_by_instrument ON feature_snapshots (instrument_id, as_of DESC);
CREATE TRIGGER feature_snapshots_append_only BEFORE UPDATE OR DELETE ON feature_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE regime_snapshots (
  regime_snapshot_id uuid PRIMARY KEY,
  cycle_id           uuid NOT NULL REFERENCES bot_cycles(cycle_id),
  scope              text NOT NULL,
  as_of              timestamptz NOT NULL,
  regime_version     text NOT NULL,
  labels             text[] NOT NULL,
  features           jsonb NOT NULL,
  explanation        text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER regime_snapshots_append_only BEFORE UPDATE OR DELETE ON regime_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Signal-Audit-Log (§59/60): unveraenderlich, mit Hash-Kette
-- ---------------------------------------------------------------------------
CREATE TABLE signals (
  signal_id           uuid PRIMARY KEY,
  seq                 bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_at          timestamptz NOT NULL,
  cycle_id            uuid NOT NULL REFERENCES bot_cycles(cycle_id),
  mode                text NOT NULL CHECK (mode IN ('research','paper','live')),
  instrument_id       text NOT NULL REFERENCES instruments(instrument_id),
  strategy_id         text NOT NULL,
  strategy_version    text NOT NULL,
  direction           text NOT NULL CHECK (direction IN ('long','short','none')),
  decision            text NOT NULL CHECK (decision IN ('LONG_CANDIDATE','SHORT_CANDIDATE','WATCH','NO_TRADE','REJECTED_BY_RISK')),
  signal_strength     numeric(5,2) NOT NULL CHECK (signal_strength BETWEEN 0 AND 100),
  price_at_signal     double precision,
  price_basis         text CHECK (price_basis IN ('bid','ask','mid','last','close')),
  market_regime       jsonb NOT NULL,
  positive_evidence   jsonb NOT NULL,
  negative_evidence   jsonb NOT NULL,
  invalidation        jsonb NOT NULL,
  exit_plan           jsonb NOT NULL,
  risk_assessment     jsonb NOT NULL,
  time_horizon        text NOT NULL CHECK (time_horizon IN ('intraday','swing','position')),
  data_sources        jsonb NOT NULL,
  data_freshness      jsonb NOT NULL,
  feature_snapshot_id uuid REFERENCES feature_snapshots(feature_snapshot_id),
  bot_version         text NOT NULL,
  strategy_registry_version text NOT NULL,
  feature_version     text NOT NULL,
  model_version       text NOT NULL,
  risk_version        text NOT NULL,
  dataset_version     text NOT NULL,
  -- Offenlegung fuer spaetere Veroeffentlichung (Interessenkonflikte, Disclaimer-Version)
  disclosure          jsonb NOT NULL,
  -- sha256 ueber den kanonischen Inhalt + Hash des Vorgaengers (Manipulationsnachweis)
  prev_hash           text,
  content_hash        text NOT NULL UNIQUE,
  CHECK ((decision = 'LONG_CANDIDATE') <= (direction = 'long')),
  CHECK ((decision = 'SHORT_CANDIDATE') <= (direction = 'short'))
);
CREATE INDEX signals_by_instrument ON signals (instrument_id, created_at DESC);
CREATE INDEX signals_by_created ON signals (created_at DESC);
CREATE TRIGGER signals_append_only BEFORE UPDATE OR DELETE ON signals
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER signals_no_truncate BEFORE TRUNCATE ON signals
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Spaetere Aufloesung: je Horizont eine eigene, ebenfalls unveraenderliche Zeile.
CREATE TABLE signal_outcomes (
  outcome_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  signal_id             uuid NOT NULL REFERENCES signals(signal_id),
  horizon               text NOT NULL CHECK (horizon IN ('1h','1d','5d','10d','20d','exit')),
  observed_at           timestamptz NOT NULL,
  price                 double precision NOT NULL,
  return_pct            double precision NOT NULL,
  mfe_pct               double precision,
  mae_pct               double precision,
  benchmark_return_pct  double precision,
  exit_price            double precision,
  result                text CHECK (result IN ('win','loss','flat','open')),
  calc_version          text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_id, horizon)
);
CREATE TRIGGER signal_outcomes_append_only BEFORE UPDATE OR DELETE ON signal_outcomes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER signal_outcomes_no_truncate BEFORE TRUNCATE ON signal_outcomes
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Bot-Ereignisse (Live-Feed) - append-only
-- ---------------------------------------------------------------------------
CREATE TABLE bot_events (
  event_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at     timestamptz NOT NULL,
  cycle_id       uuid REFERENCES bot_cycles(cycle_id),
  event_type     text NOT NULL,
  severity       text NOT NULL CHECK (severity IN ('debug','info','notice','warning','error','critical')),
  instrument_id  text REFERENCES instruments(instrument_id),
  signal_id      uuid REFERENCES signals(signal_id),
  message        text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX bot_events_recent ON bot_events (created_at DESC);
CREATE TRIGGER bot_events_append_only BEFORE UPDATE OR DELETE ON bot_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Paper Trading. Fills sind die Wahrheit (append-only); Positionen sind Zustand.
-- ---------------------------------------------------------------------------
CREATE TABLE paper_accounts (
  account_id     text PRIMARY KEY,
  base_currency  text NOT NULL,
  starting_cash  double precision NOT NULL CHECK (starting_cash > 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE paper_orders (
  order_id       uuid PRIMARY KEY,
  account_id     text NOT NULL REFERENCES paper_accounts(account_id),
  signal_id      uuid REFERENCES signals(signal_id),
  instrument_id  text NOT NULL REFERENCES instruments(instrument_id),
  side           text NOT NULL CHECK (side IN ('buy','sell')),
  intent         text NOT NULL CHECK (intent IN ('open','close')),
  quantity       double precision NOT NULL CHECK (quantity > 0),
  order_type     text NOT NULL CHECK (order_type IN ('market','limit')),
  limit_price    double precision,
  requested_at   timestamptz NOT NULL,
  -- fruehester simulierter Ausfuehrungszeitpunkt (Trading Delay)
  eligible_at    timestamptz NOT NULL,
  -- Orders sind Zustand (pending -> filled/rejected/cancelled); die Wahrheit steht in paper_fills.
  status         text NOT NULL CHECK (status IN ('pending','filled','rejected','cancelled')),
  reject_reason  text,
  reason         text NOT NULL,
  -- geplanter Positionsrahmen, wird beim Oeffnen der Position uebernommen
  stop_price     double precision,
  target_price   double precision,
  time_exit_at   timestamptz,
  position_id    uuid
);
CREATE INDEX paper_orders_pending ON paper_orders (eligible_at) WHERE status = 'pending';

CREATE TABLE paper_fills (
  fill_id         uuid PRIMARY KEY,
  order_id        uuid NOT NULL REFERENCES paper_orders(order_id),
  filled_at       timestamptz NOT NULL,
  quantity        double precision NOT NULL CHECK (quantity > 0),
  price           double precision NOT NULL CHECK (price > 0),
  fee             double precision NOT NULL CHECK (fee >= 0),
  slippage_bps    double precision NOT NULL,
  reference_bid   double precision,
  reference_ask   double precision,
  reference_kind  text NOT NULL CHECK (reference_kind IN ('quote','bar_close_with_spread_model'))
);
CREATE TRIGGER paper_fills_append_only BEFORE UPDATE OR DELETE ON paper_fills
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE paper_positions (
  position_id      uuid PRIMARY KEY,
  account_id       text NOT NULL REFERENCES paper_accounts(account_id),
  instrument_id    text NOT NULL REFERENCES instruments(instrument_id),
  signal_id        uuid REFERENCES signals(signal_id),
  side             text NOT NULL CHECK (side IN ('long','short')),
  quantity         double precision NOT NULL CHECK (quantity > 0),
  entry_price      double precision NOT NULL,
  opened_at        timestamptz NOT NULL,
  stop_price       double precision NOT NULL,
  target_price     double precision,
  time_exit_at     timestamptz,
  closed_at        timestamptz,
  exit_price       double precision,
  exit_reason      text,
  realized_pnl     double precision
);
CREATE UNIQUE INDEX paper_positions_one_open ON paper_positions (account_id, instrument_id) WHERE closed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Provider-Health (§83)
-- ---------------------------------------------------------------------------
CREATE TABLE provider_health (
  check_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id        text NOT NULL,
  checked_at       timestamptz NOT NULL,
  status           text NOT NULL CHECK (status IN ('ok','degraded','down','not_configured')),
  latency_ms       double precision,
  last_data_at     timestamptz,
  clock_skew_ms    double precision,
  message          text
);
CREATE INDEX provider_health_latest ON provider_health (source_id, checked_at DESC);
