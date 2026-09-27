"""
Walk-Forward-Vorbereitung: Fenster erzeugen und je Testfenster einen Backtest mit IDENTISCHEN
Parametern laufen lassen. Es wird nichts optimiert - die Trainingsfenster dienen spaeter als
Ort fuer eine Parameterwahl (ParameterSet-Hook), heute nur als Vergleich (Stabilitaet).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from .dataset import HistoricalDataset
from .engine import Backtest, BacktestConfig


@dataclass(frozen=True)
class Window:
    train_start: datetime
    train_end: datetime
    test_start: datetime
    test_end: datetime


def walk_forward_windows(start: datetime, end: datetime, train: timedelta, test: timedelta, step: timedelta | None = None) -> list[Window]:
    """Rollierende Fenster: Train [t, t+train), Test [t+train, t+train+test); danach um `step` (Standard: test) weiter."""
    step = step or test
    out, t = [], start
    while t + train + test <= end:
        out.append(Window(t, t + train, t + train, t + train + test))
        t += step
    return out


def run_walk_forward(ds: HistoricalDataset, base: BacktestConfig, windows: list[Window], admin_url: str,
                     parameter_sets: dict | None = None) -> dict:
    """
    parameter_sets: Platzhalter fuer eine spaetere Parameterwahl JE Trainingsfenster (heute ungenutzt,
    damit die Architektur steht, ohne ueber den Gesamtzeitraum zu optimieren).
    """
    results = []
    for w in windows:
        tr = Backtest(ds, replace(base, start=w.train_start, end=w.train_end)).run(admin_url, keep_database=False).report
        te = Backtest(ds, replace(base, start=w.test_start, end=w.test_end)).run(admin_url, keep_database=False).report
        results.append({"window": {k: v.isoformat() for k, v in w.__dict__.items()}, "train": _summary(tr), "test": _summary(te)})
    return {"windows": results, "parameters": "unveraendert (keine Optimierung)", "stability": _stability(results)}


def _summary(report: dict) -> dict:
    return {sid: {k: s["overall"].get(k) for k in ("trades", "total_return_pct", "expectancy_pct", "sharpe", "max_drawdown_pct")}
            for sid, s in report["strategies"].items()}


def _stability(results: list[dict]) -> dict:
    out: dict[str, dict[str, int]] = {}
    for r in results:
        for sid, m in r["test"].items():
            s = out.setdefault(sid, {"windows": 0, "positive": 0, "trades": 0})
            s["windows"] += 1
            s["trades"] += m.get("trades") or 0
            if (m.get("expectancy_pct") or 0) > 0:
                s["positive"] += 1
    return out
