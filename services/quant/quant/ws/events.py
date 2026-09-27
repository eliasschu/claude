"""Normalisierte Marktereignisse - unabhaengig vom Anbieter."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal


@dataclass(frozen=True)
class TradeEvent:
    provider: str
    symbol: str
    price: float
    quantity: float
    # Seite des AGGRESSORS: buy = Kaeufer hat die Ask genommen
    side: Literal["buy", "sell"]
    exchange_time: datetime
    received_at: datetime
    trade_id: str | None = None

    @property
    def notional(self) -> float:
        return self.price * self.quantity


@dataclass(frozen=True)
class OrderBookEvent:
    """Delta (kind='delta') oder Snapshot (kind='snapshot'). Mengen sind absolute Stufenmengen; 0 = Stufe entfernen."""

    provider: str
    symbol: str
    kind: Literal["delta", "snapshot"]
    bids: tuple[tuple[float, float], ...]
    asks: tuple[tuple[float, float], ...]
    exchange_time: datetime | None
    received_at: datetime
    # Sequenz: erste und letzte Update-ID dieses Deltas; prev_last = letzte ID des Vorgaengers (Binance Futures "pu")
    first_update_id: int | None = None
    last_update_id: int | None = None
    prev_last_update_id: int | None = None


@dataclass(frozen=True)
class LiquidationEvent:
    provider: str
    symbol: str
    # Seite der Liquidationsorder: 'sell' = eine LONG-Position wurde liquidiert, 'buy' = eine SHORT-Position
    side: Literal["buy", "sell"]
    price: float
    quantity: float
    exchange_time: datetime
    received_at: datetime
    extra: dict = field(default_factory=dict)

    @property
    def notional(self) -> float:
        return self.price * self.quantity

    @property
    def liquidated_position(self) -> Literal["long", "short"]:
        return "long" if self.side == "sell" else "short"


MarketEvent = TradeEvent | OrderBookEvent | LiquidationEvent
