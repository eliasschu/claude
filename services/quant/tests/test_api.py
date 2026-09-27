
import pytest
from fastapi.testclient import TestClient

from quant.orchestrator import BotOrchestrator
from tests.fakes import Clock, FakeCrypto, FakeMarket, providers
from tests.test_orchestrator import START, flat_equity, uptrend


@pytest.fixture()
def client(db, monkeypatch):
    dsn = f"postgresql://quant:quant@{db.info.host}:{db.info.port}/{db.info.dbname}"
    monkeypatch.setenv("DATABASE_URL", dsn)
    monkeypatch.setenv("BOT_API_TOKEN", "geheim")
    monkeypatch.setenv("PAPER_ACCOUNT_ID", "paper-test")
    clock = Clock(START)
    bot = BotOrchestrator(db, providers(FakeCrypto(clock, uptrend), FakeMarket(clock, flat_equity)), mode="paper", account_id="paper-test",
                          starting_cash=100_000, crypto_symbols=("BTCUSDT", "ETHUSDT"), equity_symbols=(), clock=clock)
    bot.run_crypto_cycle()
    from quant.api import app
    with TestClient(app) as c:
        yield c


def test_api_requires_token_and_marks_internal_mode(client):
    assert client.get("/health").json() == {"status": "ok"}
    ready = client.get("/health/ready")
    assert ready.json()["state"] in ("HEALTHY", "DEGRADED", "UNHEALTHY") and set(ready.json()) == {"state", "checked_at"}
    assert client.get("/health/system").status_code == 401 and client.get("/metrics").status_code == 401
    system = client.get("/health/system", headers={"Authorization": "Bearer geheim"}).json()
    assert {c["component"] for c in system["components"]} >= {"database", "bot_core", "worker", "scheduler", "market_data_providers"}
    assert "bot_cycles_total" in client.get("/metrics", headers={"Authorization": "Bearer geheim"}).text
    assert client.get("/bot/status").status_code == 401
    r = client.get("/bot/status", headers={"Authorization": "Bearer geheim"})
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["audience"] == "internal" and body["meta"]["mode"] == "paper"
    assert "keine Wahrscheinlichkeit" in body["meta"]["signal_strength_note"]
    assert body["data"]["current_decisions"]  # echte Zaehlung aus dem Signal-Log


def test_api_signal_detail_events_strategies_and_audit(client):
    h = {"Authorization": "Bearer geheim"}
    sigs = client.get("/signals", headers=h).json()["data"]
    assert sigs
    detail = client.get(f"/signals/{sigs[0]['signal_id']}", headers=h).json()["data"]
    s = detail["signal"]
    for key in ("positive_evidence", "negative_evidence", "invalidation", "data_sources", "data_freshness", "strategy_version",
                "feature_version", "model_version", "risk_version", "market_regime", "content_hash"):
        assert key in s
    assert detail["features"]["version"].startswith("features-")
    assert client.get("/bot/events", headers=h).json()["data"][0]["event_type"] == "cycle_finished"
    assert len(client.get("/strategies", headers=h).json()["data"]["strategies"]) == 5
    assert client.get("/audit/verify", headers=h).json()["data"]["chain_intact"] is True
    perf = client.get("/paper/performance", headers=h).json()["data"]["overall"]
    assert perf["sample_size"] == 0 and perf["win_rate"] is None
    assert client.get("/paper/portfolio", headers=h).json()["data"]["cash"] == 100_000
    assert client.get("/signals/00000000-0000-0000-0000-000000000000", headers=h).status_code == 404
    assert client.get("/trades/00000000-0000-0000-0000-000000000000/explain", headers=h).status_code == 404


def test_live_mode_cannot_be_configured(monkeypatch):
    from quant.config import load_settings
    monkeypatch.setenv("BOT_MODE", "live")
    with pytest.raises(RuntimeError):
        load_settings()
