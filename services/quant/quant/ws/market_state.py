"""
Market State: verdichtet normalisierte Ereignisse zu Sekundenzeilen.

Die Sekundenzeilen sind das Speicherformat (trade_flow_1s, orderbook_1s,
liquidations) UND die Eingabe der Flow-Features. Live-Betrieb und Replay rechnen
damit exakt dieselben Merkmale. Eine Sekunde wird erst ausgegeben, wenn sie
abgeschlossen ist (Wanduhr > Sekundenende + Karenz fuer verspaetete Trades).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .events import LiquidationEvent, TradeEvent
from .orderbook import BookMetrics

LATE_GRACE = timedelta(seconds=2)


@dataclass
class FlowSecond:
    ts: datetime
    buy_qty: float = 0.0
    sell_qty: float = 0.0
    buy_notional: float = 0.0
    sell_notional: float = 0.0
    trades: int = 0
    last_price: float | None = None
    max_trade_notional: float = 0.0
    _last_exchange_time: datetime | None = None

    def add(self, t: TradeEvent) -> None:
        n = t.notional
        if t.side == "buy":
            self.buy_qty += t.quantity
            self.buy_notional += n
        else:
            self.sell_qty += t.quantity
            self.sell_notional += n
        self.trades += 1
        self.max_trade_notional = max(self.max_trade_notional, n)
        if self._last_exchange_time is None or t.exchange_time >= self._last_exchange_time:
            self.last_price, self._last_exchange_time = t.price, t.exchange_time

    def row(self) -> dict:
        return {"ts": self.ts, "buy_qty": self.buy_qty, "sell_qty": self.sell_qty, "buy_notional": self.buy_notional,
                "sell_notional": self.sell_notional, "trades": self.trades, "last_price": self.last_price,
                "max_trade_notional": self.max_trade_notional}


def _second(t: datetime) -> datetime:
    return t.replace(microsecond=0)


@dataclass
class MarketState:
    """Zustand je (Anbieter, Symbol). Gibt abgeschlossene Sekunden und Buch-Stichproben zur Speicherung aus."""

    provider: str
    symbol: str
    _open: dict[datetime, FlowSecond] = field(default_factory=dict)
    _book_samples: list[tuple[datetime, BookMetrics]] = field(default_factory=list)
    _liqs: list[LiquidationEvent] = field(default_factory=list)
    last_trade_at: datetime | None = None
    last_book_at: datetime | None = None
    late_trades: int = 0
    _emitted_until: datetime | None = None

    def on_trade(self, t: TradeEvent) -> None:
        sec = _second(t.exchange_time)
        if self._emitted_until is not None and sec <= self._emitted_until:
            self.late_trades += 1  # Sekunde bereits gespeichert: nie rueckwirkend aendern
            return
        self._open.setdefault(sec, FlowSecond(sec)).add(t)
        self.last_trade_at = t.received_at

    def on_book(self, m: BookMetrics, received_at: datetime) -> None:
        sec = _second(received_at)
        if self._book_samples and self._book_samples[-1][0] == sec:
            self._book_samples[-1] = (sec, m)  # letzte Stichprobe der Sekunde gilt
        else:
            self._book_samples.append((sec, m))
        self.last_book_at = received_at

    def on_liquidation(self, liq: LiquidationEvent) -> None:
        self._liqs.append(liq)

    def drain(self, now: datetime) -> tuple[list[dict], list[dict], list[LiquidationEvent]]:
        """Abgeschlossene Sekunden (Trades), Buch-Stichproben und Liquidationen zur Speicherung herausgeben."""
        cutoff = _second(now - LATE_GRACE)
        done = sorted(s for s in self._open if s < cutoff)
        flows = [self._open.pop(s).row() for s in done]
        if done:
            self._emitted_until = max(done[-1], self._emitted_until or done[-1])
        books = [{"ts": s, **m.__dict__} for s, m in self._book_samples if s < _second(now)]
        self._book_samples = [(s, m) for s, m in self._book_samples if s >= _second(now)]
        liqs, self._liqs = self._liqs, []
        return flows, books, liqs


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
