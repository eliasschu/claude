"""Beobachtungsuniversum und Anlage im Security Master. Die interne ID wird einmal vergeben und nie aus dem Ticker zurueckgerechnet."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from .db import Conn
from .repo import ensure_instrument, resolve


@dataclass(frozen=True)
class CryptoPair:
    symbol: str  # Binance-Symbol, z. B. BTCUSDT
    base: str
    quote: str


def parse_pair(symbol: str) -> CryptoPair:
    s = symbol.strip().upper()
    for q in ("USDT", "USDC", "FDUSD", "USD"):
        if s.endswith(q) and len(s) > len(q):
            return CryptoPair(s, s[: -len(q)], q)
    raise ValueError(f"Unbekanntes Paar {symbol}")


def _new_id(*parts: str) -> str:
    return "ins_" + hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def crypto_instrument(conn: Conn, pair: CryptoPair, venue: str = "binance", kind: str = "crypto_spot") -> str:
    scheme_value = pair.symbol if kind == "crypto_spot" else f"{pair.symbol}:PERP"
    existing = resolve(conn, "exchange_symbol", scheme_value, venue)
    if existing:
        return existing
    iid = _new_id(kind, venue, scheme_value)
    ensure_instrument(conn, iid, kind, f"{pair.base}/{pair.quote}{' Perpetual' if kind == 'crypto_perp' else ''}",
                      currency=pair.quote, base_asset=pair.base, quote_asset=pair.quote,
                      identifiers=[("exchange_symbol", scheme_value, venue)])
    return iid


def equity_instrument(conn: Conn, ticker: str, is_etf: bool = False) -> str:
    t = ticker.strip().upper()
    existing = resolve(conn, "ticker", t, "US")
    if existing:
        return existing
    iid = _new_id("us_listing", t)
    ensure_instrument(conn, iid, "etf" if is_etf else "equity", t, currency="USD", identifiers=[("ticker", t, "US")])
    return iid


ETFS = {"SPY", "QQQ", "IWM", "DIA", "URTH", "GLD", "SLV", "XLK", "XLF", "XLE", "SMH"}
