"""
Aufloesung vergangener Signale (§60): price_1h ... price_20d, MFE, MAE,
Benchmark-Rendite. Das Signal selbst bleibt unveraendert; jede Aufloesung ist
eine eigene, unveraenderliche Zeile. Nur Balken mit ts >= Signalzeit zaehlen.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import psycopg

from .audit import SignalAuditService
from .repo import load_bars

HORIZONS = {"1h": timedelta(hours=1), "1d": timedelta(days=1), "5d": timedelta(days=5), "10d": timedelta(days=10), "20d": timedelta(days=20)}
CALC_VERSION = "outcomes-0.1.0"


def _path_stats(bars, entry: float, direction: str) -> tuple[float | None, float | None]:
    """Maximal guenstige (MFE) und ungueinstige (MAE) Auslenkung in %, aus Sicht der Signalrichtung."""
    if not bars or entry <= 0:
        return None, None
    hi = max(b.high for b in bars) / entry - 1
    lo = min(b.low for b in bars) / entry - 1
    if direction == "short":
        return -lo * 100, -hi * 100
    return hi * 100, lo * 100


def resolve_outcomes(conn: psycopg.Connection, now: datetime, benchmarks: dict[str, str]) -> int:
    """benchmarks: asset-Gruppe ('crypto'|'equity') -> instrument_id der Benchmark."""
    audit = SignalAuditService(conn)
    done = 0
    rows = conn.execute(
        """SELECT s.signal_id, s.created_at, s.instrument_id, s.direction, s.price_at_signal, i.asset_class,
                  ARRAY(SELECT horizon FROM signal_outcomes o WHERE o.signal_id = s.signal_id) AS have
           FROM signals s JOIN instruments i USING (instrument_id)
           WHERE s.price_at_signal IS NOT NULL AND s.created_at >= %s
             AND s.decision IN ('LONG_CANDIDATE','SHORT_CANDIDATE','WATCH','REJECTED_BY_RISK')""",
        (now - timedelta(days=40),),
    ).fetchall()
    for r in rows:
        group = "crypto" if r["asset_class"].startswith("crypto") else "equity"
        tf = "1m" if group == "crypto" else "1d"
        for h, delta in HORIZONS.items():
            if h in r["have"] or r["created_at"] + delta > now:
                continue
            if group == "equity" and h == "1h":
                continue  # Tagesdaten erlauben keine Stundenaufloesung
            end = r["created_at"] + delta
            # Nachtraegliche Aufloesung: alles, was heute bekannt ist (known_at=now) - das Signal selbst bleibt unberuehrt
            path = load_bars(conn, r["instrument_id"], tf, r["created_at"], end, known_at=now)
            path = [b for b in path if b.ts >= r["created_at"]]
            if not path:
                continue
            price = path[-1].close
            entry = r["price_at_signal"]
            sign = 1 if r["direction"] != "short" else -1
            ret = sign * (price / entry - 1) * 100
            mfe, mae = _path_stats(path, entry, "short" if sign < 0 else "long")
            bench_ret = None
            bid = benchmarks.get(group)
            if bid:
                bp = load_bars(conn, bid, tf, r["created_at"], end, known_at=now)
                bp = [b for b in bp if b.ts >= r["created_at"]]
                if len(bp) >= 2:
                    bench_ret = (bp[-1].close / bp[0].open - 1) * 100
            result = "flat" if abs(ret) < 0.05 else ("win" if ret > 0 else "loss")
            if audit.record_outcome(r["signal_id"], h, path[-1].ts, price, ret, mfe_pct=mfe, mae_pct=mae,
                                    benchmark_return_pct=bench_ret, result=result, calc_version=CALC_VERSION):
                done += 1
    return done
