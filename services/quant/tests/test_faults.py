"""Fehlerinjektion: Der Bot darf bei Ausfaellen nicht unkontrolliert abstuerzen (Fix F und Folgeanforderungen)."""

import time
from datetime import timedelta

import httpx
import pytest

from quant.orchestrator import BotOrchestrator
from quant.providers.base import ProviderError
from quant.providers.binance import BinanceProvider
from quant.providers.http import HttpSource
from tests.fakes import Clock, FakeCrypto, FakeMarket, providers
from tests.test_orchestrator import START, flat_equity, uptrend


class Down:
    """Primaerquelle komplett ausgefallen."""
    source_id = "binance"

    def __getattr__(self, name):
        def fail(*a, **k):
            raise ProviderError("binance", "unavailable", "Timeout")
        return fail


class CoinbaseLike(FakeCrypto):
    source_id = "coinbase"


def _bot(db, clock, crypto, fallbacks=(), symbols=("BTCUSDT", "ETHUSDT")):
    p = providers(crypto, FakeMarket(clock, flat_equity))
    p.crypto_fallbacks = list(fallbacks)
    return BotOrchestrator(db, p, mode="paper", account_id="paper-test", starting_cash=100_000, crypto_symbols=symbols,
                           equity_symbols=(), clock=clock)


def test_binance_down_fallback_working_is_degraded_not_down(db):
    clock = Clock(START)
    fb = CoinbaseLike(clock, uptrend)
    rep = _bot(db, clock, Down(), [fb]).run_crypto_cycle()
    assert rep.kill_switch is None, rep.kill_switch
    assert db.execute("SELECT status FROM bot_cycles").fetchone()["status"] == "completed"
    assert any(e["event_type"] == "provider_fallback" for e in db.execute("SELECT event_type FROM bot_events").fetchall())
    snap = db.execute("SELECT features FROM feature_snapshots LIMIT 1").fetchone()["features"]
    assert "coinbase" in snap["values"]["close"]["source_ids"]
    # Derivate gibt es nur bei der Primaerquelle: Strategien, die sie brauchen, sagen ehrlich NO_TRADE
    reasons = db.execute("SELECT risk_assessment->'reasons' AS r FROM signals WHERE strategy_id='crypto_momentum_funding_oi'").fetchall()
    assert all("funding_rate_8h" in " ".join(r["r"]) or "oi_change" in " ".join(r["r"]) for r in reasons)


def test_all_sources_down_halts_new_orders_without_crashing(db):
    clock = Clock(START)
    rep = _bot(db, clock, Down(), [Down()]).run_crypto_cycle()
    assert rep.kill_switch is not None
    assert db.execute("SELECT count(*) AS n FROM paper_orders").fetchone()["n"] == 0


def test_corrupt_payload_and_missing_field_do_not_crash_cycle(db):
    clock = Clock(START)
    crypto = FakeCrypto(clock, uptrend)
    crypto.premium_index = lambda s: (_ for _ in ()).throw(KeyError("markPrice"))      # Feld fehlt
    crypto.open_interest_history = lambda *a: (_ for _ in ()).throw(ValueError("kein JSON"))  # kaputte Antwort
    rep = _bot(db, clock, crypto).run_crypto_cycle()
    assert db.execute("SELECT status FROM bot_cycles").fetchone()["status"] in ("completed", "halted")
    msgs = [e["message"] for e in db.execute("SELECT message FROM bot_events WHERE event_type='provider_error'").fetchall()]
    assert any("unbrauchbar (KeyError)" in m for m in msgs) and any("unbrauchbar (ValueError)" in m for m in msgs)


def test_binance_parser_rejects_corrupt_payload_as_provider_error():
    t = lambda url, params, headers: httpx.Response(200, json={"unerwartet": True})
    with pytest.raises((ProviderError, ValueError)):
        BinanceProvider(transport=t).spot_bars("BTCUSDT", "1m", 10)


# --- HTTP-Ebene: Timeout, 429, 418, 500 ---------------------------------------------------------
def test_timeout_is_bounded_and_retried_with_jitter():
    calls = []

    def t(url, params, headers):
        calls.append(time.monotonic())
        raise httpx.ReadTimeout("timeout")

    started = time.monotonic()
    with pytest.raises(ProviderError) as exc:
        HttpSource("x", t, retries=2).get("http://x")
    assert exc.value.reason == "unavailable" and len(calls) == 3
    assert time.monotonic() - started < 3.0  # Backoff kurz gekappt, blockiert den Zyklus nicht


def test_rate_limit_respects_retry_after_and_418_is_not_retried():
    seq = [httpx.Response(429, headers={"retry-after": "0"}), httpx.Response(200, json={"ok": 1})]
    resp, _ = HttpSource("x", lambda *a: seq.pop(0), retries=2).get("http://x")
    assert resp.json() == {"ok": 1}
    calls = []
    with pytest.raises(ProviderError) as exc:
        HttpSource("x", lambda *a: calls.append(1) or httpx.Response(418), retries=3).get("http://x")
    assert exc.value.reason == "rate_limited" and len(calls) == 1


def test_server_error_500_is_retried_then_reported():
    calls = []
    with pytest.raises(ProviderError) as exc:
        HttpSource("x", lambda *a: calls.append(1) or httpx.Response(500), retries=1).get("http://x")
    assert exc.value.reason == "unavailable" and len(calls) == 2


def test_parallel_fetch_keeps_cycle_short_when_provider_is_slow(db):
    """Vier Paare, Quote und Orderbuch je 0,2 s langsam: die Abrufphase laeuft parallel statt seriell."""
    clock = Clock(START)
    symbols = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT")
    _bot(db, clock, FakeCrypto(clock, uptrend), symbols=symbols).run_crypto_cycle()  # Historie laden
    clock.t = START + timedelta(minutes=1)
    fetch_time = {}

    class Slow(FakeCrypto):
        def spot_quote(self, symbol):
            time.sleep(0.2)
            return super().spot_quote(symbol)

        def spot_order_book(self, symbol, depth):
            time.sleep(0.2)
            return super().spot_order_book(symbol, depth)

    bot = _bot(db, clock, Slow(clock, uptrend), symbols=symbols)
    original = bot._fetch_crypto

    def timed(*a, **k):
        t0 = time.monotonic()
        try:
            return original(*a, **k)
        finally:
            fetch_time[a[1]] = (t0, time.monotonic())

    bot._fetch_crypto = timed
    bot.run_crypto_cycle()
    start = min(t0 for t0, _ in fetch_time.values())
    end = max(t1 for _, t1 in fetch_time.values())
    # seriell: 4 x 0,4 s = 1,6 s; parallel: gut 0,4 s
    assert end - start < 1.0, end - start
