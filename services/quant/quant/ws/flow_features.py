"""
Mikrostruktur-Merkmale aus Sekundenzeilen (trade_flow_1s, orderbook_1s, liquidations).

Dieselbe Funktion fuer Live und Replay. Nur Zeilen mit received_at <= as_of
duerfen hineingereicht werden (repo.load_flow sorgt dafuer). Aggregationsfenster
1 s / 5 s / 30 s / 1 min / 5 min verhindern, dass einzelne Trades Signale ausloesen.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import datetime, timedelta
from statistics import median, pstdev

from ..domain import FeatureSet, FeatureValue
from ..freshness import assess

WINDOWS = {"5s": timedelta(seconds=5), "30s": timedelta(seconds=30), "1m": timedelta(minutes=1), "5m": timedelta(minutes=5)}
LIQ_CLUSTER_MIN = 5  # Liquidationen je Minute ab denen von einem Cluster gesprochen wird


def _within(rows: Sequence[dict], as_of: datetime, window: timedelta) -> list[dict]:
    return [r for r in rows if as_of - window <= r["ts"] < as_of]


def add_flow_features(fs: FeatureSet, *, flow: Sequence[dict], book: Sequence[dict], liqs: Sequence[dict],
                      liq_feed_alive_at: datetime | None, source_ids: tuple[str, ...], as_of: datetime) -> None:
    """Ergaenzt fs um Flow-Merkmale; fehlende Daten werden als unavailable gefuehrt, nie geschaetzt."""
    def add(name: str, raw: float | None, fr, note: str | None = None, reliability: str = "medium", ts: datetime | None = None,
            direction: str = "neutral") -> None:
        if raw is None or (isinstance(raw, float) and math.isnan(raw)):
            fs.mark_unavailable(name, note or "Keine WebSocket-Daten im Fenster.")
            return
        fs.add(FeatureValue(name, raw, ts or as_of, source_ids, fr.cls, direction=direction, reliability=reliability,  # type: ignore[arg-type]
                            note=note, data_class=fr.data_class))

    flow = sorted(flow, key=lambda r: r["ts"])
    if flow:
        last_ts = flow[-1]["ts"] + timedelta(seconds=1)
        fr = assess("trade", last_ts, as_of)
        w = {k: _within(flow, as_of, d) for k, d in WINDOWS.items()}
        for k, rows in w.items():
            buy = sum(r["buy_notional"] for r in rows)
            sell = sum(r["sell_notional"] for r in rows)
            tot = buy + sell
            imb = (buy - sell) / tot if tot > 0 else None
            add(f"trade_imbalance_{k}", imb, fr, "(Aggressor-Kauf - Aggressor-Verkauf) / Umsatz",
                direction="bullish" if imb and imb > 0.1 else "bearish" if imb and imb < -0.1 else "neutral")
        add("aggressive_buy_notional_1m", sum(r["buy_notional"] for r in w["1m"]), fr)
        add("aggressive_sell_notional_1m", sum(r["sell_notional"] for r in w["1m"]), fr)
        n1 = sum(r["buy_notional"] + r["sell_notional"] for r in w["1m"])
        n5 = sum(r["buy_notional"] + r["sell_notional"] for r in w["5m"])
        add("volume_acceleration_1m_5m", n1 / (n5 / 5) if n5 > 0 else None, fr, "Umsatz letzte Minute / Minutenschnitt der letzten 5")
        add("max_trade_notional_5m", max((r["max_trade_notional"] for r in w["5m"]), default=None), fr, "Groesster Einzeltrade (5 min)")
        prices = [(r["ts"], r["last_price"]) for r in w["5m"] if r["last_price"]]
        if len(prices) >= 2:
            last = prices[-1][1]
            p30 = next((p for t, p in prices if t >= as_of - timedelta(seconds=30)), None)
            add("price_momentum_30s_pct", (last / p30 - 1) * 100 if p30 else None, fr)
            add("price_momentum_5m_pct", (last / prices[0][1] - 1) * 100, fr)
            rets = [math.log(prices[i][1] / prices[i - 1][1]) for i in range(1, len(prices))]
            recent = [math.log(p2 / p1) for (t1, p1), (t2, p2) in zip(prices, prices[1:]) if t2 >= as_of - timedelta(minutes=1)]
            vol5, vol1 = (pstdev(rets) if len(rets) >= 5 else None), (pstdev(recent) if len(recent) >= 5 else None)
            add("volatility_expansion_1m_5m", vol1 / vol5 if vol1 is not None and vol5 else None, fr,
                "Schwankung 1-s-Renditen letzte Minute / letzte 5 Minuten")
    else:
        fs.mark_unavailable("trade_imbalance_1m", "Kein Trade-Strom (WebSocket) verfuegbar.")

    book = sorted(book, key=lambda r: r["ts"])
    if book:
        cur = book[-1]
        fr = assess("orderbook", cur["ts"] + timedelta(seconds=1), as_of)
        w5 = _within(book, as_of, WINDOWS["5m"])
        add("ob_spread_bps", cur["spread_bps"], fr, ts=cur["ts"])
        add("ob_imbalance_10bps", cur["imbalance_10bps"], fr, "Snapshot des synchronisierten Buchs", "low", cur["ts"])
        imb30 = [r["imbalance_10bps"] for r in _within(book, as_of, WINDOWS["30s"])]
        add("ob_imbalance_30s_avg", sum(imb30) / len(imb30) if imb30 else None, fr)
        depth = cur["depth_bid_10bps"] + cur["depth_ask_10bps"]
        add("ob_depth_10bps", depth, fr, ts=cur["ts"])
        if len(w5) >= 30:
            med_spread = median(r["spread_bps"] for r in w5)
            med_depth = median(r["depth_bid_10bps"] + r["depth_ask_10bps"] for r in w5)
            add("spread_widening", cur["spread_bps"] / med_spread if med_spread > 0 else None, fr, "Spread jetzt / Median 5 min")
            add("depth_collapse", depth / med_depth if med_depth > 0 else None, fr, "Tiefe jetzt / Median 5 min (< 1 = duenner)")
    else:
        fs.mark_unavailable("ob_spread_bps", "Kein synchronisiertes Orderbuch (WebSocket) verfuegbar.")

    if liq_feed_alive_at is not None:
        fr = assess("liquidation_feed", liq_feed_alive_at, as_of)
        l5 = [r for r in liqs if as_of - WINDOWS["5m"] <= r["exchange_time"] and r["received_at"] <= as_of]
        l1 = [r for r in l5 if r["exchange_time"] >= as_of - WINDOWS["1m"]]
        add("liq_long_notional_5m", sum(r["notional"] for r in l5 if r["side"] == "sell"), fr, "Liquidierte LONG-Positionen (5 min)")
        add("liq_short_notional_5m", sum(r["notional"] for r in l5 if r["side"] == "buy"), fr, "Liquidierte SHORT-Positionen (5 min)")
        add("liq_cluster_1m", 1.0 if len(l1) >= LIQ_CLUSTER_MIN else 0.0, fr, f"mind. {LIQ_CLUSTER_MIN} Liquidationen in 1 min")
    else:
        fs.mark_unavailable("liq_long_notional_5m", "Liquidations-Strom nicht verbunden.")
