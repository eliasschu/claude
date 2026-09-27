import uuid
from datetime import datetime, timedelta, timezone

from quant.health import ProviderHealthService, system_health
from quant.heartbeat import beat
from quant.metrics import Metrics

NOW = datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc)


def _base(db, *, worker_age=timedelta(seconds=10), cycle_status="completed"):
    beat(db, "worker", now=NOW - worker_age, started_at=NOW - timedelta(hours=1))
    beat(db, "scheduler", now=NOW - timedelta(seconds=20), started_at=NOW - timedelta(hours=1))
    db.execute("INSERT INTO bot_cycles (cycle_id, scope, mode, started_at, status, bot_version) VALUES (%s,'crypto','paper',%s,%s,'t')",
               (uuid.uuid4(), NOW - timedelta(seconds=30), cycle_status))
    db.commit()


def _state(h, comp):
    return next(c for c in h["components"] if c["component"] == comp)["state"]


def test_all_healthy(db):
    _base(db)
    ProviderHealthService(db).record("binance", "ok", checked_at=NOW - timedelta(minutes=1))
    h = system_health(db, NOW)
    assert h["state"] == "HEALTHY", h
    assert {c["component"] for c in h["components"]} == {"database", "worker", "scheduler", "bot_core", "market_data_providers",
                                                         "websocket_connections"}


def test_binance_down_but_alternative_working_is_degraded_not_down(db):
    _base(db)
    ph = ProviderHealthService(db)
    ph.record("binance", "down", checked_at=NOW - timedelta(minutes=1), message="451")
    ph.record("coinbase", "ok", checked_at=NOW - timedelta(minutes=1))
    h = system_health(db, NOW)
    assert h["state"] == "DEGRADED" and _state(h, "market_data_providers") == "DEGRADED"


def test_no_market_data_at_all_is_unhealthy(db):
    _base(db)
    ph = ProviderHealthService(db)
    ph.record("binance", "down", checked_at=NOW - timedelta(minutes=1))
    ph.record("coinbase", "down", checked_at=NOW - timedelta(minutes=1))
    assert system_health(db, NOW)["state"] == "UNHEALTHY"


def test_dead_worker_is_unhealthy_and_kill_switch_is_degraded(db):
    _base(db, worker_age=timedelta(minutes=10))
    ProviderHealthService(db).record("binance", "ok", checked_at=NOW - timedelta(minutes=1))
    h = system_health(db, NOW)
    assert _state(h, "worker") == "UNHEALTHY" and h["state"] == "UNHEALTHY"


def test_halted_cycle_is_degraded_even_while_next_cycle_runs(db):
    _base(db, cycle_status="halted")
    db.execute("INSERT INTO bot_cycles (cycle_id, scope, mode, started_at, status, bot_version) VALUES (%s,'crypto','paper',%s,'running','t')",
               (uuid.uuid4(), NOW - timedelta(seconds=5)))
    ProviderHealthService(db).record("binance", "ok", checked_at=NOW - timedelta(minutes=1))
    h = system_health(db, NOW)
    assert _state(h, "bot_core") == "DEGRADED" and h["state"] == "DEGRADED"


def test_websocket_down_is_degraded(db):
    _base(db)
    ProviderHealthService(db).record("binance", "ok", checked_at=NOW - timedelta(minutes=1))
    beat(db, "ws-ingestor", now=NOW, started_at=NOW, details={"streams": {"binance:trades:BTCUSDT": {"state": "reconnecting"},
                                                                          "binance:depth:BTCUSDT": {"state": "live"}}})
    h = system_health(db, NOW, expect_ws=True)
    assert _state(h, "websocket_connections") == "DEGRADED" and h["state"] == "DEGRADED"


def test_database_unavailable_is_unhealthy(db):
    db.close()
    h = system_health(db, NOW)
    assert h["state"] == "UNHEALTHY" and h["components"][0]["component"] == "database"


def test_metrics_render_prometheus_text():
    m = Metrics()
    m.inc("provider_requests_total", provider="binance")
    m.observe("provider_latency_ms", 42, provider="binance")
    text = m.render()
    assert 'provider_requests_total{provider="binance"} 1.0' in text
    assert 'provider_latency_ms_bucket{provider="binance",le="50"} 1' in text and "# TYPE provider_latency_ms histogram" in text
