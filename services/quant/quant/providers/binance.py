"""
Binance Market Data (Spot + USD-M Perpetuals) als CryptoMarketProvider.

Nur oeffentliche Marktdaten-Endpunkte, keine Konten- oder Orderfunktionen.
Hinweis: Binance sperrt Zugriffe aus einigen Regionen (HTTP 451/403). Der
Server-Standort muss das erlauben; sonst meldet der Provider not_configured.
Liquidationen gibt es nur als Websocket-Strom (!forceOrder@arr) - im MVP
noch nicht angebunden.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .base import Bar, FundingRate, OpenInterestPoint, OrderBook, PremiumIndex, ProviderError, Quote, Sourced, Timeframe
from .http import HttpSource, Transport, ms_to_dt

SPOT = "https://api.binance.com"
FUTURES = "https://fapi.binance.com"


def parse_klines(raw: Any, now: datetime) -> list[Bar]:
    """[openTime, o, h, l, c, v, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote, ignore]"""
    if not isinstance(raw, list):
        raise ValueError("klines: Liste erwartet")
    bars: list[Bar] = []
    for k in raw:
        close_time = ms_to_dt(k[6])
        bars.append(Bar(
            ts=ms_to_dt(k[0]), open=float(k[1]), high=float(k[2]), low=float(k[3]), close=float(k[4]),
            volume=float(k[5]), quote_volume=float(k[7]), trade_count=int(k[8]), taker_buy_volume=float(k[9]),
            # Der letzte Balken ist noch offen, solange seine Schlusszeit in der Zukunft liegt.
            is_final=close_time < now,
        ))
    return bars


def parse_book_ticker(raw: dict[str, Any], observed: datetime) -> Quote:
    return Quote(bid=float(raw["bidPrice"]), ask=float(raw["askPrice"]), bid_size=float(raw["bidQty"]),
                 ask_size=float(raw["askQty"]), ts=observed)


def parse_depth(raw: dict[str, Any], observed: datetime) -> OrderBook:
    return OrderBook(
        bids=[(float(p), float(q)) for p, q in raw["bids"]],
        asks=[(float(p), float(q)) for p, q in raw["asks"]],
        ts=observed,
    )


def parse_premium_index(raw: dict[str, Any]) -> PremiumIndex:
    nft = int(raw.get("nextFundingTime") or 0)
    return PremiumIndex(
        ts=ms_to_dt(raw["time"]), mark_price=float(raw["markPrice"]), index_price=float(raw["indexPrice"]),
        last_funding_rate=float(raw["lastFundingRate"]), next_funding_time=ms_to_dt(nft) if nft else None,
    )


def parse_funding(raw: Any) -> list[FundingRate]:
    rows = sorted(raw, key=lambda r: int(r["fundingTime"]))
    out: list[FundingRate] = []
    for i, r in enumerate(rows):
        ts = ms_to_dt(r["fundingTime"])
        # Intervall aus dem Abstand ableiten (8 h Standard, einige Kontrakte 4 h oder 1 h)
        interval = (ts - ms_to_dt(rows[i - 1]["fundingTime"])).total_seconds() / 3600 if i > 0 else 8.0
        mark = r.get("markPrice")
        out.append(FundingRate(ts=ts, rate=float(r["fundingRate"]), interval_hours=round(interval, 2) or 8.0,
                               mark_price=float(mark) if mark not in (None, "") else None))
    return out


def parse_oi_hist(raw: Any) -> list[OpenInterestPoint]:
    return sorted(
        (OpenInterestPoint(ts=ms_to_dt(r["timestamp"]), contracts=float(r["sumOpenInterest"]),
                           notional=float(r["sumOpenInterestValue"])) for r in raw),
        key=lambda p: p.ts,
    )


class BinanceProvider:
    source_id = "binance"

    def __init__(self, transport: Transport | None = None):
        # Gewichtslimits: grosszuegig drosseln, 4 Abrufe je Sekunde
        self._http = HttpSource(self.source_id, transport, min_interval_s=0.25)

    def _json(self, base: str, path: str, params: dict[str, Any]) -> tuple[Any, datetime]:
        resp, fetched = self._http.get(f"{base}{path}", params)
        try:
            return resp.json(), fetched
        except ValueError as exc:
            raise ProviderError(self.source_id, "invalid", "Antwort ist kein JSON") from exc

    def _bars(self, base: str, path: str, symbol: str, timeframe: Timeframe, limit: int, start: datetime | None) -> Sourced[list[Bar]]:
        params: dict[str, Any] = {"symbol": symbol, "interval": timeframe, "limit": min(limit, 1000)}
        if start is not None:
            params["startTime"] = int(start.timestamp() * 1000)
        raw, fetched = self._json(base, path, params)
        bars = parse_klines(raw, fetched)
        final = [b for b in bars if b.is_final]
        return Sourced(bars, self.source_id, fetched, final[-1].ts if final else None, "intraday")

    def spot_bars(self, symbol: str, timeframe: Timeframe, limit: int, start: datetime | None = None) -> Sourced[list[Bar]]:
        return self._bars(SPOT, "/api/v3/klines", symbol, timeframe, limit, start)

    def perp_bars(self, symbol: str, timeframe: Timeframe, limit: int, start: datetime | None = None) -> Sourced[list[Bar]]:
        return self._bars(FUTURES, "/fapi/v1/klines", symbol, timeframe, limit, start)

    def spot_quote(self, symbol: str) -> Sourced[Quote]:
        raw, fetched = self._json(SPOT, "/api/v3/ticker/bookTicker", {"symbol": symbol})
        # bookTicker liefert keinen Zeitstempel: Zeitpunkt = Antwortzeit der Quelle.
        return Sourced(parse_book_ticker(raw, fetched), self.source_id, fetched, fetched, "intraday")

    def spot_order_book(self, symbol: str, depth: int) -> Sourced[OrderBook]:
        raw, fetched = self._json(SPOT, "/api/v3/depth", {"symbol": symbol, "limit": depth})
        return Sourced(parse_depth(raw, fetched), self.source_id, fetched, fetched, "intraday")

    def premium_index(self, symbol: str) -> Sourced[PremiumIndex]:
        raw, fetched = self._json(FUTURES, "/fapi/v1/premiumIndex", {"symbol": symbol})
        p = parse_premium_index(raw)
        return Sourced(p, self.source_id, fetched, p.ts, "intraday")

    def funding_history(self, symbol: str, limit: int) -> Sourced[list[FundingRate]]:
        raw, fetched = self._json(FUTURES, "/fapi/v1/fundingRate", {"symbol": symbol, "limit": min(limit, 1000)})
        rows = parse_funding(raw)
        return Sourced(rows, self.source_id, fetched, rows[-1].ts if rows else None, "event")

    def open_interest_history(self, symbol: str, period: str, limit: int) -> Sourced[list[OpenInterestPoint]]:
        raw, fetched = self._json(FUTURES, "/futures/data/openInterestHist", {"symbol": symbol, "period": period, "limit": min(limit, 500)})
        rows = parse_oi_hist(raw)
        return Sourced(rows, self.source_id, fetched, rows[-1].ts if rows else None, "intraday")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
