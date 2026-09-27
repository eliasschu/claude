"""Deterministische Test-Provider (nur Tests). Liefern Daten bis zur simulierten Uhrzeit - nie aus der Zukunft."""

import math
from datetime import date, datetime, timedelta, timezone

from quant.providers.base import Bar, FundingRate, NotConfiguredProvider, OpenInterestPoint, OrderBook, PremiumIndex, Quote, Sourced
from quant.providers.registry import Providers


class Clock:
    def __init__(self, t: datetime):
        self.t = t

    def __call__(self) -> datetime:
        return self.t


class FakeCrypto:
    source_id = "binance"

    def __init__(self, clock: Clock, price_fn, buy_share=0.62, perp_buy_share=0.47, oi_growth=0.004, funding=0.0001):
        self.clock, self.price_fn = clock, price_fn
        self.buy_share, self.perp_buy_share, self.oi_growth, self.funding = buy_share, perp_buy_share, oi_growth, funding
        self.calls = 0

    def _minute_bars(self, symbol, limit, start, buy_share, tf="1m"):
        self.calls += 1
        step = timedelta(days=1) if tf == "1d" else timedelta(minutes=1)
        now = self.clock()
        end = now.replace(second=0, microsecond=0) if tf == "1m" else now.replace(hour=0, minute=0, second=0, microsecond=0)
        first = start.replace(second=0, microsecond=0) if start else end - step * (limit - 1)
        bars, t = [], first
        while t <= end and len(bars) < limit:
            p0, p1 = self.price_fn(symbol, t), self.price_fn(symbol, t + step)
            v = 20.0
            bars.append(Bar(ts=t, open=p0, high=max(p0, p1) * 1.0002, low=min(p0, p1) * 0.9998, close=p1, volume=v,
                            is_final=t + step <= now, taker_buy_volume=v * buy_share, quote_volume=v * p1 * 1000, trade_count=100))
            t += step
        return Sourced(bars, self.source_id, now, bars[-1].ts if bars else None, "intraday")

    def spot_bars(self, symbol, timeframe, limit, start=None):
        return self._minute_bars(symbol, limit, start, self.buy_share, timeframe)

    def perp_bars(self, symbol, timeframe, limit, start=None):
        return self._minute_bars(symbol, limit, start, self.perp_buy_share, timeframe)

    def spot_quote(self, symbol):
        p = self.price_fn(symbol, self.clock())
        return Sourced(Quote(p * 0.99999, p * 1.00001, 5, 5, self.clock()), self.source_id, self.clock(), self.clock(), "intraday")

    def spot_order_book(self, symbol, depth):
        p = self.price_fn(symbol, self.clock())
        book = OrderBook([(p * (1 - i * 1e-5), 50.0) for i in range(1, depth)], [(p * (1 + i * 1e-5), 50.0) for i in range(1, depth)], self.clock())
        return Sourced(book, self.source_id, self.clock(), self.clock(), "intraday")

    def premium_index(self, symbol):
        p = self.price_fn(symbol, self.clock())
        return Sourced(PremiumIndex(self.clock(), p * 0.99995, p, self.funding, None), self.source_id, self.clock(), self.clock(), "intraday")

    def funding_history(self, symbol, limit):
        now = self.clock()
        base = now.replace(hour=0, minute=0, second=0, microsecond=0)
        rows = [FundingRate(base - timedelta(hours=8 * i), self.funding * (1 + 0.3 * math.sin(i)), 8.0) for i in range(limit)][::-1]
        return Sourced(rows, self.source_id, now, rows[-1].ts, "event")

    def open_interest_history(self, symbol, period, limit):
        now = self.clock()
        end = now.replace(second=0, microsecond=0) - timedelta(minutes=now.minute % 5 + 5)
        rows = [OpenInterestPoint(end - timedelta(minutes=5 * i), 1000 * (1 + self.oi_growth) ** (limit - i), None) for i in range(limit)][::-1]
        return Sourced(rows, self.source_id, now, rows[-1].ts, "intraday")


class FakeMarket:
    source_id = "stooq"

    def __init__(self, clock: Clock, price_fn, volume_fn=None):
        self.clock, self.price_fn, self.volume_fn = clock, price_fn, volume_fn or (lambda s, d: 2_000_000)

    def bars(self, symbol, timeframe, start: date | None = None):
        today = self.clock().date()
        d = start or today - timedelta(days=800)
        out = []
        while d <= today:
            if d.weekday() < 5:
                c = self.price_fn(symbol, d)
                o = self.price_fn(symbol, d - timedelta(days=1))
                out.append(Bar(ts=datetime(d.year, d.month, d.day, tzinfo=timezone.utc), open=o, high=max(o, c) * 1.005,
                               low=min(o, c) * 0.995, close=c, volume=self.volume_fn(symbol, d), is_final=True))
            d += timedelta(days=1)
        return Sourced(out, self.source_id, self.clock(), out[-1].ts, "end_of_day")


def providers(crypto, market) -> Providers:
    nc = NotConfiguredProvider
    return Providers(market=market, crypto=crypto, fundamentals=nc("sec", "x"), insider=nc("sec", "x"), institutional=nc("sec", "x"),
                     options=nc("o", "x"), macro=nc("fred", "x"), onchain=nc("d", "x"), news=nc("n", "x"))
