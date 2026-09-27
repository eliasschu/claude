import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from quant.audit import SignalAuditService, SignalContext
from quant.domain import Decision, Evidence, ExitPlan, Invalidation, RegimeState, RiskAssessment, RiskCheck, StrategyEvaluation
from quant.events import BotEventLog
from quant.repo import ensure_instrument, observations_as_of, record_observation

NOW = datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc)


def _setup(db):
    ensure_instrument(db, "ins_btcusdt_binance", "crypto_spot", "Bitcoin/Tether", identifiers=[("exchange_symbol", "BTCUSDT", "binance")])
    cycle = uuid.uuid4()
    db.execute("INSERT INTO bot_cycles (cycle_id, scope, mode, started_at, status, bot_version) VALUES (%s,'crypto','paper',%s,'running','t')",
               (cycle, NOW))
    db.commit()
    return cycle


def _eval(decision=Decision.LONG_CANDIDATE, strength=72.5):
    return StrategyEvaluation(
        strategy_id="crypto_momentum_funding_oi", strategy_version="1.0.0", instrument_id="ins_btcusdt_binance",
        horizon="intraday", direction="long", decision=decision, strength=strength, summary="Test",
        positive=(Evidence("mom", "Momentum positiv", ("ret_60m_pct",), 30.0),),
        negative=(Evidence("vol", "Volatilitaet erhoeht", ("realized_vol_60m_pct",)),),
        invalidation=Invalidation("close_below", 99.0, "Schluss unter 99", "1m"),
        exit_plan=ExitPlan(99.0, 103.0, timedelta(hours=6), "Stop 99, Ziel 103"),
        reference_price=100.12, upside_to_target_pct=3.0, downside_to_stop_pct=1.0,
    )


def _ctx(cycle):
    regime = RegimeState("crypto", ("TRENDING", "LOW_VOLATILITY"), "Test", {"x": 1.0}, "regime-0.1.0", NOW)
    return SignalContext(cycle, "paper", NOW, regime, [{"source_id": "binance"}], {"close": {"class": "under_1_min"}}, None, "registry-1", "ask")


RISK_OK = RiskAssessment(True, (RiskCheck("rr", True, "3.0"),), 3.0, 1.0, 100.0, 1.0, "risk-0.1.0")


def test_signal_is_written_once_and_cannot_be_changed(db):
    cycle = _setup(db)
    audit = SignalAuditService(db)
    sid = audit.record(_eval(), Decision.LONG_CANDIDATE, RISK_OK, _ctx(cycle))
    db.commit()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("UPDATE signals SET decision='WATCH' WHERE signal_id=%s", (sid,))
    db.rollback()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("DELETE FROM signals")
    db.rollback()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("TRUNCATE signals CASCADE")
    db.rollback()
    row = db.execute("SELECT * FROM signals WHERE signal_id=%s", (sid,)).fetchone()
    assert row["decision"] == "LONG_CANDIDATE" and float(row["signal_strength"]) == 72.5
    assert row["disclosure"]["published"] is False
    for col in ("feature_version", "model_version", "risk_version", "strategy_version", "dataset_version", "bot_version"):
        assert row[col]


def test_hash_chain_detects_tampering(db):
    cycle = _setup(db)
    audit = SignalAuditService(db)
    audit.record(_eval(), Decision.LONG_CANDIDATE, RISK_OK, _ctx(cycle))
    audit.record(_eval(Decision.WATCH, 40.0), Decision.WATCH, RISK_OK, _ctx(cycle))
    db.commit()
    assert audit.verify_chain() == (True, [])
    # Manipulation an den Triggern vorbei (z. B. Superuser) muss auffallen
    db.execute("ALTER TABLE signals DISABLE TRIGGER signals_append_only")
    db.execute("UPDATE signals SET signal_strength = 99 WHERE seq = 1")
    db.execute("ALTER TABLE signals ENABLE TRIGGER signals_append_only")
    db.commit()
    ok, problems = audit.verify_chain()
    assert not ok and "Hash" in problems[0]


def test_rejected_by_risk_needs_a_real_rejection(db):
    cycle = _setup(db)
    with pytest.raises(ValueError):
        SignalAuditService(db).record(_eval(), Decision.REJECTED_BY_RISK, RISK_OK, _ctx(cycle))


def test_live_mode_is_refused(db):
    cycle = _setup(db)
    ctx = _ctx(cycle)
    with pytest.raises(ValueError):
        SignalAuditService(db).record(_eval(), Decision.WATCH, RISK_OK, SignalContext(**{**ctx.__dict__, "mode": "live"}))


def test_outcomes_are_append_only_per_horizon(db):
    cycle = _setup(db)
    audit = SignalAuditService(db)
    sid = audit.record(_eval(), Decision.LONG_CANDIDATE, RISK_OK, _ctx(cycle))
    assert audit.record_outcome(sid, "1h", NOW + timedelta(hours=1), 101.0, 0.88, result="open")
    assert not audit.record_outcome(sid, "1h", NOW + timedelta(hours=1), 150.0, 50.0)
    db.commit()
    assert db.execute("SELECT price FROM signal_outcomes").fetchone()["price"] == 101.0


def test_point_in_time_observations_and_events(db):
    cycle = _setup(db)
    t = NOW - timedelta(days=30)
    record_observation(db, "fred:CPI", "fred", t, 2.9, effective_time=NOW - timedelta(days=20))
    assert not record_observation(db, "fred:CPI", "fred", t, 2.9, effective_time=NOW - timedelta(days=19))
    record_observation(db, "fred:CPI", "fred", t, 3.1, effective_time=NOW - timedelta(days=5))
    before = observations_as_of(db, "fred:CPI", None, t, NOW - timedelta(days=10))
    after = observations_as_of(db, "fred:CPI", None, t, NOW)
    assert before[0]["value"] == 2.9 and after[0]["value"] == 3.1
    BotEventLog(db).emit("cycle_started", "Zyklus gestartet", cycle_id=cycle)
    db.commit()
    assert db.execute("SELECT count(*) AS n FROM bot_events").fetchone()["n"] == 1
