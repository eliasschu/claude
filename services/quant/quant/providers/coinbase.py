"""
Coinbase Exchange Market Data (nur Spot). Zweiter Handelsplatz fuer
Cross-Exchange-Vergleiche und Rueckfall, wo Binance regional gesperrt ist.
Coinbase liefert in Kerzen kein Aggressor-Volumen - CVD daher nur aus Trades.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .base import Bar, NotConfiguredError, OrderBook, ProviderError, Quote, Sourced, Timeframe
from .http import HttpSource, Transport

BASE = "https://api.exchange.coinbase.com"
GRANULARITY = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400}


def product_id(symbol: str) -> str:
    """BTCUSDT/BTCUSD -> BTC-USD (Coinbase notiert gegen USD)."""
    s = symbol.upper().replace("-", "")
    for quote in ("USDT", "USDC", "USD"):
        if s.endswith(quote):
            return f"{s[: -len(quote)]}-USD"
    raise ProviderError("coinbase", "not_found", f"Unbekanntes Symbol {symbol}")


def parse_candles(raw: Any, granularity_s: int, now: datetime) -> list[Bar]:
    """[[time, low, high, open, close, volume], ...] neueste zuerst."""
    bars = []
    for t, low, high, open_, close, vol in raw:
        ts = datetime.fromtimestamp(int(t), tz=timezone.utc)
        bars.append(Bar(ts=ts, open=float(open_), high=float(high), low=float(low), close=float(close), volume=float(vol),
                        is_final=(ts.timestamp() + granularity_s) <= now.timestamp()))
    return sorted(bars, key=lambda b: b.ts)


def parse_ticker(raw: dict[str, Any]) -> Quote:
    ts = raw.get("time")
    return Quote(bid=float(raw["bid"]), ask=float(raw["ask"]), bid_size=None, ask_size=None,
                 ts=datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None)


def parse_book(raw: dict[str, Any], observed: datetime) -> OrderBook:
    return OrderBook(bids=[(float(p), float(q)) for p, q, *_ in raw["bids"]],
                     asks=[(float(p), float(q)) for p, q, *_ in raw["asks"]], ts=observed)


class CoinbaseProvider:
    source_id = "coinbase"

    def __init__(self, transport: Transport | None = None):
        self._http = HttpSource(self.source_id, transport, min_interval_s=0.15)

    def spot_bars(self, symbol: str, timeframe: Timeframe, limit: int, start: datetime | None = None) -> Sourced[list[Bar]]:
        g = GRANULARITY.get(timeframe)
        if not g:
            raise ProviderError(self.source_id, "invalid", f"Zeitraster {timeframe} nicht verfuegbar")
        params: dict[str, Any] = {"granularity": g}
        if start is not None:  # Coinbase: hoechstens 300 Kerzen je Abruf
            params["start"] = start.isoformat()
            params["end"] = datetime.fromtimestamp(start.timestamp() + g * min(limit, 300), tz=timezone.utc).isoformat()
        resp, fetched = self._http.get(f"{BASE}/products/{product_id(symbol)}/candles", params)
        bars = parse_candles(resp.json(), g, fetched)[-limit:]
        final = [b for b in bars if b.is_final]
        return Sourced(bars, self.source_id, fetched, final[-1].ts if final else None, "intraday")

    def spot_quote(self, symbol: str) -> Sourced[Quote]:
        resp, fetched = self._http.get(f"{BASE}/products/{product_id(symbol)}/ticker")
        q = parse_ticker(resp.json())
        return Sourced(q, self.source_id, fetched, q.ts or fetched, "intraday")

    def spot_order_book(self, symbol: str, depth: int) -> Sourced[OrderBook]:
        resp, fetched = self._http.get(f"{BASE}/products/{product_id(symbol)}/book", {"level": 2})
        book = parse_book(resp.json(), fetched)
        return Sourced(OrderBook(book.bids[:depth], book.asks[:depth], book.ts), self.source_id, fetched, fetched, "intraday")

    def _no_derivatives(self, *_a, **_k):
        raise NotConfiguredError(self.source_id, "Coinbase Exchange liefert hier keine Perpetual-Daten.")

    perp_bars = premium_index = funding_history = open_interest_history = _no_derivatives
