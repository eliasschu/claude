"""
ws-ingestor: eigener Dienst fuer Krypto-WebSockets.

    Binance WS (Trades, Orderbuch-Deltas, Liquidationen)
        -> Normalizer -> EventBus -> MarketState / LocalOrderBook
        -> Sekundenzeilen (received_at = Bot-Uhr) -> Postgres
        -> Worker-Zyklus liest sie Point-in-Time -> Flow-Features -> Strategien

Der Dienst trifft keine Handelsentscheidungen. Faellt er aus, laeuft der
REST-Zyklus weiter (Health: DEGRADED).
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from ..metrics import METRICS
from . import normalizers
from .bus import EventBus
from .client import StreamSpec, WsStream
from .events import LiquidationEvent, OrderBookEvent, TradeEvent
from .market_state import MarketState
from .orderbook import LocalOrderBook

log = logging.getLogger("quant.ws.ingestor")

BINANCE_SPOT_WS = "wss://stream.binance.com:9443"
BINANCE_FUTURES_WS = "wss://fstream.binance.com"
# Nach einer Luecke sofort neu synchronisieren; bei wiederholtem Scheitern wachsende Pause (max. 60 s)
RESYNC_MIN_INTERVAL = timedelta(seconds=1)
RESYNC_MAX_INTERVAL = timedelta(seconds=60)
STATUS_EVERY = timedelta(seconds=10)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class SymbolIds:
    symbol: str
    spot_id: str
    perp_id: str


class Ingestor:
    def __init__(self, symbols: list[SymbolIds], writer: "Writer", snapshot_fn: Callable[[str], tuple[int, list, list]], *,
                 clock: Callable[[], datetime] = utc_now, spot_ws: str = BINANCE_SPOT_WS, futures_ws: str = BINANCE_FUTURES_WS,
                 flush_interval: float = 1.0, connector=None, stream_kwargs: dict | None = None):
        self.symbols = {s.symbol: s for s in symbols}
        self.writer, self.snapshot_fn, self.clock, self.flush_interval = writer, snapshot_fn, clock, flush_interval
        self.bus = EventBus()
        self.states = {s.symbol: MarketState("binance", s.symbol) for s in symbols}
        self.books = {s.symbol: LocalOrderBook("binance", s.symbol, "binance_spot") for s in symbols}
        self._resync_at: dict[str, datetime] = {}
        self._resync_failures: dict[str, int] = {}
        self._resync_running: set[str] = set()
        kw = dict(stream_kwargs or {})
        if connector is not None:
            kw["connector"] = connector
        self.streams: list[WsStream] = []
        self._depth_stream: dict[str, WsStream] = {}
        for s in symbols:
            low = s.symbol.lower()
            self.streams.append(WsStream(StreamSpec(f"binance:trades:{s.spot_id}", f"{spot_ws}/stream?streams={low}@trade",
                                                    normalizers.binance, stale_after=30), self.bus, clock=clock, **kw))
            # Neuer Delta-Strom -> altes Buch ist wertlos: invalidieren, neuer Snapshot (Sequence Recovery)
            depth = WsStream(StreamSpec(f"binance:depth:{s.spot_id}", f"{spot_ws}/stream?streams={low}@depth@100ms",
                                        normalizers.binance, stale_after=30,
                                        on_connect=lambda sym=s.symbol: self._reset_book(sym)), self.bus, clock=clock, **kw)
            self._depth_stream[s.symbol] = depth
            self.streams.append(depth)
            # Liquidationen kommen nur bei Ereignissen - Lebendigkeit ueber Ping/Pong, nicht ueber Nachrichten
            self.streams.append(WsStream(StreamSpec(f"binance:liquidations:{s.perp_id}", f"{futures_ws}/stream?streams={low}@forceOrder",
                                                    normalizers.binance, stale_after=None), self.bus, clock=clock, **kw))
        self._last_status = datetime.min.replace(tzinfo=timezone.utc)
        self.started_at = clock()

    def _reset_book(self, symbol: str) -> None:
        self.books[symbol] = LocalOrderBook("binance", symbol, "binance_spot")

    async def run(self, stop: asyncio.Event) -> None:
        tasks = [asyncio.create_task(s.run(stop)) for s in self.streams]
        tasks += [asyncio.create_task(self._consume(stop)), asyncio.create_task(self._resync_loop(stop)),
                  asyncio.create_task(self._flush_loop(stop))]
        await stop.wait()
        # Alle Schleifen pruefen `stop` selbst und enden nach dem laufenden Schritt
        await asyncio.gather(*tasks, return_exceptions=True)
        # Letzte offene Sekunden sichern: vollstaendig leeren, aber mit der ECHTEN Uhrzeit als received_at stempeln
        await asyncio.to_thread(self._flush, self.clock(), True)

    async def _consume(self, stop: asyncio.Event) -> None:
        q = self.bus.subscribe()
        while not stop.is_set():
            try:
                ev = await asyncio.wait_for(q.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            if isinstance(ev, TradeEvent) and ev.symbol in self.states:
                self.states[ev.symbol].on_trade(ev)
            elif isinstance(ev, OrderBookEvent) and ev.symbol in self.books:
                book = self.books[ev.symbol]
                was_synced = not book.needs_snapshot
                book.on_delta(ev)
                if was_synced and book.needs_snapshot:
                    METRICS.inc("orderbook_resyncs_total", symbol=ev.symbol)
                    log.warning("Orderbuch invalidiert", extra={"event": "orderbook_gap", "asset": ev.symbol, "reason": book.last_error})
                m = book.metrics()
                if m is not None:
                    self.states[ev.symbol].on_book(m, ev.received_at)
            elif isinstance(ev, LiquidationEvent) and ev.symbol in self.states:
                self.states[ev.symbol].on_liquidation(ev)

    async def _resync_loop(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            for sym, book in self.books.items():
                last = self._resync_at.get(sym)
                wait = min(RESYNC_MAX_INTERVAL, RESYNC_MIN_INTERVAL * 2 ** self._resync_failures.get(sym, 0))
                # Snapshot nur bei verbundenem Delta-Strom - sonst fehlen die Deltas zum Nachspielen
                connected = self._depth_stream[sym].status.state == "live"
                if connected and book.needs_snapshot and sym not in self._resync_running and (last is None or self.clock() - last >= wait):
                    self._resync_running.add(sym)
                    self._resync_at[sym] = self.clock()
                    asyncio.create_task(self._resync(sym, book))
            await asyncio.sleep(0.2)

    async def _resync(self, symbol: str, book: LocalOrderBook) -> None:
        try:
            last_id, bids, asks = await asyncio.to_thread(self.snapshot_fn, symbol)
            if self.books.get(symbol) is book:  # zwischenzeitlich neu verbunden? dann gilt der neue Puffer
                book.on_snapshot(last_id, bids, asks, self.clock())
                self._resync_failures[symbol] = 0 if not book.needs_snapshot else self._resync_failures.get(symbol, 0) + 1
        except Exception as exc:  # noqa: BLE001 - naechster Versuch mit wachsender Pause
            self._resync_failures[symbol] = self._resync_failures.get(symbol, 0) + 1
            log.warning("Orderbuch-Snapshot fehlgeschlagen", extra={"event": "orderbook_snapshot_failed", "asset": symbol,
                                                                     "error_type": type(exc).__name__})
        finally:
            self._resync_running.discard(symbol)

    async def _flush_loop(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            await asyncio.sleep(self.flush_interval)
            now = self.clock()
            # Buch-Stichprobe je Takt (im Event-Loop, damit kein Thread das Buch waehrend einer Aenderung liest)
            for sym, book in self.books.items():
                m = book.metrics()
                if m is not None:
                    self.states[sym].on_book(m, now)
            try:
                await asyncio.to_thread(self._flush, now)
            except Exception as exc:  # noqa: BLE001 - Datenbank kurz weg: Daten der naechsten Runde schreiben
                log.error("Schreiben fehlgeschlagen", extra={"event": "ws_flush_failed", "error_type": type(exc).__name__})

    def _flush(self, now: datetime, final: bool = False) -> None:
        t0 = time.monotonic()
        batch = []
        for sym, st in self.states.items():
            # final: auch die noch offenen Sekunden herausgeben (Dienst endet); received_at bleibt `now`
            flows, books, liqs = st.drain(now + timedelta(seconds=10) if final else now)
            batch.append((self.symbols[sym], flows, books, liqs))
        status = None
        if now - self._last_status >= STATUS_EVERY:
            status = {s.spec.name: s.status.as_dict() for s in self.streams}
            self._last_status = now
        self.writer.write(batch, status, now=now, started_at=self.started_at)
        METRICS.observe("ws_flush_ms", (time.monotonic() - t0) * 1000)


class Writer:
    """Schreibt Sekundenzeilen, Stromstatus und Heartbeat. Eigene Verbindung, nur aus einem Thread genutzt."""

    def __init__(self, conn_factory):
        self._factory = conn_factory
        self._conn = None

    def write(self, batch, status, *, now: datetime, started_at: datetime) -> None:
        from psycopg.types.json import Jsonb

        from ..heartbeat import beat
        from ..repo import store_book, store_flow, store_liquidations

        if self._conn is None or self._conn.closed:
            self._conn = self._factory()
        c = self._conn
        try:
            for ids, flows, books, liqs in batch:
                store_flow(c, ids.spot_id, "binance", flows, received_at=now)
                store_book(c, ids.spot_id, "binance", books, received_at=now)
                store_liquidations(c, ids.perp_id, "binance", liqs)
            if status is not None:
                for name, st in status.items():
                    c.execute("INSERT INTO ws_stream_status (stream, received_at, state, last_message_at, details) VALUES (%s,%s,%s,%s,%s)",
                              (name, now, st["state"], st["last_message_at"], Jsonb(st)))
                live = all(st["state"] == "live" for st in status.values())
                c.commit()
                beat(c, "ws-ingestor", now=now, started_at=started_at, status="HEALTHY" if live else "DEGRADED",
                     details={"reason": "alle Stroeme live" if live else "Stroeme nicht live", "streams": status})
            c.commit()
        except Exception:
            try:
                c.rollback()
            except Exception:  # noqa: BLE001
                self._conn = None
            raise


def main() -> None:
    import signal

    from ..config import load_settings
    from ..db import connect, migrate
    from ..logs import configure_logging
    from ..providers.binance import BinanceProvider
    from ..universe import crypto_instrument, parse_pair

    configure_logging("ws-ingestor")
    settings = load_settings()
    with connect(settings.database_url) as conn:
        migrate(conn)
        ids = []
        for sym in settings.crypto_symbols:
            pair = parse_pair(sym)
            ids.append(SymbolIds(pair.symbol, crypto_instrument(conn, pair, "binance", "crypto_spot"),
                                 crypto_instrument(conn, pair, "binance", "crypto_perp")))
        conn.commit()
    binance = BinanceProvider()

    def snapshot(symbol: str):
        r = binance.spot_depth_snapshot(symbol, 1000)
        last_id, book = r.data
        return last_id, list(book.bids), list(book.asks)

    ing = Ingestor(ids, Writer(lambda: connect(settings.database_url)), snapshot)

    async def run():
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, stop.set)
        log.info("ws-ingestor gestartet", extra={"event": "service_started", "symbols": [s.symbol for s in ids]})
        await ing.run(stop)
        log.info("ws-ingestor beendet", extra={"event": "service_stopped"})

    asyncio.run(run())


if __name__ == "__main__":
    main()
