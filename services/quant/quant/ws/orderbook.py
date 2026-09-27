"""
Lokales Orderbuch aus Snapshot + Deltas nach Anbieterspezifikation.

Binance (Spot und USD-M), dokumentierter Ablauf:
  1. Delta-Strom oeffnen und Ereignisse PUFFERN.
  2. REST-Snapshot holen -> lastUpdateId.
  3. Gepufferte Ereignisse mit u <= lastUpdateId verwerfen.
  4. Erstes angewandtes Ereignis:
       Spot:    U <= lastUpdateId + 1 <= u
       Futures: U <= lastUpdateId <= u
  5. Jedes weitere Ereignis:
       Spot:    U == vorheriges u + 1
       Futures: pu == vorheriges u
  6. Luecke oder widerspruechliches Buch (bester Bid >= beste Ask) ->
     Buch INVALIDIEREN und neu synchronisieren (neuer Snapshot). Nie "irgendwie weiterrechnen".

Mengen in Deltas sind absolute Stufenmengen; Menge 0 entfernt die Stufe.
Solange das Buch nicht synchron ist, liefert es keine Kennzahlen.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Literal

from .events import OrderBookEvent

SequenceRule = Literal["binance_spot", "binance_futures"]
MAX_BUFFER = 5_000


class BookState(str, Enum):
    WAITING_SNAPSHOT = "waiting_snapshot"  # puffert Deltas
    SYNCED = "synced"
    INVALID = "invalid"                    # Luecke erkannt -> neuer Snapshot noetig


class SequenceGap(Exception):
    pass


@dataclass(frozen=True)
class BookMetrics:
    best_bid: float
    best_ask: float
    spread_bps: float
    depth_bid_10bps: float
    depth_ask_10bps: float
    imbalance_10bps: float  # (bid - ask) / (bid + ask) im Band +/-10 bps, Quote-Waehrung
    last_update_id: int
    exchange_time: datetime | None


class LocalOrderBook:
    def __init__(self, provider: str, symbol: str, rule: SequenceRule):
        self.provider, self.symbol, self.rule = provider, symbol, rule
        self.state = BookState.WAITING_SNAPSHOT
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}
        self.last_update_id: int | None = None
        self.exchange_time: datetime | None = None
        self._buffer: list[OrderBookEvent] = []
        self.resyncs = 0
        self.last_error: str | None = None

    # ------------------------------------------------------------------ Ablauf
    def on_delta(self, ev: OrderBookEvent) -> None:
        if ev.first_update_id is None or ev.last_update_id is None:
            self._invalidate("Delta ohne Sequenz-IDs")
            return
        if self.state != BookState.SYNCED:
            self._buffer.append(ev)
            if len(self._buffer) > MAX_BUFFER:
                self._buffer = self._buffer[-MAX_BUFFER:]  # Snapshot kommt nicht - aeltestes verwerfen, Luecke faellt spaeter auf
            return
        try:
            self._check_continuity(ev)
        except SequenceGap as gap:
            self._invalidate(str(gap))
            self._buffer.append(ev)  # fuer den naechsten Snapshot behalten
            return
        self._apply(ev)

    def on_snapshot(self, last_update_id: int, bids: list[tuple[float, float]], asks: list[tuple[float, float]],
                    exchange_time: datetime | None = None) -> None:
        """REST-Snapshot anwenden und gepufferte Deltas regelgerecht nachspielen."""
        self.bids = {p: q for p, q in bids if q > 0}
        self.asks = {p: q for p, q in asks if q > 0}
        self.last_update_id = last_update_id
        self.exchange_time = exchange_time
        pending = [e for e in self._buffer if e.last_update_id > last_update_id]  # Schritt 3
        self._buffer = []
        first = True
        for ev in pending:
            if first:
                ok = (ev.first_update_id <= last_update_id + 1 <= ev.last_update_id) if self.rule == "binance_spot" \
                    else (ev.first_update_id <= last_update_id <= ev.last_update_id)
                if not ok:
                    # Snapshot ist aelter als der Pufferanfang oder es fehlt etwas -> neuer Snapshot noetig
                    self._invalidate(f"erstes Delta passt nicht zum Snapshot (U={ev.first_update_id}, u={ev.last_update_id}, "
                                     f"lastUpdateId={last_update_id})")
                    self._buffer = pending
                    return
                first = False
            else:
                try:
                    self._check_continuity(ev)
                except SequenceGap as gap:
                    self._invalidate(str(gap))
                    return
            self._apply(ev, check_cross=False)
        self.state = BookState.SYNCED
        self.last_error = None
        if self._crossed():
            self._invalidate("Buch nach Snapshot gekreuzt")

    # ------------------------------------------------------------------ Hilfen
    def _check_continuity(self, ev: OrderBookEvent) -> None:
        if self.rule == "binance_spot":
            if ev.first_update_id != (self.last_update_id or 0) + 1:
                raise SequenceGap(f"Sequenzluecke: erwartet U={(self.last_update_id or 0) + 1}, erhalten U={ev.first_update_id}")
        else:
            if ev.prev_last_update_id != self.last_update_id:
                raise SequenceGap(f"Sequenzluecke: erwartet pu={self.last_update_id}, erhalten pu={ev.prev_last_update_id}")

    def _apply(self, ev: OrderBookEvent, check_cross: bool = True) -> None:
        for p, q in ev.bids:
            if q == 0:
                self.bids.pop(p, None)
            else:
                self.bids[p] = q
        for p, q in ev.asks:
            if q == 0:
                self.asks.pop(p, None)
            else:
                self.asks[p] = q
        self.last_update_id = ev.last_update_id
        self.exchange_time = ev.exchange_time
        if check_cross and self._crossed():
            self._invalidate("Buch gekreuzt (bester Bid >= beste Ask)")

    def _crossed(self) -> bool:
        return bool(self.bids and self.asks and max(self.bids) >= min(self.asks))

    def _invalidate(self, reason: str) -> None:
        if self.state == BookState.SYNCED:
            self.resyncs += 1
        self.state = BookState.INVALID
        self.last_error = reason
        self.bids.clear()
        self.asks.clear()

    @property
    def needs_snapshot(self) -> bool:
        return self.state != BookState.SYNCED

    # ------------------------------------------------------------------ Kennzahlen
    def top(self, n: int = 20) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
        return sorted(self.bids.items(), reverse=True)[:n], sorted(self.asks.items())[:n]

    def metrics(self, band_bps: float = 10.0) -> BookMetrics | None:
        if self.state != BookState.SYNCED or not self.bids or not self.asks:
            return None
        bb, ba = max(self.bids), min(self.asks)
        mid = (bb + ba) / 2
        lo, hi = mid * (1 - band_bps / 1e4), mid * (1 + band_bps / 1e4)
        bid_val = sum(p * q for p, q in self.bids.items() if p >= lo)
        ask_val = sum(p * q for p, q in self.asks.items() if p <= hi)
        total = bid_val + ask_val
        return BookMetrics(bb, ba, (ba - bb) / mid * 1e4, bid_val, ask_val, (bid_val - ask_val) / total if total else 0.0,
                           self.last_update_id or 0, self.exchange_time)
