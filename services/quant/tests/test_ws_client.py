"""Echte WebSocket-Verbindungen gegen einen lokalen Testserver (kein Internet noetig)."""

import asyncio
import json
import random

import pytest
from websockets.asyncio.server import serve

from quant.ws import normalizers
from quant.ws.bus import EventBus
from quant.ws.client import StreamSpec, WsStream

TRADE = {"e": "trade", "E": 1790000000000, "s": "BTCUSDT", "t": 1, "p": "60000.5", "q": "0.1", "T": 1790000000000, "m": False}


async def _drain(q):
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=20))


def test_messages_flow_reconnect_and_subscription_recovery():
    async def main():
        subs, conns = [], []

        async def handler(ws):
            conns.append(ws)
            subs.append(json.loads(await ws.recv()))           # Abo-Nachricht
            await ws.send(json.dumps(TRADE))
            await ws.send("{kaputt")                             # korrupte Nachricht
            await ws.send(json.dumps({"e": "trade", "s": "BTCUSDT"}))  # Feld fehlt
            if len(conns) == 1:
                await ws.close()                                 # Abbruch -> Reconnect
                return
            await ws.send(json.dumps({**TRADE, "t": 2, "m": True}))
            await asyncio.sleep(2)

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            bus = EventBus()
            q = bus.subscribe()
            on_connect_calls = []
            spec = StreamSpec("test:trades", f"ws://127.0.0.1:{port}", normalizers.binance,
                              subscribe={"method": "SUBSCRIBE", "params": ["btcusdt@trade"], "id": 1},
                              on_connect=lambda: on_connect_calls.append(1))
            stream = WsStream(spec, bus, base_backoff=0.05, rng=random.Random(1))
            stop = asyncio.Event()
            task = asyncio.create_task(stream.run(stop))
            for _ in range(100):
                await asyncio.sleep(0.05)
                if stream.status.messages >= 7:
                    break
            stop.set()
            await task
            events = await _drain(q)
            return subs, on_connect_calls, events, stream.status

    subs, on_connect_calls, events, status = run(main())
    assert len(subs) == 2 and subs[0] == subs[1]                 # Abo nach Reconnect erneut gesendet
    assert len(on_connect_calls) == 2                             # Orderbuch-Resync-Hook bei jedem Connect
    assert [e.side for e in events] == ["buy", "buy", "sell"]    # m=False -> Aggressor kauft
    assert status.bad_messages == 4 and status.reconnects >= 1 and status.state == "stopped"


def test_stale_feed_triggers_reconnect():
    async def main():
        conns = []

        async def handler(ws):
            conns.append(ws)
            await asyncio.sleep(2)                               # sendet nichts

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            spec = StreamSpec("test:silent", f"ws://127.0.0.1:{port}", normalizers.binance, stale_after=0.3)
            stream = WsStream(spec, EventBus(), base_backoff=0.01, rng=random.Random(1))
            stop = asyncio.Event()
            task = asyncio.create_task(stream.run(stop))
            await asyncio.sleep(1.5)
            stop.set()
            await task
            return len(conns), stream.status

    n, status = run(main())
    assert n >= 2 and "stale" in status.last_error


def test_no_aggressive_reconnect_loop():
    """Server lehnt sofort ab: nach max_reconnects im Fenster pausiert der Strom (cooldown) statt zu haemmern."""
    async def main():
        attempts = []

        async def handler(ws):
            attempts.append(1)
            await ws.close()

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            spec = StreamSpec("test:reject", f"ws://127.0.0.1:{port}", normalizers.binance)
            stream = WsStream(spec, EventBus(), base_backoff=0.001, max_backoff=0.01, max_reconnects=3, cooldown=60,
                              rng=random.Random(1))
            stop = asyncio.Event()
            task = asyncio.create_task(stream.run(stop))
            await asyncio.sleep(1.0)
            state = stream.status.state
            stop.set()
            await task
            return len(attempts), state

    attempts, state = run(main())
    assert state == "cooldown" and attempts == 4


@pytest.mark.parametrize("msg", [
    {"e": "forceOrder", "E": 1, "o": {"s": "BTCUSDT", "S": "SELL", "q": "0.5", "p": "59000", "ap": "58990", "z": "0.5", "X": "FILLED", "T": 1790000000000}},
])
def test_liquidation_normalizer(msg):
    from datetime import datetime, timezone
    ev = normalizers.binance(msg, datetime.now(timezone.utc))
    assert ev.liquidated_position == "long" and ev.price == 58990.0 and ev.notional == pytest.approx(29495.0)


def test_coinbase_maker_side_is_inverted():
    from datetime import datetime, timezone
    ev = normalizers.coinbase({"type": "match", "trade_id": 5, "sequence": 9, "time": "2026-09-22T12:00:00.123Z", "product_id": "BTC-USD",
                               "size": "0.2", "price": "60000", "side": "sell"}, datetime.now(timezone.utc))
    assert ev.side == "buy" and ev.symbol == "BTCUSD"
    assert normalizers.coinbase({"type": "heartbeat"}, datetime.now(timezone.utc)) is None
