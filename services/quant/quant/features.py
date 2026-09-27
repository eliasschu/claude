"""
FeatureEngine: rechnet aus Rohdaten versionierte Merkmale (FEATURE_VERSION).

Regeln
 * Nur abgeschlossene Balken (is_final) mit ts < as_of fliessen ein - offene
   Balken oder spaetere Werte waeren Look-ahead (§50).
 * Nicht berechenbare Merkmale werden als "unavailable" mit Grund gefuehrt,
   nie mit einem Ersatzwert gefuellt (§88).
 * Intraday-RVOL vergleicht mit derselben Tageszeit an Vortagen (§11).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import fmean, pstdev
from typing import Sequence

from .domain import FeatureSet, FeatureValue
from .freshness import Freshness, classify
from .providers.base import Bar, FundingRate, OpenInterestPoint, OrderBook, PremiumIndex, Quote

# ---------------------------------------------------------------------------
# Reine Kennzahlen
# ---------------------------------------------------------------------------


def final_bars(bars: Sequence[Bar], as_of: datetime, bar_length: timedelta) -> list[Bar]:
    """Nur Balken, die zum Zeitpunkt as_of vollstaendig abgeschlossen waren."""
    return [b for b in bars if b.is_final and b.ts + bar_length <= as_of]


def sma(values: Sequence[float], n: int) -> float | None:
    return fmean(values[-n:]) if len(values) >= n else None


def pct_return(values: Sequence[float], n: int) -> float | None:
    if len(values) <= n or values[-n - 1] <= 0:
        return None
    return (values[-1] / values[-n - 1] - 1) * 100


def true_ranges(bars: Sequence[Bar]) -> list[float]:
    out = []
    for i, b in enumerate(bars):
        if i == 0:
            out.append(b.high - b.low)
        else:
            pc = bars[i - 1].close
            out.append(max(b.high - b.low, abs(b.high - pc), abs(b.low - pc)))
    return out


def atr(bars: Sequence[Bar], n: int = 14) -> float | None:
    tr = true_ranges(bars)
    return fmean(tr[-n:]) if len(tr) > n else None


def realized_vol_pct(closes: Sequence[float], n: int, periods_per_year: float) -> float | None:
    if len(closes) <= n:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(len(closes) - n, len(closes)) if closes[i - 1] > 0 and closes[i] > 0]
    if len(rets) < 2:
        return None
    return pstdev(rets) * math.sqrt(periods_per_year) * 100


def zscore(value: float, history: Sequence[float]) -> float | None:
    if len(history) < 10:
        return None
    sd = pstdev(history)
    return None if sd == 0 else (value - fmean(history)) / sd


def percentile_rank(value: float, history: Sequence[float]) -> float | None:
    if len(history) < 10:
        return None
    below = sum(1 for h in history if h < value)
    equal = sum(1 for h in history if h == value)
    return (below + 0.5 * equal) / len(history) * 100


def rolling_series(closes: Sequence[float], fn, window: int) -> list[float]:
    """Wert von fn fuer jede Teilfolge closes[:k], k ab window+1 - fuer Perzentile gegen die eigene Historie."""
    out = []
    for k in range(window + 1, len(closes) + 1):
        v = fn(closes[:k])
        if v is not None:
            out.append(v)
    return out


def vwap(bars: Sequence[Bar]) -> float | None:
    vol = sum(b.volume for b in bars)
    if vol <= 0:
        return None
    return sum(((b.high + b.low + b.close) / 3) * b.volume for b in bars) / vol


def cvd(bars: Sequence[Bar]) -> float | None:
    """Cumulative Volume Delta aus Aggressor-Kaufvolumen: Kauf - Verkauf."""
    if not bars or any(b.taker_buy_volume is None for b in bars):
        return None
    return sum(2 * b.taker_buy_volume - b.volume for b in bars)  # type: ignore[operator]


def buy_share(bars: Sequence[Bar]) -> float | None:
    vol = sum(b.volume for b in bars)
    if vol <= 0 or any(b.taker_buy_volume is None for b in bars):
        return None
    return sum(b.taker_buy_volume for b in bars) / vol  # type: ignore[misc]


def rvol_time_of_day(bars: Sequence[Bar], window: timedelta, min_days: int = 5, max_days: int = 20) -> tuple[float | None, int]:
    """
    Volumen der letzten `window` im Verhaeltnis zum Volumen im selben
    Tageszeitfenster an Vortagen. Rueckgabe (rvol, Anzahl Vergleichstage).
    """
    if not bars:
        return None, 0
    end = bars[-1].ts + (bars[-1].ts - bars[-2].ts if len(bars) > 1 else timedelta(minutes=1))
    current = sum(b.volume for b in bars if end - window <= b.ts < end)
    history = []
    for d in range(1, max_days + 1):
        e = end - timedelta(days=d)
        vols = [b.volume for b in bars if e - window <= b.ts < e]
        if vols:
            history.append(sum(vols))
    if len(history) < min_days or fmean(history) <= 0:
        return None, len(history)
    return current / fmean(history), len(history)


def book_imbalance(book: OrderBook, within_bps: float) -> tuple[float | None, float | None]:
    """(Imbalance -1..1, Tiefe in Quote-Waehrung) innerhalb +/- within_bps um die Mitte."""
    if not book.bids or not book.asks:
        return None, None
    mid = (book.bids[0][0] + book.asks[0][0]) / 2
    lo, hi = mid * (1 - within_bps / 1e4), mid * (1 + within_bps / 1e4)
    bid_val = sum(p * q for p, q in book.bids if p >= lo)
    ask_val = sum(p * q for p, q in book.asks if p <= hi)
    total = bid_val + ask_val
    return ((bid_val - ask_val) / total if total > 0 else None), total


def _direction(value: float | None, pos: float, neg: float) -> str:
    if value is None:
        return "neutral"
    return "bullish" if value >= pos else "bearish" if value <= neg else "neutral"


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


# ---------------------------------------------------------------------------
# Feature-Saetze
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EquityInputs:
    instrument_id: str
    daily: Sequence[Bar]
    benchmark_daily: Sequence[Bar]
    source_id: str
    as_of: datetime


def equity_features(inp: EquityInputs) -> FeatureSet:
    """Tagesbasierte Merkmale fuer Aktien/ETFs (Swing/Position)."""
    fs = FeatureSet(inp.instrument_id, inp.as_of)
    bars = final_bars(inp.daily, inp.as_of, timedelta(days=1))
    bench = final_bars(inp.benchmark_daily, inp.as_of, timedelta(days=1))
    if len(bars) < 60:
        fs.mark_unavailable("*", f"Zu wenig Tageskerzen ({len(bars)} < 60).")
        return fs
    last = bars[-1]
    fresh = classify(last.ts + timedelta(days=1), "end_of_day", inp.as_of, max_age=timedelta(days=5))
    src = (inp.source_id,)
    closes = [b.close for b in bars]
    vols = [b.volume for b in bars]

    def add(name: str, raw: float | None, *, direction: str = "neutral", strength: float = 0.0, pct: float | None = None,
            z: float | None = None, note: str | None = None, reliability: str = "medium", fr: Freshness = fresh) -> None:
        if raw is None:
            fs.mark_unavailable(name, note or "Nicht berechenbar.")
            return
        fs.add(FeatureValue(name, raw, last.ts, src, fr.cls, pct, z, direction, strength, reliability, note))  # type: ignore[arg-type]

    add("close", last.close)
    add("atr_14", atr(bars, 14))
    atr14 = atr(bars, 14)
    add("atr_pct", atr14 / last.close * 100 if atr14 else None)
    for n in (20, 50, 200):
        s = sma(closes, n)
        add(f"dist_sma{n}_pct", (last.close / s - 1) * 100 if s else None, direction=_direction((last.close / s - 1) if s else None, 0, 0))
    r20 = pct_return(closes, 20)
    r63 = pct_return(closes, 63)
    hist_r20 = rolling_series(closes, lambda c: pct_return(c, 20), 20)
    add("ret_20d_pct", r20, direction=_direction(r20, 2, -2), pct=percentile_rank(r20, hist_r20) if r20 is not None else None,
        strength=_clip01(abs(r20 or 0) / 20))
    add("ret_63d_pct", r63, direction=_direction(r63, 5, -5), strength=_clip01(abs(r63 or 0) / 40))

    # Ausbruch: Schluss ueber dem Hoch der vorangegangenen 20 Tage (Donchian, ohne heutigen Balken)
    prior = bars[-21:-1]
    donchian_high = max(b.high for b in prior)
    donchian_low = min(b.low for b in prior)
    add("donchian20_high", donchian_high)
    add("donchian20_low", donchian_low)
    add("breakout_20d", 1.0 if last.close > donchian_high else 0.0, direction="bullish" if last.close > donchian_high else "neutral",
        strength=_clip01((last.close / donchian_high - 1) * 20) if last.close > donchian_high else 0.0)
    add("breakdown_20d", 1.0 if last.close < donchian_low else 0.0, direction="bearish" if last.close < donchian_low else "neutral")
    add("dist_52w_high_pct", (last.close / max(b.high for b in bars[-252:]) - 1) * 100)

    # Relatives Volumen (Tagesbasis: gegen die 20 Vortage, ohne heute)
    avg20 = fmean(vols[-21:-1])
    rvol = last.volume / avg20 if avg20 > 0 else None
    add("rvol_20d", rvol, direction="neutral", z=zscore(last.volume, vols[-61:-1]), pct=percentile_rank(last.volume, vols[-253:-1]),
        strength=_clip01(((rvol or 1) - 1) / 3), note="Tagesvolumen / Durchschnitt der 20 Vortage")
    dollar_vol = fmean([b.close * b.volume for b in bars[-20:]])
    add("adv_usd_20d", dollar_vol, note="Durchschnittlicher Tagesumsatz in USD (20 Tage)")
    add("realized_vol_20d_pct", realized_vol_pct(closes, 20, 252))
    add("day_return_pct", pct_return(closes, 1))

    # Relative Staerke gegen Benchmark (gleiche Tage)
    if len(bench) >= 64:
        bmap = {b.ts: b.close for b in bench}
        common = [b for b in bars if b.ts in bmap]
        if len(common) >= 64:
            c_own = [b.close for b in common]
            c_b = [bmap[b.ts] for b in common]
            rs20 = pct_return(c_own, 20) - pct_return(c_b, 20)  # type: ignore[operator]
            rs63 = pct_return(c_own, 63) - pct_return(c_b, 63)  # type: ignore[operator]
            add("rel_strength_20d_pp", rs20, direction=_direction(rs20, 2, -2), strength=_clip01(abs(rs20) / 15),
                note="Rendite 20 Tage minus Benchmark, Prozentpunkte")
            add("rel_strength_63d_pp", rs63, direction=_direction(rs63, 4, -4), strength=_clip01(abs(rs63) / 25))
        else:
            fs.mark_unavailable("rel_strength_20d_pp", "Zu wenige gemeinsame Handelstage mit der Benchmark.")
    else:
        fs.mark_unavailable("rel_strength_20d_pp", "Benchmark-Historie fehlt.")
    return fs


@dataclass(frozen=True)
class CryptoInputs:
    instrument_id: str
    spot_1m: Sequence[Bar]
    perp_1m: Sequence[Bar]
    quote: Quote | None
    quote_observed_at: datetime | None
    book: OrderBook | None
    premium: PremiumIndex | None
    funding: Sequence[FundingRate]
    open_interest: Sequence[OpenInterestPoint]
    source_id: str
    as_of: datetime


def crypto_features(inp: CryptoInputs) -> FeatureSet:
    """Intraday-Merkmale fuer Krypto (Spot + Perpetual)."""
    fs = FeatureSet(inp.instrument_id, inp.as_of)
    src = (inp.source_id,)
    spot = final_bars(inp.spot_1m, inp.as_of, timedelta(minutes=1))
    perp = final_bars(inp.perp_1m, inp.as_of, timedelta(minutes=1))
    if len(spot) < 240:
        fs.mark_unavailable("*", f"Zu wenig Minutenbalken Spot ({len(spot)} < 240).")
        return fs
    last = spot[-1]
    bar_fresh = classify(last.ts + timedelta(minutes=1), "intraday", inp.as_of)

    def add(name: str, raw: float | None, fr: Freshness, *, direction: str = "neutral", strength: float = 0.0,
            pct: float | None = None, z: float | None = None, note: str | None = None, reliability: str = "medium", ts: datetime | None = None) -> None:
        if raw is None:
            fs.mark_unavailable(name, note or "Nicht berechenbar.")
            return
        fs.add(FeatureValue(name, raw, ts or last.ts, src, fr.cls, pct, z, direction, strength, reliability, note))  # type: ignore[arg-type]

    closes = [b.close for b in spot]
    add("close", last.close, bar_fresh)
    for mins in (15, 60, 240):
        r = pct_return(closes, mins)
        add(f"ret_{mins}m_pct", r, bar_fresh, direction=_direction(r, 0.3, -0.3), strength=_clip01(abs(r or 0) / 3))
    hist_60 = rolling_series(closes[-1440:], lambda c: pct_return(c, 60), 60)
    r60 = pct_return(closes, 60)
    if r60 is not None:
        fs.values["ret_60m_pct"] = FeatureValue("ret_60m_pct", r60, last.ts, src, bar_fresh.cls,
                                                percentile_rank(r60, hist_60), zscore(r60, hist_60), _direction(r60, 0.3, -0.3),  # type: ignore[arg-type]
                                                _clip01(abs(r60) / 3), "medium")
    add("realized_vol_60m_pct", realized_vol_pct(closes, 60, 525_600), bar_fresh, note="annualisiert, 1-Minuten-Renditen")
    atr60 = atr(spot[-61:], 60)
    add("atr_1m_60", atr60, bar_fresh)
    w60 = spot[-60:]
    vw = vwap(w60)
    add("vwap_60m", vw, bar_fresh)
    add("dist_vwap_60m_pct", (last.close / vw - 1) * 100 if vw else None, bar_fresh)
    c = cvd(w60)
    vol60 = sum(b.volume for b in w60)
    add("spot_cvd_60m_share", c / vol60 if c is not None and vol60 > 0 else None, bar_fresh,
        direction=_direction(c / vol60 if c is not None and vol60 else None, 0.05, -0.05),
        strength=_clip01(abs(c / vol60) * 5) if c is not None and vol60 else 0.0,
        note="(Aggressor-Kauf - Aggressor-Verkauf) / Volumen, 60 Minuten")
    add("spot_buy_share_60m", buy_share(w60), bar_fresh)
    rv, days = rvol_time_of_day(spot, timedelta(minutes=60))
    add("rvol_tod_60m", rv, bar_fresh, strength=_clip01(((rv or 1) - 1) / 3),
        note=f"gegen dasselbe Tageszeitfenster an {days} Vortagen" if rv is not None else f"Nur {days} Vergleichstage (mind. 5 noetig).")
    add("quote_volume_24h", sum((b.quote_volume or b.close * b.volume) for b in spot[-1440:]), bar_fresh)

    # Handelsplatz-Mikrostruktur
    if inp.quote is not None:
        qf = classify(inp.quote_observed_at, "intraday", inp.as_of)
        add("spread_bps", inp.quote.spread_bps, qf, ts=inp.quote_observed_at)
    else:
        fs.mark_unavailable("spread_bps", "Kein Bid/Ask verfuegbar.")
    if inp.book is not None and inp.book.ts is not None:
        imb, depth = book_imbalance(inp.book, 10)
        bf = classify(inp.book.ts, "intraday", inp.as_of)
        add("book_imbalance_10bps", imb, bf, ts=inp.book.ts, note="Snapshot; einzeln wenig aussagekraeftig", reliability="low")
        add("book_depth_10bps_quote", depth, bf, ts=inp.book.ts)
    else:
        fs.mark_unavailable("book_depth_10bps_quote", "Kein Orderbuch verfuegbar.")

    # Derivate
    if len(perp) >= 60:
        pw = perp[-60:]
        pc = cvd(pw)
        pvol = sum(b.volume for b in pw)
        add("perp_cvd_60m_share", pc / pvol if pc is not None and pvol > 0 else None, bar_fresh,
            direction=_direction(pc / pvol if pc is not None and pvol else None, 0.05, -0.05))
    else:
        fs.mark_unavailable("perp_cvd_60m_share", "Zu wenig Perpetual-Balken.")
    if inp.premium is not None:
        pf = classify(inp.premium.ts, "intraday", inp.as_of)
        basis = (inp.premium.mark_price / inp.premium.index_price - 1) * 1e4 if inp.premium.index_price > 0 else None
        add("perp_basis_bps", basis, pf, ts=inp.premium.ts, note="Mark-Preis gegen Index-Preis (Spot-Korb)")
    else:
        fs.mark_unavailable("perp_basis_bps", "Kein Premium-Index verfuegbar.")
    fund = [f for f in inp.funding if f.ts <= inp.as_of]
    if len(fund) >= 10:
        rates = [f.rate for f in fund]
        latest = fund[-1]
        ff = classify(latest.ts, "event", inp.as_of, max_age=timedelta(hours=latest.interval_hours * 2 + 1))
        # auf 8 Stunden normiert, damit Kontrakte mit 1-h/4-h-Intervall vergleichbar sind
        rate8h = latest.rate * 8 / latest.interval_hours
        add("funding_rate_8h", rate8h, ff, z=zscore(latest.rate, rates[:-1]), pct=percentile_rank(latest.rate, rates[:-1]),
            ts=latest.ts, direction="neutral", note="Positiv: Long zahlt Short. Allein weder bullish noch bearish.")
    else:
        fs.mark_unavailable("funding_rate_8h", "Zu wenige Funding-Werte.")
    oi = [p for p in inp.open_interest if p.ts <= inp.as_of]
    if len(oi) >= 13:
        of = classify(oi[-1].ts + timedelta(minutes=5), "intraday", inp.as_of)
        ch = (oi[-1].contracts / oi[-13].contracts - 1) * 100 if oi[-13].contracts > 0 else None
        add("oi_change_60m_pct", ch, of, ts=oi[-1].ts, strength=_clip01(abs(ch or 0) / 10))
    else:
        fs.mark_unavailable("oi_change_60m_pct", "Zu wenige Open-Interest-Werte (5-Minuten-Raster, 13 noetig).")
    return fs
