"""
Gezielte Tests fuer die bereits behobenen Fehler A-F und ihre Verschaerfungen.
A/B (Migration) stehen in test_schema.py; hier: C, D, E, F und Mehrfach-Worker.
"""

import threading
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from quant.domain import Decision, FeatureSet, FeatureValue, RegimeState
from quant.features import CryptoInputs, crypto_features
from quant.freshness import POLICIES, assess
from quant.orchestrator import BotOrchestrator
from quant.paper import DuplicateEntryError, PaperPortfolio
from quant.providers.base import FundingRate
from quant.strategies import CryptoMomentumFundingOI
from quant.worker import backoff_delay, run_loop
from tests.fakes import Clock, FakeCrypto, FakeMarket, providers
from tests.helpers import funding, minutes
from tests.test_orchestrator import START, flat_equity, make_bot, uptrend

NOW = datetime(2026, 9, 22, 16, 0, tzinfo=timezone.utc)
CRYPTO = RegimeState("crypto", ("TRENDING_UP", "NORMAL_VOLATILITY", "RISK_ON"), "", {}, "r", NOW)


# --------------------------------------------------------------------------- D: Funding-Freshness
def test_freshness_is_per_data_class_not_global():
    seven_h = NOW - timedelta(hours=7)
    assert assess("funding", seven_h, NOW, interval_hours=8).usable          # 8-h-Funding, 7 h alt: gueltig
    assert not assess("funding", NOW - timedelta(hours=18), NOW, interval_hours=8).usable  # > 2 Intervalle + 1 h
    assert not assess("funding", seven_h, NOW, interval_hours=1).usable      # 1-h-Kontrakt, 7 h alt: veraltet
    assert not assess("trade", NOW - timedelta(minutes=5), NOW).usable      # Trades: Sekunden
    assert assess("sec_13f", NOW - timedelta(days=100), NOW).cls == "quarterly"
    assert assess("cftc_cot", NOW - timedelta(days=6), NOW).cls == "weekly"
    assert assess("nicht_definiert", NOW, NOW).cls == "unknown"
    assert {"trade", "orderbook", "liquidation_feed", "funding", "sec_filing", "sec_13f", "macro_monthly", "cftc_cot"} <= set(POLICIES)


def _momentum_features(funding_age: timedelta, interval_hours: float = 8.0, z: float = 0.5) -> FeatureSet:
    fs = FeatureSet("ins_x", NOW)
    vals = {"close": 3000.0, "ret_240m_pct": 2.5, "ret_60m_pct": 0.5, "oi_change_60m_pct": 3.0, "realized_vol_60m_pct": 50.0,
            "dist_vwap_60m_pct": 0.4}
    for k, v in vals.items():
        fs.add(FeatureValue(k, v, NOW, ("t",), "under_1_min", data_class="candle_1m"))
    fr = assess("funding", NOW - funding_age, NOW, interval_hours=interval_hours)
    fs.add(FeatureValue("funding_rate_8h", 0.0004, NOW - funding_age, ("t",), fr.cls, zscore=z, data_class="funding"))
    return fs


def test_strategy_e_accepts_funding_within_its_interval():
    ev = CryptoMomentumFundingOI().evaluate(_momentum_features(timedelta(hours=7)), CRYPTO)
    assert ev.decision == Decision.LONG_CANDIDATE


def test_strategy_e_rejects_stale_funding():
    ev = CryptoMomentumFundingOI().evaluate(_momentum_features(timedelta(hours=20)), CRYPTO)
    assert ev.decision == Decision.NO_TRADE and "funding_rate_8h" in ev.reasons[0]


def test_feature_engine_never_uses_future_funding():
    spot = minutes([100.0 + i * 0.001 for i in range(600)])
    as_of = spot[-1].ts + timedelta(minutes=1)
    past = funding([0.0001] * 12, start=as_of - timedelta(hours=8 * 12))
    future = [FundingRate(as_of + timedelta(hours=1), 0.05, 8.0)]  # extremer Wert NACH as_of
    fs = crypto_features(CryptoInputs("ins_x", spot, [], None, None, None, None, [*past, *future], [], "t", as_of))
    assert fs.raw("funding_rate_8h") == pytest.approx(0.0001)


def test_strategy_e_receives_funding_in_full_cycle(db):
    clock = Clock(START)
    bot, _ = make_bot(db, clock)
    bot.run_crypto_cycle()
    snap = db.execute("SELECT features FROM feature_snapshots LIMIT 1").fetchone()["features"]
    f = snap["values"]["funding_rate_8h"]
    assert f["data_class"] == "funding" and f["freshness"] == "event"
    reasons = [r["risk_assessment"]["reasons"] for r in db.execute(
        "SELECT risk_assessment FROM signals WHERE strategy_id='crypto_momentum_funding_oi'").fetchall()]
    assert not any("funding_rate_8h" in " ".join(r) for r in reasons), reasons


# --------------------------------------------------------------------------- E: doppelte Einstiege
def _setup_account(db):
    from quant.repo import ensure_instrument
    ensure_instrument(db, "ins_a", "crypto_spot", "A")
    pf = PaperPortfolio(db, "acc")
    db.commit()
    return pf


def _order(pf, t=NOW):
    return pf.place_entry(signal_id=None, instrument_id="ins_a", side="buy", quantity=1, requested_at=t, delay=timedelta(0),
                          stop=90, target=120, time_exit_at=None, reason="t")


def test_order_state_layer_blocks_second_entry(db):
    pf = _setup_account(db)
    _order(pf)
    with pytest.raises(DuplicateEntryError):
        _order(pf)


def test_database_blocks_second_active_entry_even_if_code_is_bypassed(db):
    pf = _setup_account(db)
    _order(pf)
    db.commit()
    with pytest.raises(psycopg.errors.UniqueViolation):
        db.execute("""INSERT INTO paper_orders (order_id, account_id, instrument_id, side, intent, quantity, order_type, requested_at,
                      eligible_at, status, reason) VALUES (%s,'acc','ins_a','buy','open',1,'market',now(),now(),'pending','x')""", (uuid.uuid4(),))
    db.rollback()


def test_database_blocks_entry_while_position_open(db):
    from quant.paper import Fill
    pf = _setup_account(db)
    oid = _order(pf)
    order = db.execute("SELECT * FROM paper_orders WHERE order_id=%s", (oid,)).fetchone()
    pf.fill_entry(order, Fill(100, 1, 0.1, 1, 99, 101, "quote", NOW))
    with pytest.raises(psycopg.errors.UniqueViolation):
        db.execute("""INSERT INTO paper_orders (order_id, account_id, instrument_id, side, intent, quantity, order_type, requested_at,
                      eligible_at, status, reason) VALUES (%s,'acc','ins_a','buy','open',1,'market',now(),now(),'pending','x')""", (uuid.uuid4(),))
    db.rollback()


def test_partial_fill_reserves_remaining_exposure(db):
    from quant.paper import Fill
    pf = _setup_account(db)
    oid = _order(pf)
    db.execute("UPDATE paper_orders SET quantity=10 WHERE order_id=%s", (oid,))
    order = db.execute("SELECT * FROM paper_orders WHERE order_id=%s", (oid,)).fetchone()
    pf.fill_entry(order, Fill(100, 4, 0.4, 1, 99, 101, "quote", NOW))
    order = db.execute("SELECT * FROM paper_orders WHERE order_id=%s", (oid,)).fetchone()
    assert order["status"] == "partially_filled" and order["filled_quantity"] == 4
    view = pf.view({"ins_a": 100.0})
    # 4 gefuellt (Position) + 6 reserviert (Restmenge der Order)
    assert sorted(p.notional for p in view.positions) == [400.0, 600.0]
    with pytest.raises(DuplicateEntryError):
        _order(pf)
    pf.fill_entry(order, Fill(110, 6, 0.6, 1, 109, 111, "quote", NOW))
    pos = db.execute("SELECT quantity, entry_price FROM paper_positions").fetchone()
    assert pos["quantity"] == 10 and pos["entry_price"] == pytest.approx(106.0)


# --------------------------------------------------------------------------- Mehrere Worker
def test_second_worker_skips_cycle_while_first_holds_lock(db):
    clock = Clock(START)
    bot_a, _ = make_bot(db, clock)
    dsn = f"postgresql://quant:quant@{db.info.host}:{db.info.port}/{db.info.dbname}"
    from quant.db import connect
    conn_b = connect(dsn)
    try:
        bot_b = BotOrchestrator(conn_b, providers(FakeCrypto(clock, uptrend), FakeMarket(clock, flat_equity)), mode="paper",
                                account_id="paper-test", starting_cash=100_000, crypto_symbols=("BTCUSDT",), equity_symbols=(), clock=clock)
        holder = psycopg.connect(dsn, autocommit=True)
        holder.execute("SELECT pg_advisory_lock(hashtext('cycle:paper:crypto'))")
        assert bot_b.run_crypto_cycle() is None           # gesperrt -> ueberspringen
        holder.execute("SELECT pg_advisory_unlock(hashtext('cycle:paper:crypto'))")
        holder.close()
        assert bot_a.run_crypto_cycle() is not None       # Sperre frei -> laeuft
        assert db.execute("SELECT count(*) AS n FROM bot_cycles").fetchone()["n"] == 1
    finally:
        conn_b.close()


def test_parallel_workers_produce_each_signal_once(db):
    """Zwei Worker starten gleichzeitig denselben Takt: genau ein Zyklus, keine doppelten Signale."""
    clock = Clock(START)
    make_bot(db, clock)[0].run_crypto_cycle()  # Historie laden
    db.commit()
    clock.t = START + timedelta(minutes=30)
    dsn = f"postgresql://quant:quant@{db.info.host}:{db.info.port}/{db.info.dbname}"
    from quant.db import connect
    results, conns = [], []
    barrier = threading.Barrier(2)

    def worker():
        c = connect(dsn)
        conns.append(c)
        b = BotOrchestrator(c, providers(FakeCrypto(clock, uptrend), FakeMarket(clock, flat_equity)), mode="paper",
                            account_id="paper-test", starting_cash=100_000, crypto_symbols=("BTCUSDT", "ETHUSDT"), equity_symbols=(), clock=clock)
        barrier.wait()
        results.append(b.run_crypto_cycle())

    threads = [threading.Thread(target=worker) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    [c.close() for c in conns]
    ran = [r for r in results if r is not None]
    cycles_at_t = db.execute("SELECT count(*) AS n FROM bot_cycles WHERE started_at=%s", (clock.t,)).fetchone()["n"]
    assert cycles_at_t == len(ran) >= 1
    dup = db.execute("""SELECT count(*) AS n FROM (SELECT cycle_id, instrument_id, strategy_id, count(*) FROM signals
                        GROUP BY 1,2,3 HAVING count(*) > 1) d""").fetchone()["n"]
    assert dup == 0
    active = db.execute("""SELECT instrument_id, count(*) AS n FROM paper_orders WHERE intent='open'
                           AND status IN ('pending','partially_filled') GROUP BY 1""").fetchall()
    assert all(r["n"] == 1 for r in active)


# --------------------------------------------------------------------------- Worker-Robustheit
def test_worker_survives_db_outage_and_reconnects():
    calls = {"build": 0}

    class Rep:
        cycle_id, kill_switch, counts = uuid.uuid4(), None, {}

    class FlakyBot:
        def __init__(self, fail):
            self.fail = fail
            self.conn = type("C", (), {"close": lambda self: None})()

        def run_crypto_cycle(self):
            if self.fail:
                raise psycopg.OperationalError("server closed the connection unexpectedly")
            return Rep()

    def make():
        calls["build"] += 1
        if calls["build"] == 2:
            raise psycopg.OperationalError("connection refused")  # Datenbank kurz weg
        return type("S", (), {"crypto_cycle_seconds": 1})(), FlakyBot(fail=calls["build"] == 1)

    stats = run_loop(make, threading.Event(), max_cycles=3, sleep=lambda s: None)
    assert stats["failed"] == 1 and stats["reconnects"] == 1 and stats["cycles"] == 2
    assert calls["build"] == 3


def test_backoff_has_jitter_and_cap():
    import random
    rng = random.Random(1)
    delays = [backoff_delay(a, rng=rng) for a in range(12)]
    assert all(0 <= d <= 60 for d in delays) and len(set(delays)) == len(delays)
