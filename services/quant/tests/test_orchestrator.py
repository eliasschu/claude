import math
from datetime import datetime, timedelta, timezone

from quant.audit import SignalAuditService
from quant.orchestrator import BotOrchestrator
from quant.outcomes import resolve_outcomes
from quant.providers.base import ProviderError
from tests.fakes import Clock, FakeCrypto, FakeMarket, providers

START = datetime(2026, 9, 21, 12, 0, 20, tzinfo=timezone.utc)


def uptrend(symbol, t):
    """Stetiger Aufwaertstrend, in den letzten 4 Stunden beschleunigt."""
    base = 100.0 if symbol != "BTCUSDT" else 60000.0
    hours = (t - START).total_seconds() / 3600
    if hours < -4:
        return base * math.exp(0.0004 * hours)
    return base * math.exp(0.0004 * -4 + 0.004 * (hours + 4))


def flat_equity(symbol, d):
    return 100.0


def make_bot(db, clock, crypto_fn=uptrend, **kw):
    crypto = FakeCrypto(clock, crypto_fn, **kw)
    bot = BotOrchestrator(db, providers(crypto, FakeMarket(clock, flat_equity)), mode="paper", account_id="paper-test",
                          starting_cash=100_000, crypto_symbols=("BTCUSDT", "ETHUSDT"), equity_symbols=("AAPL",), clock=clock)
    return bot, crypto


def test_crypto_cycle_end_to_end(db):
    clock = Clock(START)
    bot, crypto = make_bot(db, clock)
    rep = bot.run_crypto_cycle()
    assert rep.kill_switch is None, rep
    cyc = db.execute("SELECT status, counts FROM bot_cycles").fetchone()
    assert cyc["status"] == "completed"
    # 7 Tage Minutenbalken nachgeladen, nur abgeschlossene gespeichert
    n = db.execute("SELECT count(*) AS n FROM bars WHERE timeframe='1m'").fetchone()["n"]
    assert n > 2 * 7 * 1440
    assert db.execute("SELECT count(*) AS n FROM bars WHERE ts > %s", (START,)).fetchone()["n"] == 0
    signals = db.execute("SELECT decision, strategy_id, mode FROM signals").fetchall()
    assert len(signals) == 4  # 2 Paare x 2 Krypto-Strategien, erster Stand wird immer festgehalten
    assert {s["mode"] for s in signals} == {"paper"}
    assert db.execute("SELECT count(*) AS n FROM regime_snapshots").fetchone()["n"] == 1
    events = [e["event_type"] for e in db.execute("SELECT event_type FROM bot_events ORDER BY event_id").fetchall()]
    assert events[0] == "cycle_started" and events[-1] == "cycle_finished" and "regime" in events

    # Zweiter Zyklus eine Minute spaeter: gleiche Entscheidungen werden nicht erneut protokolliert
    clock.t = START + timedelta(minutes=1)
    before = len(signals)
    bot.run_crypto_cycle()
    assert db.execute("SELECT count(*) AS n FROM signals").fetchone()["n"] == before
    ok, problems = SignalAuditService(db).verify_chain()
    assert ok, problems


def test_candidate_becomes_paper_trade_and_exits_realistically(db):
    clock = Clock(START)
    bot, _ = make_bot(db, clock)
    bot.run_crypto_cycle()
    cands = db.execute("SELECT signal_id, decision, risk_assessment FROM signals WHERE decision='LONG_CANDIDATE'").fetchall()
    orders = db.execute("SELECT * FROM paper_orders").fetchall()
    assert len(orders) == len(cands) and len(cands) >= 1, [
        (r["decision"], r["risk_assessment"]["summary"]) for r in db.execute("SELECT decision, risk_assessment FROM signals").fetchall()]
    assert all(o["status"] == "pending" for o in orders)  # Handelsverzoegerung: noch kein Fill im selben Moment

    clock.t = START + timedelta(minutes=1)
    bot.run_crypto_cycle()
    fills = db.execute("SELECT f.*, o.side FROM paper_fills f JOIN paper_orders o USING (order_id)").fetchall()
    assert fills and all(f["slippage_bps"] > 0 and f["fee"] > 0 for f in fills)  # kein perfekter Mid-Fill
    pos = db.execute("SELECT * FROM paper_positions WHERE closed_at IS NULL").fetchall()
    assert len(pos) == len(fills)

    # Kurseinbruch: Stop muss greifen, mit Verlust nach Kosten
    crash_at = START + timedelta(minutes=2)
    bot_crash, _ = make_bot(db, clock, crypto_fn=lambda s, t: uptrend(s, t) * (0.9 if t >= crash_at else 1.0))
    clock.t = START + timedelta(minutes=5)
    bot_crash.run_crypto_cycle()
    closed = db.execute("SELECT exit_reason, realized_pnl FROM paper_positions WHERE closed_at IS NOT NULL").fetchall()
    assert closed and all(c["exit_reason"] == "stop" and c["realized_pnl"] < 0 for c in closed)


def test_provider_outage_triggers_kill_switch_but_cycle_completes(db):
    clock = Clock(START)
    bot, crypto = make_bot(db, clock)

    def broken(*a, **k):
        raise ProviderError("binance", "unavailable", "Timeout")

    crypto.spot_bars = broken
    rep = bot.run_crypto_cycle()
    assert rep.kill_switch is not None
    assert db.execute("SELECT status FROM bot_cycles").fetchone()["status"] == "halted"
    assert db.execute("SELECT count(*) AS n FROM paper_orders").fetchone()["n"] == 0
    assert db.execute("SELECT count(*) AS n FROM bot_events WHERE event_type='kill_switch'").fetchone()["n"] == 1
    decisions = {r["decision"] for r in db.execute("SELECT decision FROM signals").fetchall()}
    assert decisions == {"NO_TRADE"}  # ohne Daten: ehrlich kein Trade


def test_equity_cycle_and_outcome_resolution(db):
    clock = Clock(datetime(2026, 9, 22, 23, 0, tzinfo=timezone.utc))  # 19:00 New York, nach Handelsschluss
    bot, _ = make_bot(db, clock)
    rep = bot.run_equity_cycle()
    assert db.execute("SELECT status FROM bot_cycles WHERE scope='equity_us'").fetchone()["status"] == "completed", rep
    sig = db.execute("SELECT decision, time_horizon, price_basis FROM signals").fetchall()
    assert sig and all(s["time_horizon"] == "swing" for s in sig)
    last_bar = db.execute("SELECT max(ts) AS t FROM bars WHERE timeframe='1d'").fetchone()["t"]
    assert last_bar.date().isoformat() == "2026-09-22"
    # Der Lauf um 19:00 New York muss den heutigen Schlusskurs verwenden, nicht den von gestern
    snap = db.execute("SELECT features FROM feature_snapshots ORDER BY created_at DESC LIMIT 1").fetchone()["features"]
    assert snap["values"]["close"]["as_of"].startswith("2026-09-22"), snap["values"]["close"]
    assert snap["values"]["close"]["freshness"] == "end_of_day"

    # Ergebnisaufloesung: Krypto-Signal nach >1 h
    clock.t = START
    bot.run_crypto_cycle()
    clock.t = START + timedelta(hours=1, minutes=5)
    bot.run_crypto_cycle()
    n = resolve_outcomes(db, clock(), {"crypto": None})
    db.commit()
    rows = db.execute("SELECT horizon, return_pct, mfe_pct, mae_pct FROM signal_outcomes").fetchall()
    assert n == len(rows) and rows and all(r["horizon"] == "1h" and r["mfe_pct"] >= r["mae_pct"] for r in rows)


def test_scheduler_runs_equity_once_per_trading_day(db):
    from quant.scheduler import equity_due
    friday_evening = datetime(2026, 9, 25, 22, 30, tzinfo=timezone.utc)  # 18:30 New York
    assert equity_due(db, friday_evening)
    assert not equity_due(db, datetime(2026, 9, 25, 21, 0, tzinfo=timezone.utc))  # 17:00 New York, zu frueh
    assert not equity_due(db, datetime(2026, 9, 26, 22, 30, tzinfo=timezone.utc))  # Samstag
    clock = Clock(friday_evening)
    bot, _ = make_bot(db, clock)
    bot.run_equity_cycle()
    assert not equity_due(db, friday_evening + timedelta(minutes=30))
