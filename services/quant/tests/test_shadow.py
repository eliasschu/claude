from datetime import timedelta

import pytest

from quant.config import load_settings
from quant.shadow import resolve_shadows
from tests.test_orchestrator import START, make_bot, uptrend
from tests.fakes import Clock


def test_live_trading_is_hard_blocked(monkeypatch):
    monkeypatch.setenv("LIVE_TRADING", "true")
    with pytest.raises(RuntimeError, match="gesperrt"):
        load_settings()
    monkeypatch.setenv("LIVE_TRADING", "false")
    s = load_settings()
    assert s.live_data is True and s.live_trading is False and s.shadow_execution is True


def test_every_candidate_gets_planned_order_including_rejected(db):
    clock = Clock(START)
    bot, _ = make_bot(db, clock)
    bot.run_crypto_cycle()
    rows = db.execute("""SELECT s.decision, x.* FROM shadow_executions x JOIN signals s USING (signal_id)""").fetchall()
    decisions = {r["decision"] for r in rows}
    assert "LONG_CANDIDATE" in decisions and "REJECTED_BY_RISK" in decisions  # auch die abgelehnte Idee
    for r in rows:
        assert r["planned_stop"] < r["planned_reference"] < r["planned_target"]
        assert r["planned_quantity"] and r["confidence"] is None and r["confidence_status"] == "not_calibrated"
        assert r["feature_snapshot_id"] is not None
        assert (r["risk_approved"] is False) == (r["decision"] == "REJECTED_BY_RISK")
        if not r["risk_approved"]:
            assert r["rejection_reasons"]
    # Shadow beeinflusst das Paper-Konto nicht: nur die freigegebenen Ideen haben Paper-Orders
    assert db.execute("SELECT count(*) AS n FROM paper_orders").fetchone()["n"] == sum(r["risk_approved"] for r in rows)


def test_shadow_resolution_uses_costs_and_only_known_bars(db):
    clock = Clock(START)
    bot, _ = make_bot(db, clock)
    bot.run_crypto_cycle()
    db.commit()
    assert resolve_shadows(db, START) == 0  # noch keine Kerze nach dem Signal bekannt
    crash_at = START + timedelta(minutes=3)
    bot2, _ = make_bot(db, clock, crypto_fn=lambda s, t: uptrend(s, t) * (0.9 if t >= crash_at else 1.0))
    clock.t = START + timedelta(minutes=6)
    bot2.run_crypto_cycle()
    n = resolve_shadows(db, clock.t)
    db.commit()
    out = db.execute("SELECT * FROM shadow_outcomes").fetchall()
    assert n == len(out) >= 1
    for o in out:
        assert o["exit_reason"] == "stop" and o["pnl"] < 0 and o["entry_fee"] > 0 and o["entry_slippage_bps"] > 0
        assert o["mae_pct"] <= o["mfe_pct"]
