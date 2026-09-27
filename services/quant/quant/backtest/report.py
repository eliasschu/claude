"""
Strukturierter Backtest-Report je Strategie - mit Benchmark, Train/Validation/Out-of-Sample
und Warnungen. Keine Strategie wird wegen hoher Rendite als "gut" markiert; der Report
nennt Stichprobengroesse und Schwaechen ausdruecklich.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from statistics import fmean, median, pstdev

from ..db import Conn, one
from ..strategies import StrategyRegistry

MIN_TRADES = 30
MIN_TRADES_FOR_RATIOS = 5
PERIODS_PER_YEAR = {"crypto": 365, "equity_us": 252}


# ------------------------------------------------------------------------------------ Rohdaten
def load_trades(conn: Conn) -> list[dict]:
    """Jeder abgeschlossene Trade mit Signal, Kosten und Ergebnis."""
    rows = conn.execute(
        """SELECT p.position_id, p.signal_id, s.strategy_id, s.strategy_version, p.instrument_id, i.name AS instrument, p.side, p.quantity,
                  p.opened_at AS entry_time, p.entry_price, p.closed_at AS exit_time, p.exit_price, p.exit_reason, p.realized_pnl AS pnl,
                  s.signal_strength, s.market_regime->'labels' AS regime, s.created_at AS signal_time, s.price_at_signal,
                  COALESCE((SELECT sum(f.fee) FROM paper_orders o JOIN paper_fills f USING (order_id) WHERE o.position_id=p.position_id), 0) AS fees,
                  COALESCE((SELECT sum(f.slippage_bps / 1e4 * f.price * f.quantity) FROM paper_orders o JOIN paper_fills f USING (order_id)
                            WHERE o.position_id=p.position_id), 0) AS slippage_cost
           FROM paper_positions p JOIN signals s USING (signal_id) JOIN instruments i ON i.instrument_id = p.instrument_id
           WHERE p.closed_at IS NOT NULL ORDER BY p.closed_at""").fetchall()
    for r in rows:
        r["notional"] = r["entry_price"] * r["quantity"]
        r["return_pct"] = r["pnl"] / r["notional"] * 100 if r["notional"] else 0.0
        r["holding_s"] = (r["exit_time"] - r["entry_time"]).total_seconds()
    return rows


def benchmark_return(conn: Conn, symbol: str, scope: str, start: datetime, end: datetime) -> dict | None:
    from ..repo import load_bars, resolve
    iid = resolve(conn, "exchange_symbol", symbol, "binance") if scope == "crypto" else resolve(conn, "ticker", symbol, "US")
    if not iid:
        return None
    tf = "1m" if scope == "crypto" else "1d"
    bars = load_bars(conn, iid, tf, start - timedelta(days=5 if tf == "1d" else 0), end, known_at=end)
    before = [b for b in bars if b.ts <= start]
    first = before[-1] if before else (bars[0] if bars else None)
    if not bars or first is None:
        return None
    return {"symbol": symbol, "start_price": first.close, "end_price": bars[-1].close,
            "return_pct": (bars[-1].close / first.close - 1) * 100, "method": "buy & hold, Schlusskurse"}


# ------------------------------------------------------------------------------------ Kennzahlen
def trade_metrics(trades: list[dict], *, start: datetime, end: datetime, capital: float, periods_per_year: int) -> dict:
    n = len(trades)
    days = max((end - start).total_seconds() / 86400, 1e-9)
    base = {"trades": n, "period_days": round(days, 2)}
    if n == 0:
        return {**base, "note": "keine abgeschlossenen Trades"}
    pnl = [t["pnl"] for t in trades]
    rets = [t["return_pct"] for t in trades]
    wins = [p for p in pnl if p > 0]
    losses = [p for p in pnl if p <= 0]
    total = sum(pnl)
    total_ret = total / capital * 100
    # Taegliche Rendite aus realisierten Ergebnissen (Kapitalbasis: Startkapital)
    by_day: dict = {}
    for t in trades:
        by_day[t["exit_time"].date()] = by_day.get(t["exit_time"].date(), 0.0) + t["pnl"]
    d0 = start.date()
    daily = [by_day.get(d0 + timedelta(days=i), 0.0) / capital for i in range(int(math.ceil(days)) + 1)]
    mean_d, sd_d = fmean(daily), pstdev(daily)
    downside = [min(0.0, x) for x in daily]
    dd_sd = math.sqrt(fmean([x * x for x in downside])) if downside else 0.0
    equity, peak, max_dd = 1.0, 1.0, 0.0
    for x in daily:
        equity *= 1 + x
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1)
    annual = ((1 + total_ret / 100) ** (365 / days) - 1) * 100 if total_ret > -100 else -100.0
    avg_win = fmean(wins) if wins else None
    avg_loss = fmean(losses) if losses else None
    exposure = sum(t["holding_s"] for t in trades) / (days * 86400)
    turnover = sum(t["notional"] * 2 for t in trades) / capital
    enough = n >= MIN_TRADES_FOR_RATIOS  # Risikokennzahlen aus 1-4 Trades waeren Scheingenauigkeit
    return {
        **base,
        "total_return_pct": total_ret, "annualized_return_pct": annual,
        "sharpe": mean_d / sd_d * math.sqrt(periods_per_year) if sd_d > 0 and enough else None,
        "sortino": mean_d / dd_sd * math.sqrt(periods_per_year) if dd_sd > 0 and enough else None,
        "max_drawdown_pct": max_dd * 100, "calmar": annual / abs(max_dd * 100) if max_dd < 0 and enough else None,
        "ratios_note": None if enough else f"Sharpe/Sortino/Calmar erst ab {MIN_TRADES_FOR_RATIOS} Trades",
        "win_rate": len(wins) / n, "profit_factor": sum(wins) / -sum(losses) if losses and sum(losses) < 0 else None,
        "expectancy": total / n, "expectancy_pct": fmean(rets), "average_win": avg_win, "average_loss": avg_loss,
        "payoff_ratio": avg_win / -avg_loss if avg_win is not None and avg_loss and avg_loss < 0 else None,
        "exposure_time_pct": exposure * 100, "turnover": turnover,
        "fees_paid": sum(t["fees"] for t in trades), "slippage_cost": sum(t["slippage_cost"] for t in trades),
        "total_pnl": total, "exit_reasons": {r: sum(1 for t in trades if t["exit_reason"] == r) for r in {t["exit_reason"] for t in trades}},
    }


def forward_returns(conn: Conn, strategy_id: str) -> dict:
    """Vorwaertsrenditen aller Kandidaten der Strategie je Horizont (unabhaengig davon, ob gehandelt wurde)."""
    rows = conn.execute(
        """SELECT o.horizon, o.return_pct, o.mfe_pct, o.mae_pct, o.benchmark_return_pct, s.decision FROM signal_outcomes o
           JOIN signals s USING (signal_id) WHERE s.strategy_id=%s AND s.decision IN ('LONG_CANDIDATE','SHORT_CANDIDATE','REJECTED_BY_RISK')""",
        (strategy_id,)).fetchall()
    out = {}
    for h in ("1h", "4h", "1d", "3d", "7d", "30d"):
        rs = [r for r in rows if r["horizon"] == h]
        if not rs:
            continue
        vals = [r["return_pct"] for r in rs]
        bench = [r["return_pct"] - r["benchmark_return_pct"] for r in rs if r["benchmark_return_pct"] is not None]
        out[h] = {"n": len(rs), "mean_pct": fmean(vals), "median_pct": median(vals), "hit_rate": sum(1 for v in vals if v > 0) / len(vals),
                  "mean_excess_vs_benchmark_pct": fmean(bench) if bench else None,
                  "avg_mfe_pct": fmean([r["mfe_pct"] for r in rs if r["mfe_pct"] is not None] or [0]),
                  "avg_mae_pct": fmean([r["mae_pct"] for r in rs if r["mae_pct"] is not None] or [0])}
    return out


def _mfe_mae(conn: Conn, strategy_id: str) -> dict:
    """Maximale guenstige/unguenstige Auslenkung je Handelsidee (Shadow-Ausfuehrung, inkl. abgelehnter Ideen)."""
    r = one(conn.execute("""SELECT count(*) AS n, avg(o.mfe_pct) AS mfe, avg(o.mae_pct) AS mae FROM shadow_outcomes o
                        JOIN shadow_executions x USING (shadow_id) WHERE x.strategy_id=%s AND o.mfe_pct IS NOT NULL""", (strategy_id,)))
    return {"n": r["n"], "avg_mfe_pct": r["mfe"], "avg_mae_pct": r["mae"]}


def segments(start: datetime, end: datetime, splits: tuple[float, float, float]) -> dict[str, tuple[datetime, datetime]]:
    total = end - start
    a = start + total * splits[0]
    b = a + total * splits[1]
    return {"train": (start, a), "validation": (a, b), "out_of_sample": (b, end)}


# ------------------------------------------------------------------------------------ Warnungen
def warnings_for(strategy_spec, overall: dict, by_segment: dict[str, dict], cfg, evaluations: int, candidates: int) -> list[str]:
    w = []
    if overall.get("trades", 0) < MIN_TRADES:
        w.append(f"Zu wenige Trades ({overall.get('trades', 0)} < {MIN_TRADES}) - Kennzahlen statistisch nicht belastbar.")
    min_days = 30 if strategy_spec.time_horizon == "intraday" else 365
    if overall.get("period_days", 0) < min_days:
        w.append(f"Zu kurzer Zeitraum ({overall.get('period_days', 0):.0f} Tage < {min_days}) fuer Horizont {strategy_spec.time_horizon}.")
    params = len(strategy_spec.entry_conditions) + len(strategy_spec.rejection_conditions)
    if params >= 8:
        w.append(f"Viele Bedingungen/Parameter ({params}) - erhoehtes Risiko der Ueberanpassung.")
    if evaluations and candidates / evaluations < 0.001:
        w.append(f"Extrem schmale Bedingungen: nur {candidates} Kandidaten bei {evaluations} Auswertungen.")
    tr, oos = by_segment.get("train", {}), by_segment.get("out_of_sample", {})
    if tr.get("trades") and oos.get("trades"):
        e_tr, e_oos = tr.get("expectancy_pct", 0), oos.get("expectancy_pct", 0)
        if (e_tr > 0) != (e_oos > 0):
            w.append(f"Train und Out-of-Sample widersprechen sich (Erwartungswert je Trade {e_tr:.2f} % vs. {e_oos:.2f} %).")
        s_tr, s_oos = tr.get("sharpe"), oos.get("sharpe")
        if s_tr is not None and s_oos is not None and abs(s_tr - s_oos) > 1.0:
            w.append(f"Grosser Unterschied der Sharpe Ratio Train vs. Out-of-Sample ({s_tr:.2f} vs. {s_oos:.2f}).")
    elif not oos.get("trades"):
        w.append("Keine Out-of-Sample-Trades - die Strategie ist ausserhalb der Trainingsperiode nicht belegt.")
    return w


# ------------------------------------------------------------------------------------ Report
def build_report(conn: Conn, cfg, *, cycles: int) -> dict:
    registry = StrategyRegistry()
    group = "crypto" if cfg.scope == "crypto" else "equity"
    ppy = PERIODS_PER_YEAR[cfg.scope]
    trades = load_trades(conn)
    segs = segments(cfg.start, cfg.end, cfg.splits)
    bench = benchmark_return(conn, cfg.benchmark_symbol, cfg.scope, cfg.start, cfg.end)
    bench_seg = {k: benchmark_return(conn, cfg.benchmark_symbol, cfg.scope, a, b) for k, (a, b) in segs.items()}
    counts = {r["strategy_id"]: r for r in conn.execute(
        """SELECT strategy_id, count(*) AS recorded, count(*) FILTER (WHERE decision IN ('LONG_CANDIDATE','SHORT_CANDIDATE')) AS candidates,
                  count(*) FILTER (WHERE decision='REJECTED_BY_RISK') AS rejected FROM signals GROUP BY 1""").fetchall()}
    strategies = {}
    for strat in registry.for_asset_class(group):
        sid = strat.spec.strategy_id
        st = [t for t in trades if t["strategy_id"] == sid]
        overall = trade_metrics(st, start=cfg.start, end=cfg.end, capital=cfg.starting_cash, periods_per_year=ppy)
        by_seg = {k: trade_metrics([t for t in st if a <= t["entry_time"] < b], start=a, end=b, capital=cfg.starting_cash,
                                   periods_per_year=ppy) for k, (a, b) in segs.items()}
        c = counts.get(sid, {})
        evaluations = cycles * len(cfg.crypto_symbols if group == "crypto" else cfg.equity_symbols)
        strategies[sid] = {
            "strategy_version": strat.spec.version, "horizon": strat.spec.time_horizon, "benchmark": bench,
            "overall": overall, "segments": by_seg,
            "benchmark_by_segment": bench_seg, "forward_returns": forward_returns(conn, sid),
            "signals": {"recorded": c.get("recorded", 0), "candidates": c.get("candidates", 0), "rejected_by_risk": c.get("rejected", 0),
                        "evaluations": evaluations},
            "mfe_mae": _mfe_mae(conn, sid),
            "warnings": warnings_for(strat.spec, overall, by_seg, cfg, evaluations, c.get("candidates", 0)),
            "verdict": "keine Bewertung ohne ausreichende Stichprobe" if overall.get("trades", 0) < MIN_TRADES else
                       "Stichprobe ausreichend - Ergebnis gegen Benchmark und Out-of-Sample pruefen, nicht nur die Rendite",
        }
    open_pos = one(conn.execute("SELECT count(*) AS n FROM paper_positions WHERE closed_at IS NULL"))["n"]
    return {
        "scope": cfg.scope, "period": {"start": cfg.start.isoformat(), "end": cfg.end.isoformat()}, "cycles": cycles,
        "execution_model": cfg.execution.describe(), "segments": {k: [a.isoformat(), b.isoformat()] for k, (a, b) in segs.items()},
        "portfolio": trade_metrics(trades, start=cfg.start, end=cfg.end, capital=cfg.starting_cash, periods_per_year=ppy),
        "open_positions_at_end": open_pos, "benchmark": bench, "strategies": strategies,
        "note": "Parameter wurden NICHT optimiert. Train/Validation/Out-of-Sample sind reine Zeitabschnitte desselben Laufs.",
    }


def render_markdown(report: dict) -> str:
    def f(v, d=2, suffix=""):
        return "–" if v is None else (f"{v:,.{d}f}{suffix}" if isinstance(v, (int, float)) else str(v))

    lines = [f"# Backtest {report['scope']}  {report['period']['start'][:10]} – {report['period']['end'][:10]}", "",
             f"Ausführung: **{report['execution_model']['mode']}**, Slippage-Modell {report['execution_model']['slippage_model']}", ""]
    b = report.get("benchmark")
    for sid, s in report["strategies"].items():
        o = s["overall"]
        lines += [f"## {sid} (v{s['strategy_version']}, {s['horizon']})", "",
                  "| Kennzahl | Gesamt | Train | Validation | Out-of-Sample |", "|---|---|---|---|---|"]
        seg = s["segments"]
        for key, label, d, suf in (("trades", "Trades", 0, ""), ("total_return_pct", "Rendite", 2, " %"), ("max_drawdown_pct", "Max. Drawdown", 2, " %"),
                                   ("sharpe", "Sharpe", 2, ""), ("sortino", "Sortino", 2, ""), ("win_rate", "Trefferquote", 2, ""),
                                   ("profit_factor", "Profit Factor", 2, ""), ("expectancy_pct", "Erwartung je Trade", 3, " %"),
                                   ("fees_paid", "Gebühren", 2, ""), ("slippage_cost", "Slippage", 2, "")):
            lines.append(f"| {label} | {f(o.get(key), d, suf)} | {f(seg['train'].get(key), d, suf)} | {f(seg['validation'].get(key), d, suf)} | "
                         f"{f(seg['out_of_sample'].get(key), d, suf)} |")
        bench_line = f"{b['symbol']} buy & hold {f(b['return_pct'], 2, ' %')}" if b else "nicht verfügbar"
        lines += ["", f"Benchmark: {bench_line}", f"Signale: {s['signals']}", ""]
        if s["forward_returns"]:
            lines.append("Vorwärtsrenditen der Kandidaten: " + ", ".join(
                f"{h}: {f(v['mean_pct'], 2, ' %')} (n={v['n']})" for h, v in s["forward_returns"].items()))
        lines += [f"**Einordnung:** {s['verdict']}"] + [f"- ⚠ {w}" for w in s["warnings"]] + [""]
    return "\n".join(lines)
