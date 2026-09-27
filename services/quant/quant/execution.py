"""
Ausfuehrungsmodell - EIN Modell fuer Paper, Shadow und Backtest.

Modi
  REALISTIC (Standard fuer jede Bewertung): Spread, Slippage, Gebuehren, Latenz, Teilausfuehrung.
  IDEALIZED: Fill zum Referenzpreis ohne Spread/Slippage/Gebuehren/Latenz - nur als Vergleich,
             um zu zeigen, wie viel der Rendite die Kosten auffressen.

Gebuehren sind je Handelsplatz und Maker/Taker konfigurierbar (EXECUTION_CONFIG als JSON),
nicht hart codiert. Market-Orders und Stops zahlen Taker, ruhende Ziel-Limits Maker.

Slippage-Modelle
  fixed       fester Aufschlag in bps
  volatility  Grundaufschlag + k x Minutenvolatilitaet (bps)
  orderbook   Order laeuft Level fuer Level durch das Buch; ohne Buch Rueckfall auf volatility
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timedelta
from typing import Literal

from .paper import CostModel, ExitEvent, Fill, crypto_market_fill, equity_open_fill, exit_fill
from .providers.base import Bar, OrderBook

Mode = Literal["realistic", "idealized"]
SlippageModel = Literal["fixed", "volatility", "orderbook"]


@dataclass(frozen=True)
class FeeSchedule:
    maker_bps: float
    taker_bps: float


DEFAULT_FEES: dict[str, FeeSchedule] = {
    # Standardstufen ohne Rabatte (konservativ); per EXECUTION_CONFIG ueberschreibbar
    "binance": FeeSchedule(maker_bps=10.0, taker_bps=10.0),
    "coinbase": FeeSchedule(maker_bps=40.0, taker_bps=60.0),
    "kraken": FeeSchedule(maker_bps=25.0, taker_bps=40.0),
    "us_equity": FeeSchedule(maker_bps=1.0, taker_bps=1.0),  # Abgaben/Clearing; Kommission 0 bei vielen Brokern
}


@dataclass(frozen=True)
class ExecutionModel:
    mode: Mode = "realistic"
    slippage_model: SlippageModel = "orderbook"
    fees: dict[str, FeeSchedule] = field(default_factory=lambda: dict(DEFAULT_FEES))
    fixed_slippage_bps: dict[str, float] = field(default_factory=lambda: {"crypto": 3.0, "equity": 5.0})
    volatility_k: float = 0.5           # Anteil der Minutenvolatilitaet als Slippage
    half_spread_bps: dict[str, float] = field(default_factory=lambda: {"crypto": 2.0, "equity": 5.0})
    delay: dict[str, timedelta] = field(default_factory=lambda: {"crypto": timedelta(seconds=2), "equity": timedelta(minutes=1)})
    min_fill_ratio: float = 0.5

    # ------------------------------------------------------------------ Konfiguration
    @classmethod
    def from_env(cls) -> ExecutionModel:
        raw = os.environ.get("EXECUTION_CONFIG")
        return cls.from_dict(json.loads(raw)) if raw else cls()

    @classmethod
    def from_dict(cls, d: dict) -> ExecutionModel:
        m = cls()
        fees = {**m.fees, **{k: FeeSchedule(**v) for k, v in d.get("fees", {}).items()}}
        delay = {**m.delay, **{k: timedelta(seconds=v) for k, v in d.get("delay_seconds", {}).items()}}
        return replace(m, mode=d.get("mode", m.mode), slippage_model=d.get("slippage_model", m.slippage_model), fees=fees,
                       fixed_slippage_bps={**m.fixed_slippage_bps, **d.get("fixed_slippage_bps", {})},
                       volatility_k=d.get("volatility_k", m.volatility_k),
                       half_spread_bps={**m.half_spread_bps, **d.get("half_spread_bps", {})}, delay=delay,
                       min_fill_ratio=d.get("min_fill_ratio", m.min_fill_ratio))

    def describe(self) -> dict:
        d = asdict(self)
        d["delay"] = {k: v.total_seconds() for k, v in self.delay.items()}
        return d

    # ------------------------------------------------------------------ Kosten
    def venue_for(self, group: str, source_id: str | None) -> str:
        return "us_equity" if group == "equity" else (source_id if source_id in self.fees else "binance")

    def slippage_bps(self, group: str, vol_1m_bps: float | None) -> float:
        if self.mode == "idealized":
            return 0.0
        base = self.fixed_slippage_bps[group]
        if self.slippage_model in ("volatility", "orderbook") and vol_1m_bps is not None and math.isfinite(vol_1m_bps):
            return base + self.volatility_k * vol_1m_bps
        return base

    def cost(self, group: str, *, venue: str | None = None, liquidity: Literal["taker", "maker"] = "taker",
             vol_1m_bps: float | None = None) -> CostModel:
        if self.mode == "idealized":
            return CostModel(fee_bps=0.0, slippage_bps=0.0, half_spread_bps=0.0, delay=timedelta(0))
        fee = self.fees[self.venue_for(group, venue)]
        return CostModel(fee_bps=fee.taker_bps if liquidity == "taker" else fee.maker_bps,
                         slippage_bps=self.slippage_bps(group, vol_1m_bps), half_spread_bps=self.half_spread_bps[group],
                         delay=self.delay[group])

    # ------------------------------------------------------------------ Ausfuehrung
    def market_fill(self, side, quantity: float, *, book: OrderBook | None, bid: float | None, ask: float | None, at: datetime,
                    venue: str | None, vol_1m_bps: float | None) -> Fill | None:
        if self.mode == "idealized":
            if bid is None or ask is None:
                if book is None or not book.bids or not book.asks:
                    return None
                bid, ask = book.bids[0][0], book.asks[0][0]
            mid = (bid + ask) / 2
            return Fill(mid, quantity, 0.0, 0.0, bid, ask, "quote", at)
        cost = self.cost("crypto", venue=venue, vol_1m_bps=vol_1m_bps)
        use_book = book if self.slippage_model == "orderbook" else None
        return crypto_market_fill(side, quantity, use_book, bid, ask, at, cost, min_fill_ratio=self.min_fill_ratio)

    def open_fill(self, side, quantity: float, bar: Bar) -> Fill:
        cost = self.cost("equity")
        return equity_open_fill(side, quantity, bar, cost)

    def exit(self, side: str, quantity: float, ev: ExitEvent, group: str, venue: str | None = None, vol_1m_bps: float | None = None) -> Fill:
        # Ziel = ruhende Limit-Order (Maker), Stop/Zeitablauf = Market (Taker)
        cost = self.cost(group, venue=venue, liquidity="maker" if ev.reason == "target" else "taker", vol_1m_bps=vol_1m_bps)
        return exit_fill(side, quantity, ev, cost)


def vol_1m_bps_from_annual_pct(annual_pct: float | None) -> float | None:
    """Annualisierte Volatilitaet (%) aus 1-Minuten-Renditen -> Standardabweichung je Minute in bps."""
    if annual_pct is None:
        return None
    return annual_pct / 100 / math.sqrt(525_600) * 1e4


REALISTIC = ExecutionModel()
IDEALIZED = ExecutionModel(mode="idealized")
