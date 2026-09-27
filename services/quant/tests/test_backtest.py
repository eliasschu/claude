"""
Backtest: gleicher Kern wie live, keine Zukunftsdaten, realistische Ausfuehrung, erklaerbare Trades.
Synthetische Reihen - nur fuer Tests, nie fuer Aussagen ueber echte Maerkte.
"""

import math
import random
from datetime import datetime, timedelta, timezone

import pytest

from quant.backtest.dataset import HistoricalDataset
from quant.backtest.engine import Backtest, BacktestConfig, equity_run_times
from quant.backtest.explain import explain_trade
from quant.backtest.replay import ReplayCrypto, ReplayEquity
from quant.backtest.report import render_markdown
from quant.backtest.walkforward import walk_forward_windows
from quant.db import connect
from quant.execution import IDEALIZED, REALISTIC
from quant.providers.base import Bar, FundingRate, OpenInterestPoint
from quant.strategies import StrategyRegistry
from tests.conftest import ADMIN_URL

D0 = datetime(2024, 1, 1, tzinfo=timezone.utc)


def equity_series(seed: int, drift: float, vol: float, days: int = 900, spike_every: int = 0) -> list[Bar]:
    rng = random.Random(seed)
    bars, price = [], 100.0
    for i in range(days):
        d = D0 + timedelta(days=i)
        if d.weekday() >= 5:
            continue
        ret = drift + rng.gauss(0, vol)
        volume = 3_000_000
        if spike_every and i % spike_every == 0:
            ret, volume = abs(ret) + 0.03, 9_000_000   # Ausbruchstag mit hohem Volumen
        o = price
        price *= math.exp(ret)
        bars.append(Bar(ts=d, open=o, high=max(o, price) * 1.004, low=min(o, price) * 0.996, close=price, volume=volume, is_final=True))
    return bars


def equity_dataset(poison_after: datetime | None = None) -> HistoricalDataset:
    ds = HistoricalDataset()
    series = {"SPY": equity_series(1, 0.0004, 0.008), "AAPL": equity_series(2, 0.0015, 0.012, spike_every=23),
              "MSFT": equity_series(3, 0.0002, 0.015)}
    for t, bars in series.items():
        if poison_after:  # Zukunft drastisch veraendern: Kurse x3, Volumen x10
            bars = [b if b.ts < poison_after else Bar(b.ts, b.open * 3, b.high * 3, b.low * 3, b.close * 3, b.volume * 10, True) for b in bars]
        ds.add_equity(t, bars, "synthetisch")
    return ds


EQ_START = datetime(2025, 3, 3, tzinfo=timezone.utc)
EQ_END = datetime(2025, 9, 1, tzinfo=timezone.utc)


def eq_cfg(**kw):
    return BacktestConfig(scope="equity_us", start=EQ_START, end=EQ_END, equity_symbols=("AAPL", "MSFT"), **kw)


@pytest.fixture(scope="module")
def equity_run():
    res = Backtest(equity_dataset(), eq_cfg()).run(ADMIN_URL)
    yield res
    import psycopg
    with psycopg.connect(ADMIN_URL, autocommit=True) as a:
        a.execute(f'DROP DATABASE IF EXISTS "{res.database}" WITH (FORCE)')


# ------------------------------------------------------------------------------------ Replay: keine Zukunft
def test_replay_equity_releases_daily_bar_only_after_18_ny():
    ds = equity_dataset()
    clock = type("C", (), {"t": datetime(2025, 6, 4, 21, 0, tzinfo=timezone.utc), "__call__": lambda s: s.t})()
    r = ReplayEquity(ds, clock)
    assert r.bars("AAPL", "1d").data[-1].ts.date().isoformat() == "2025-06-03"   # 17:00 NY: heutiger Balken noch unbekannt
    clock.t = datetime(2025, 6, 4, 22, 5, tzinfo=timezone.utc)
    assert r.bars("AAPL", "1d").data[-1].ts.date().isoformat() == "2025-06-04"


def test_replay_crypto_never_returns_open_bars_future_funding_or_unfinished_oi():
    ds = HistoricalDataset()
    bars = [Bar(D0 + timedelta(minutes=i), 100, 101, 99, 100, 1, True, taker_buy_volume=0.5) for i in range(100)]
    ds.add_spot("BTCUSDT", "1m", bars, "t")
    ds.funding["BTCUSDT"] = [FundingRate(D0 + timedelta(hours=8 * i), 0.0001 * i, 8.0) for i in range(3)]
    ds.open_interest["BTCUSDT"] = [OpenInterestPoint(D0 + timedelta(minutes=5 * i), 1000 + i, None) for i in range(20)]
    clock = type("C", (), {"t": D0 + timedelta(minutes=50, seconds=30), "__call__": lambda s: s.t})()
    r = ReplayCrypto(ds, clock)
    got = r.spot_bars("BTCUSDT", "1m", 1000, D0).data
    assert got[-1].ts == D0 + timedelta(minutes=49)                      # Balken 50 laeuft noch
    assert all(b.ts + timedelta(minutes=1) <= clock.t for b in got)
    assert r.funding_history("BTCUSDT", 10).data[-1].ts == D0            # 08:00-Abrechnung liegt in der Zukunft
    assert r.open_interest_history("BTCUSDT", "5m", 30).data[-1].ts == D0 + timedelta(minutes=45)  # 45-50 erst ab 50:00 bekannt
    q = r.spot_quote("BTCUSDT")
    assert q.data.ts <= clock.t and "modelliert" in q.note


# ------------------------------------------------------------------------------------ Gleicher Kern
def test_backtest_uses_live_core_and_records_versions(equity_run):
    with connect(equity_run.dsn) as c:
        run = c.execute("SELECT * FROM backtest_runs").fetchone()
        assert run["status"] == "completed" and run["registry_version"] == StrategyRegistry().version
        modes = {r["mode"] for r in c.execute("SELECT DISTINCT mode FROM signals").fetchall()}
        assert modes == {"backtest"}
        # dieselbe Signal-Hash-Kette wie live
        from quant.audit import SignalAuditService
        assert SignalAuditService(c).verify_chain() == (True, [])
        assert c.execute("SELECT count(*) AS n FROM bot_cycles").fetchone()["n"] == len(equity_run_times(EQ_START, EQ_END))


def test_report_structure_metrics_benchmark_segments_warnings(equity_run):
    rep = equity_run.report
    assert set(rep["strategies"]) == {"equity_breakout_momentum", "equity_relative_strength", "equity_volume_anomaly"}
    assert rep["benchmark"]["symbol"] == "SPY" and rep["execution_model"]["mode"] == "realistic"
    assert set(rep["segments"]) == {"train", "validation", "out_of_sample"}
    traded = [s for s in rep["strategies"].values() if s["overall"]["trades"] > 0]
    assert traded, {k: s["signals"] for k, s in rep["strategies"].items()}
    o = traded[0]["overall"]
    for k in ("total_return_pct", "annualized_return_pct", "max_drawdown_pct", "win_rate", "expectancy_pct", "fees_paid",
              "slippage_cost", "exposure_time_pct", "turnover", "payoff_ratio" if o["average_loss"] else "trades"):
        assert k in o
    assert o["fees_paid"] > 0 and o["slippage_cost"] > 0
    # Kurzer Zeitraum / wenige Trades werden ausdruecklich gewarnt statt schoengerechnet
    assert any("Zu wenige Trades" in w or "Zu kurzer Zeitraum" in w for w in traded[0]["warnings"])
    assert "keine Bewertung" in traded[0]["verdict"] or "pruefen" in traded[0]["verdict"]
    md = render_markdown(rep)
    assert "Out-of-Sample" in md and "Benchmark" in md


def test_every_trade_is_explainable(equity_run):
    with connect(equity_run.dsn) as c:
        pid = c.execute("SELECT position_id FROM paper_positions WHERE closed_at IS NOT NULL LIMIT 1").fetchone()["position_id"]
        x = explain_trade(c, pid)
    assert x["why"]["evidence_for"] and x["risk_decision"]["approved"] is True
    assert x["input_features"] and all("freshness" in v for v in x["input_features"].values())
    assert x["executions"] and x["costs"]["fees"] > 0 and x["trade"]["exit_reason"] in ("stop", "target", "time")
    assert x["versions"]["feature_version"].startswith("features-")


# ------------------------------------------------------------------------------------ Look-ahead
def _signal_fingerprint(dsn, before):
    with connect(dsn) as c:
        return [(r["created_at"], r["instrument_id"], r["strategy_id"], r["decision"], float(r["signal_strength"]), r["price_at_signal"])
                for r in c.execute("SELECT * FROM signals WHERE created_at < %s ORDER BY created_at, instrument_id, strategy_id", (before,)).fetchall()]


def test_future_data_cannot_change_past_decisions():
    """Poison-Test: Daten NACH T werden drastisch veraendert - alle Entscheidungen VOR T muessen identisch bleiben."""
    T = datetime(2025, 7, 1, tzinfo=timezone.utc)
    cfg = eq_cfg()
    clean = Backtest(equity_dataset(), cfg).run(ADMIN_URL)
    poisoned = Backtest(equity_dataset(poison_after=T), cfg).run(ADMIN_URL)
    try:
        a, b = _signal_fingerprint(clean.dsn, T), _signal_fingerprint(poisoned.dsn, T)
        assert a and a == b
        # Sanity: nach T unterscheiden sie sich tatsaechlich (der Test waere sonst wertlos)
        assert _signal_fingerprint(clean.dsn, EQ_END) != _signal_fingerprint(poisoned.dsn, EQ_END)
    finally:
        import psycopg
        with psycopg.connect(ADMIN_URL, autocommit=True) as adm:
            for r in (clean, poisoned):
                adm.execute(f'DROP DATABASE IF EXISTS "{r.database}" WITH (FORCE)')


# ------------------------------------------------------------------------------------ Ausfuehrung
def test_realistic_is_never_better_than_idealized():
    real = Backtest(equity_dataset(), eq_cfg(execution=REALISTIC)).run(ADMIN_URL, keep_database=False).report
    ideal = Backtest(equity_dataset(), eq_cfg(execution=IDEALIZED)).run(ADMIN_URL, keep_database=False).report
    pr, pi = real["portfolio"], ideal["portfolio"]
    assert pi.get("fees_paid", 0) == 0 and pr["fees_paid"] > 0
    assert pr["total_pnl"] <= pi["total_pnl"]


def test_walk_forward_windows():
    w = walk_forward_windows(datetime(2024, 1, 1, tzinfo=timezone.utc), datetime(2025, 1, 1, tzinfo=timezone.utc),
                             timedelta(days=180), timedelta(days=60))
    assert len(w) == 3 and w[0].test_start == w[0].train_end and w[1].train_start == w[0].train_start + timedelta(days=60)
    assert all(x.test_end <= datetime(2025, 1, 1, tzinfo=timezone.utc) for x in w)


def crypto_dataset(days_1m: int = 6) -> HistoricalDataset:
    rng = random.Random(7)
    ds = HistoricalDataset()
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    bars, price = [], 60_000.0
    for i in range(days_1m * 1440):
        t = start + timedelta(minutes=i)
        drift = 0.00012 if (i // 240) % 3 != 2 else -0.00008   # Trendphasen
        o = price
        price *= math.exp(drift + rng.gauss(0, 0.0007))
        v = 5 + rng.random() * 5
        buy = 0.62 if drift > 0 else 0.4                          # Spot-Kaeufer dominieren in Aufwaertsphasen
        bars.append(Bar(t, o, max(o, price) * 1.0003, min(o, price) * 0.9997, price, v, True, quote_volume=v * price * 1000,
                        trade_count=50, taker_buy_volume=v * buy))
    ds.add_spot("BTCUSDT", "1m", bars, "synthetisch")
    perp = [Bar(b.ts, b.open, b.high, b.low, b.close, b.volume, True, taker_buy_volume=b.volume * 0.47) for b in bars]
    ds.add_perp("BTCUSDT", "1m", perp, "synthetisch")
    daily, p = [], 40_000.0
    for i in range(420):
        o = p
        p *= 1.0012
        daily.append(Bar(start - timedelta(days=420 - i), o, p * 1.01, o * 0.99, p, 1000, True))
    ds.add_spot("BTCUSDT", "1d", daily, "synthetisch")
    ds.funding["BTCUSDT"] = [FundingRate(start - timedelta(days=10) + timedelta(hours=8 * i), 0.0001 * (1 + 0.2 * math.sin(i)), 8.0)
                             for i in range(3 * (days_1m + 10))]
    ds.open_interest["BTCUSDT"] = [OpenInterestPoint(start + timedelta(minutes=5 * i), 10_000 * (1.0004 ** i), None)
                                   for i in range(days_1m * 288)]
    return ds


def test_crypto_intraday_backtest_runs_same_core_with_funding():
    s = datetime(2026, 3, 6, tzinfo=timezone.utc)
    cfg = BacktestConfig(scope="crypto", start=s, end=s + timedelta(hours=20), crypto_symbols=("BTCUSDT",), step=timedelta(minutes=15),
                         history_window=timedelta(days=4))
    res = Backtest(crypto_dataset(), cfg).run(ADMIN_URL)
    try:
        with connect(res.dsn) as c:
            cyc = c.execute("SELECT status, count(*) AS n FROM bot_cycles GROUP BY 1").fetchall()
            assert {r["status"] for r in cyc} == {"completed"}, cyc  # kein Kill Switch: Replay liefert alles Noetige
            f = c.execute("SELECT features FROM feature_snapshots ORDER BY as_of DESC LIMIT 1").fetchone()["features"]["values"]
            assert f["funding_rate_8h"]["freshness"] == "event" and f["oi_change_60m_pct"]["data_class"] == "open_interest"
            # Keine Beobachtung im Protokoll, die zur Simulationszeit noch nicht verfuegbar war
            leak = c.execute("""SELECT count(*) AS n FROM observations o WHERE o.effective_time > o.received_time + interval '1 second'
                                AND o.series_key='funding_rate'""").fetchone()["n"]
            assert leak == 0
            late = c.execute("""SELECT count(*) AS n FROM feature_snapshots fs, bars b WHERE b.instrument_id = fs.instrument_id
                                AND b.timeframe='1m' AND b.received_at > fs.as_of AND b.ts + interval '1 minute' <= fs.as_of
                                AND fs.as_of = (SELECT min(as_of) FROM feature_snapshots)""").fetchone()["n"]
            assert late == 0
            sig = {r["strategy_id"]: r["n"] for r in c.execute("SELECT strategy_id, count(*) AS n FROM signals GROUP BY 1").fetchall()}
            assert set(sig) == {"crypto_spot_perp_divergence", "crypto_momentum_funding_oi"}
        assert set(res.report["strategies"]) == {"crypto_spot_perp_divergence", "crypto_momentum_funding_oi"}
        assert res.report["benchmark"]["symbol"] == "BTCUSDT"
    finally:
        import psycopg
        with psycopg.connect(ADMIN_URL, autocommit=True) as adm:
            adm.execute(f'DROP DATABASE IF EXISTS "{res.database}" WITH (FORCE)')
