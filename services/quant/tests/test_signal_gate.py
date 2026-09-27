from dataclasses import replace
from datetime import datetime, timedelta, timezone

from quant.domain import Decision
from quant.signal_state import SignalGate
from quant.strategies import CryptoSpotPerpDivergence
from tests.test_engines import CRYPTO, CRYPTO_DIV, fs_of

T = datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc)


def cand(strength=75.0):
    ev = CryptoSpotPerpDivergence().evaluate(fs_of(CRYPTO_DIV, "under_1_min"), CRYPTO)
    assert ev.decision == Decision.LONG_CANDIDATE
    return replace(ev, strength=strength)


def test_confirmation_then_hysteresis_then_cooldown():
    g = SignalGate()
    r1 = g.apply(cand(), T)
    assert r1.evaluation.decision == Decision.WATCH and "Bestätigung ausstehend (1/2" in r1.evaluation.reasons[0]
    r2 = g.apply(cand(), T + timedelta(minutes=1))
    assert r2.evaluation.decision == Decision.LONG_CANDIDATE and not r2.suppress
    # Staerke faellt auf 55: Strategie sagt WATCH, Gate haelt den Kandidaten (kein Flackern)
    dip = replace(cand(55.0), decision=Decision.WATCH)
    assert g.apply(dip, T + timedelta(minutes=2)).suppress
    assert g.apply(cand(), T + timedelta(minutes=3)).suppress  # weiterhin aktiv, keine zweite Einstiegsidee
    # unter die Austrittsschwelle -> beendet, Cooldown beginnt
    weak = replace(cand(30.0), decision=Decision.NO_TRADE)
    assert "Cooldown" in g.apply(weak, T + timedelta(minutes=4)).note
    r = g.apply(cand(), T + timedelta(minutes=5))
    assert r.evaluation.decision == Decision.WATCH and "Cooldown" in r.evaluation.reasons[0]
    g.apply(cand(), T + timedelta(minutes=40))
    assert g.apply(cand(), T + timedelta(minutes=41)).evaluation.decision == Decision.LONG_CANDIDATE


def test_single_spike_never_becomes_a_candidate():
    g = SignalGate()
    g.apply(cand(), T)
    quiet = replace(cand(20.0), decision=Decision.NO_TRADE)
    g.apply(quiet, T + timedelta(minutes=1))
    assert g.apply(cand(), T + timedelta(minutes=2)).evaluation.decision == Decision.WATCH  # Zaehler zurueckgesetzt


def test_warm_start_restores_cooldown_after_restart(db):
    from tests.test_orchestrator import START, confirm, make_bot
    from tests.fakes import Clock
    clock = Clock(START)
    bot, _ = make_bot(db, clock)
    confirm(bot, clock)
    db.commit()
    g = SignalGate()
    assert g.warm_start(db, START + timedelta(minutes=5)) >= 1
    sid = db.execute("SELECT instrument_id FROM signals WHERE decision='LONG_CANDIDATE' LIMIT 1").fetchone()["instrument_id"]
    ev = replace(cand(), instrument_id=sid)
    g.apply(ev, START + timedelta(minutes=5))
    assert g.apply(ev, START + timedelta(minutes=6)).evaluation.decision == Decision.WATCH  # Cooldown nach Neustart
