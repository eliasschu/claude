-- =============================================================================
-- 0006 WebSocket-Marktdaten als Sekundenzeilen (Point-in-Time ueber received_at).
-- Spaeter: create_hypertable auf ts (Zeitspalte im Primaerschluessel).
-- Alle append-only: ein einmal gespeicherter Sekundenwert wird nie umgeschrieben.
-- =============================================================================
CREATE TABLE trade_flow_1s (
  instrument_id      text NOT NULL,
  source_id          text NOT NULL,
  ts                 timestamptz NOT NULL,   -- Sekundenbeginn (Boersenzeit der Trades)
  buy_qty            double precision NOT NULL CHECK (buy_qty >= 0),
  sell_qty           double precision NOT NULL CHECK (sell_qty >= 0),
  buy_notional       double precision NOT NULL CHECK (buy_notional >= 0),
  sell_notional      double precision NOT NULL CHECK (sell_notional >= 0),
  trades             integer NOT NULL CHECK (trades >= 0),
  last_price         double precision,
  max_trade_notional double precision NOT NULL,
  received_at        timestamptz NOT NULL,   -- ab dann kannte der Bot die abgeschlossene Sekunde
  PRIMARY KEY (instrument_id, source_id, ts)
);
CREATE INDEX trade_flow_1s_pit ON trade_flow_1s (instrument_id, received_at DESC);
CREATE TRIGGER trade_flow_1s_append_only BEFORE UPDATE OR DELETE ON trade_flow_1s FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE orderbook_1s (
  instrument_id    text NOT NULL,
  source_id        text NOT NULL,
  ts               timestamptz NOT NULL,
  best_bid         double precision NOT NULL,
  best_ask         double precision NOT NULL,
  spread_bps       double precision NOT NULL,
  depth_bid_10bps  double precision NOT NULL,
  depth_ask_10bps  double precision NOT NULL,
  imbalance_10bps  double precision NOT NULL,
  last_update_id   bigint NOT NULL,
  exchange_time    timestamptz,
  received_at      timestamptz NOT NULL,
  PRIMARY KEY (instrument_id, source_id, ts),
  CHECK (best_ask > best_bid)
);
CREATE INDEX orderbook_1s_pit ON orderbook_1s (instrument_id, received_at DESC);
CREATE TRIGGER orderbook_1s_append_only BEFORE UPDATE OR DELETE ON orderbook_1s FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE liquidations (
  liquidation_id  bigint GENERATED ALWAYS AS IDENTITY,
  instrument_id   text NOT NULL,
  source_id       text NOT NULL,
  exchange_time   timestamptz NOT NULL,
  received_at     timestamptz NOT NULL,
  side            text NOT NULL CHECK (side IN ('buy','sell')),   -- 'sell' = LONG liquidiert
  price           double precision NOT NULL CHECK (price > 0),
  quantity        double precision NOT NULL CHECK (quantity > 0),
  notional        double precision NOT NULL,
  PRIMARY KEY (liquidation_id, exchange_time),
  UNIQUE (instrument_id, source_id, exchange_time, side, price, quantity)
);
CREATE INDEX liquidations_pit ON liquidations (instrument_id, exchange_time DESC);
CREATE TRIGGER liquidations_append_only BEFORE UPDATE OR DELETE ON liquidations FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Zustand der Stroeme (alle ~10 s), damit auch "ruhige" Stroeme (Liquidationen) als lebendig belegbar sind
CREATE TABLE ws_stream_status (
  stream           text NOT NULL,
  received_at      timestamptz NOT NULL,
  state            text NOT NULL,
  last_message_at  timestamptz,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (stream, received_at)
);
