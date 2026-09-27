"""
MarketRegimeEngine v0 (§8/9). Regelbasiert und vollstaendig erklaerbar.

Achsen (unabhaengig voneinander bestimmt):
  Trend        TRENDING_UP | TRENDING_DOWN | RANGE
  Volatilitaet HIGH_VOLATILITY | NORMAL_VOLATILITY | LOW_VOLATILITY  (Perzentil der eigenen Historie)
  Risiko       RISK_ON | RISK_OFF | RISK_NEUTRAL
  Zusatz       NARROW_MARKET / BROAD_MARKET (Aktien, falls Marktbreite berechenbar)
               LEVERAGE_ELEVATED (Krypto, Funding extrem)
Fehlen Daten, lautet das Label INSUFFICIENT_DATA - es wird kein Regime geraten.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta

from .domain import RegimeState
from .features import final_bars, final_equity_bars, percentile_rank, realized_vol_pct, rolling_series, sma
from .providers.base import Bar

REGIME_VERSION = "regime-0.1.0"


def _trend(closes: Sequence[float]) -> tuple[str, dict[str, float | None]]:
    s50, s200 = sma(closes, 50), sma(closes, 200)
    s50_prev = sma(closes[:-20], 50) if len(closes) >= 70 else None
    slope = (s50 / s50_prev - 1) * 100 if s50 and s50_prev else None
    last = closes[-1] if closes else None
    feats = {"close": last, "sma50": s50, "sma200": s200, "sma50_slope_20_pct": slope}
    if s50 is None or s200 is None or slope is None:
        return "INSUFFICIENT_DATA", feats
    assert last is not None  # s50 existiert -> es gibt Schlusskurse
    if last > s50 > s200 and slope > 0:
        return "TRENDING_UP", feats
    if last < s50 < s200 and slope < 0:
        return "TRENDING_DOWN", feats
    return "RANGE", feats


def _volatility(closes: Sequence[float], periods_per_year: float) -> tuple[str, dict[str, float | None]]:
    rv = realized_vol_pct(closes, 20, periods_per_year)
    hist = rolling_series(closes[-272:], lambda c: realized_vol_pct(c, 20, periods_per_year), 20)
    pct = percentile_rank(rv, hist[:-1]) if rv is not None else None
    feats = {"realized_vol_20_pct": rv, "realized_vol_percentile": pct}
    if pct is None:
        return "INSUFFICIENT_DATA", feats
    return ("HIGH_VOLATILITY" if pct >= 80 else "LOW_VOLATILITY" if pct <= 20 else "NORMAL_VOLATILITY"), feats


def _risk(trend: str, vol: str, breadth: float | None) -> str:
    if trend == "INSUFFICIENT_DATA" or vol == "INSUFFICIENT_DATA":
        return "INSUFFICIENT_DATA"
    if trend == "TRENDING_DOWN" or (vol == "HIGH_VOLATILITY" and (breadth is None or breadth < 40)):
        return "RISK_OFF"
    if trend == "TRENDING_UP" and vol != "HIGH_VOLATILITY" and (breadth is None or breadth >= 55):
        return "RISK_ON"
    return "RISK_NEUTRAL"


TEXT = {
    "TRENDING_UP": "Aufwärtstrend (Kurs über 50- und 200-Tage-Schnitt, 50-Tage-Schnitt steigt)",
    "TRENDING_DOWN": "Abwärtstrend (Kurs unter 50- und 200-Tage-Schnitt, 50-Tage-Schnitt fällt)",
    "RANGE": "kein klarer Trend",
    "HIGH_VOLATILITY": "Schwankung im oberen Fünftel der letzten zwölf Monate",
    "LOW_VOLATILITY": "Schwankung im unteren Fünftel der letzten zwölf Monate",
    "NORMAL_VOLATILITY": "normale Schwankung",
    "RISK_ON": "risikofreudiges Umfeld",
    "RISK_OFF": "risikoscheues Umfeld",
    "RISK_NEUTRAL": "gemischtes Umfeld",
    "BROAD_MARKET": "breite Beteiligung (Mehrheit der beobachteten Werte über dem 50-Tage-Schnitt)",
    "NARROW_MARKET": "schmale Beteiligung (Minderheit der beobachteten Werte über dem 50-Tage-Schnitt)",
    "LEVERAGE_ELEVATED": "Hebel am Derivatemarkt erhöht (Funding im oberen/unteren Extrembereich)",
    "INSUFFICIENT_DATA": "Datenlage reicht für eine Einordnung nicht aus",
}


def equity_regime(benchmark_daily: Sequence[Bar], universe_daily: dict[str, Sequence[Bar]], as_of: datetime) -> RegimeState:
    bars = final_equity_bars(benchmark_daily, as_of)
    closes = [b.close for b in bars]
    trend, tf = _trend(closes)
    vol, vf = _volatility(closes, 252)
    above = []
    for series in universe_daily.values():
        c = [b.close for b in final_equity_bars(series, as_of)]
        s = sma(c, 50)
        if s is not None:
            above.append(c[-1] > s)
    breadth = sum(above) / len(above) * 100 if len(above) >= 8 else None
    labels = [trend, vol, _risk(trend, vol, breadth)]
    if breadth is not None:
        labels.append("BROAD_MARKET" if breadth >= 60 else "NARROW_MARKET" if breadth <= 40 else "")
    labels = [lab for lab in dict.fromkeys(labels) if lab]
    feats = {**tf, **vf, "breadth_above_sma50_pct": breadth, "breadth_universe_size": float(len(above))}
    note = "" if breadth is not None else " Marktbreite nicht berechnet (weniger als 8 Werte mit Historie)."
    return RegimeState("equity_us", tuple(labels), "; ".join(TEXT[lab] for lab in labels) + "." + note, feats, REGIME_VERSION, as_of)


def crypto_regime(btc_daily: Sequence[Bar], funding_z: float | None, as_of: datetime) -> RegimeState:
    bars = final_bars(btc_daily, as_of, timedelta(days=1))
    closes = [b.close for b in bars]
    trend, tf = _trend(closes)
    vol, vf = _volatility(closes, 365)
    labels = [trend, vol, _risk(trend, vol, None)]
    if funding_z is not None and abs(funding_z) >= 2:
        labels.append("LEVERAGE_ELEVATED")
    labels = list(dict.fromkeys(labels))
    feats = {**tf, **vf, "btc_funding_zscore": funding_z}
    return RegimeState("crypto", tuple(labels), "; ".join(TEXT[lab] for lab in labels) + ".", feats, REGIME_VERSION, as_of)
