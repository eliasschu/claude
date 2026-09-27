"""Synthetische Testreihen - ausschliesslich fuer Tests, nie im Betrieb."""

from datetime import datetime, timedelta, timezone

from quant.providers.base import Bar, FundingRate, OpenInterestPoint

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def daily(closes, volumes=None, start=T0, spread=0.01):
    out = []
    for i, c in enumerate(closes):
        v = volumes[i] if volumes else 1_000_000
        out.append(Bar(ts=start + timedelta(days=i), open=c, high=c * (1 + spread), low=c * (1 - spread), close=c, volume=v, is_final=True))
    return out


def minutes(closes, volumes=None, buy_share=0.5, start=T0):
    out = []
    for i, c in enumerate(closes):
        v = volumes[i] if volumes else 10.0
        out.append(Bar(ts=start + timedelta(minutes=i), open=c, high=c * 1.0005, low=c * 0.9995, close=c, volume=v,
                       is_final=True, taker_buy_volume=v * buy_share, quote_volume=v * c))
    return out


def funding(rates, start=T0, hours=8):
    return [FundingRate(ts=start + timedelta(hours=hours * i), rate=r, interval_hours=hours) for i, r in enumerate(rates)]


def oi(values, start=T0):
    return [OpenInterestPoint(ts=start + timedelta(minutes=5 * i), contracts=v, notional=None) for i, v in enumerate(values)]
