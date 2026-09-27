"""
Ende-zu-Ende: lokaler WebSocket-Server (Binance-Format) -> ws-ingestor -> Postgres -> Worker-Features.
Prueft Trades, Orderbuch-Synchronisation (Snapshot + Deltas + Luecke/Resync) und Liquidationen.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from websockets.asyncio.server import serve

from quant.domain import FeatureSet
from quant.repo import load_flow
from quant.universe import crypto_instrument, parse_pair
from quant.ws.events import TradeEvent
from quant.ws.flow_features import add_flow_features
from quant.ws.ingestor import Ingestor, SymbolIds, Writer
from quant.ws.market_state import MarketState


def _ms(t):
    return int(t.timestamp() * 1000)


def test_market_state_never_rewrites_an_emitted_second():
    t0 = datetime(2026, 9, 22, 12, 0, 0, tzinfo=timezone.utc)
    st = MarketState("binance", "BTCUSDT")
    st.on_trade(TradeEvent("binance", "BTCUSDT", 100, 1, "buy", t0, t0))
    flows, _, _ = st.drain(t0 + timedelta(seconds=5))
    assert len(flows) == 1 and flows[0]["buy_notional"] == 100
    st.on_trade(TradeEvent("binance", "BTCUSDT", 100, 1, "sell", t0 + timedelta(milliseconds=500), t0 + timedelta(seconds=6)))
    assert st.late_trades == 1 and st.drain(t0 + timedelta(seconds=10))[0] == []


def test_ingestor_end_to_end(db):
    pair = parse_pair("BTCUSDT")
    spot_id = crypto_instrument(db, pair, "binance", "crypto_spot")
    perp_id = crypto_instrument(db, pair, "binance", "crypto_perp")
    db.commit()
    dsn = f"postgresql://quant:quant@{db.info.host}:{db.info.port}/{db.info.dbname}"

    async def main():
        depth_connections = []

        async def handler(ws):
            path = ws.request.path
            now = datetime.now(timezone.utc)
            if "@trade" in path:
                for i in range(40):
                    t = datetime.now(timezone.utc)
                    await ws.send(json.dumps({"stream": "btcusdt@trade", "data": {
                        "e": "trade", "E": _ms(t), "s": "BTCUSDT", "t": i, "p": "60000", "q": "0.5", "T": _ms(t), "m": i % 4 == 0}}))
                    await asyncio.sleep(0.05)
                await ws.wait_closed()
            elif "@depth" in path:
                depth_connections.append(1)
                # 101..110 lueckenlos, dann eine Luecke (112 statt 111) -> Resync
                for u in list(range(101, 111)) + [112, 113]:
                    await ws.send(json.dumps({"data": {"e": "depthUpdate", "E": _ms(datetime.now(timezone.utc)), "s": "BTCUSDT",
                                                        "U": u, "u": u, "b": [["59999", str(1 + u % 3)]], "a": [["60001", "2"]]}}))
                    await asyncio.sleep(0.1)
                await ws.wait_closed()
            elif "@forceOrder" in path:
                await ws.send(json.dumps({"data": {"e": "forceOrder", "E": _ms(now), "o": {
                    "s": "BTCUSDT", "S": "SELL", "q": "2", "p": "59900", "ap": "59900", "z": "2", "X": "FILLED", "T": _ms(now)}}}))
                await ws.wait_closed()

        snapshots = []

        def snapshot(symbol):
            snapshots.append(symbol)
            # erster Snapshot passt zu Delta 101; spaetere liegen hinter der Luecke
            return (100 if len(snapshots) == 1 else 113), [(59999.0, 1.0), (59990.0, 5.0)], [(60001.0, 1.0), (60010.0, 5.0)]

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            from quant.db import connect
            ing = Ingestor([SymbolIds("BTCUSDT", spot_id, perp_id)], Writer(lambda: connect(dsn)), snapshot,
                           spot_ws=f"ws://127.0.0.1:{port}", futures_ws=f"ws://127.0.0.1:{port}", flush_interval=0.3)
            stop = asyncio.Event()
            task = asyncio.create_task(ing.run(stop))
            await asyncio.sleep(4.5)
            stop.set()
            await asyncio.wait_for(task, timeout=10)
            return ing, snapshots

    ing, snapshots = asyncio.run(main())
    book = ing.books["BTCUSDT"]
    assert len(snapshots) == 2, "genau ein Anfangs-Snapshot und ein Resync nach der Luecke"
    assert book.resyncs == 1 and not book.needs_snapshot and book.last_update_id == 113
    flow = db.execute("SELECT sum(buy_notional) AS b, sum(sell_notional) AS s, sum(trades) AS n FROM trade_flow_1s").fetchone()
    assert flow["n"] == 40 and flow["s"] == pytest.approx(10 * 30000) and flow["b"] == pytest.approx(30 * 30000)
    assert db.execute("SELECT count(*) AS n FROM orderbook_1s").fetchone()["n"] >= 1
    liq = db.execute("SELECT side, notional, instrument_id FROM liquidations").fetchone()
    assert liq["side"] == "sell" and liq["instrument_id"] == perp_id and liq["notional"] == pytest.approx(119800)
    hb = db.execute("SELECT details FROM service_heartbeats WHERE service='ws-ingestor'").fetchone()
    assert hb and len(hb["details"]["streams"]) == 3

    # Worker-Seite: Features Point-in-Time aus denselben Zeilen
    as_of = datetime.now(timezone.utc)
    flow_rows, book_rows, liqs, alive = load_flow(db, spot_id, perp_id, as_of)
    fs = FeatureSet(spot_id, as_of)
    add_flow_features(fs, flow=flow_rows, book=book_rows, liqs=liqs, liq_feed_alive_at=alive, source_ids=("binance",), as_of=as_of)
    assert fs.raw("trade_imbalance_5m") == pytest.approx(0.5)
    # received_at liegt nie in der Zukunft der Bot-Uhr (auch nicht beim abschliessenden Flush)
    assert db.execute("SELECT max(received_at) AS t FROM trade_flow_1s").fetchone()["t"] <= as_of
    assert fs.raw("liq_long_notional_5m") == pytest.approx(119800) and fs.values["trade_imbalance_5m"].data_class == "trade"
    # Nichts, was erst nach as_of bekannt wurde
    early = datetime.now(timezone.utc) - timedelta(minutes=10)
    assert load_flow(db, spot_id, perp_id, early)[0] == []


def test_reconnect_gap_during_evaluation_marks_book_features_stale_without_breaking_strategies():
    """Waehrend eines Reconnects/Resyncs kommen keine Buchzeilen: die letzten sind alt -> stale, Strategien laufen weiter."""
    from quant.domain import Decision
    from quant.strategies import CryptoSpotPerpDivergence
    from tests.test_engines import CRYPTO, CRYPTO_DIV, fs_of
    as_of = datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc)
    old = as_of - timedelta(minutes=2)
    book = [{"ts": old - timedelta(seconds=i), "best_bid": 99.9, "best_ask": 100.1, "spread_bps": 20.0, "depth_bid_10bps": 1e5,
             "depth_ask_10bps": 1e5, "imbalance_10bps": 0.1, "last_update_id": 1, "exchange_time": old} for i in range(40)]
    fs = fs_of(CRYPTO_DIV, "under_1_min")
    add_flow_features(fs, flow=[], book=book, liqs=[], liq_feed_alive_at=None, source_ids=("binance",), as_of=as_of)
    assert fs.values["ob_spread_bps"].freshness == "stale" and not fs.values["ob_spread_bps"].usable
    assert "trade_imbalance_1m" in fs.unavailable and "liq_long_notional_5m" in fs.unavailable
    assert CryptoSpotPerpDivergence().evaluate(fs, CRYPTO).decision == Decision.LONG_CANDIDATE
