"""
Bot-API fuer das Frontend (nur lesend).

Rechtlicher Entwicklungsmodus: Die API ist INTERN. Jeder Aufruf braucht das
Token aus BOT_API_TOKEN; jede Antwort traegt Betriebsart und Hinweis. Es gibt
keinen Endpunkt, der Orders ausloest oder Signale veraendert.
"""

from __future__ import annotations

import hmac
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import PlainTextResponse
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import BOT_VERSION
from .audit import SignalAuditService
from .config import load_settings
from .db import one
from .domain import STRENGTH_DISCLAIMER
from .health import ProviderHealthService, system_health
from .metrics import METRICS
from .strategies import StrategyRegistry

NOTICE = {
    "audience": "internal",
    "disclaimer": "Interner Research- und Paper-Trading-Betrieb. Keine Anlageberatung, keine Empfehlung, kein Handel mit echtem Geld.",
    "signal_strength_note": STRENGTH_DISCLAIMER,
}

_pool: ConnectionPool | None = None


def _configure(conn) -> None:
    conn.execute("SET TIME ZONE 'UTC'")
    conn.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _pool
    settings = load_settings()
    _pool = ConnectionPool(settings.database_url, min_size=1, max_size=5, kwargs={"row_factory": dict_row, "autocommit": True},
                           configure=_configure, open=True)
    yield
    _pool.close()


app = FastAPI(title="Trading Intelligence – Bot API", version=BOT_VERSION, lifespan=lifespan)


def db():
    assert _pool is not None
    with _pool.connection() as conn:
        yield conn


def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("BOT_API_TOKEN")
    if not expected:
        raise HTTPException(503, "BOT_API_TOKEN ist nicht gesetzt - API bleibt gesperrt.")
    given = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(given, expected):
        raise HTTPException(401, "Nicht autorisiert")


def envelope(data: Any, mode: str | None = None) -> dict:
    return {"data": data, "meta": {**NOTICE, "mode": mode or load_settings().mode, "bot_version": BOT_VERSION,
                                   "generated_at": datetime.now(timezone.utc).isoformat()}}


Auth = Depends(require_token)


@app.get("/health")
def health(conn=Depends(db)) -> dict:
    """Liveness: Prozess und Datenbank erreichbar."""
    conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/health/ready")
def health_ready(response: Response, conn=Depends(db)) -> dict:
    """Readiness ohne Token: nur der Gesamtzustand. 503 nur bei UNHEALTHY (DEGRADED bleibt 200)."""
    h = system_health(conn, datetime.now(timezone.utc), expect_ws=os.environ.get("EXPECT_WEBSOCKETS", "false") == "true")
    if h["state"] == "UNHEALTHY":
        response.status_code = 503
    return {"state": h["state"], "checked_at": h["checked_at"]}


@app.get("/health/system", dependencies=[Depends(require_token)])
def health_system(conn=Depends(db)) -> dict:
    """Vollstaendige Komponentenansicht: DATABASE, BOT CORE, SCHEDULER, WORKER, PROVIDER, WEBSOCKETS."""
    return system_health(conn, datetime.now(timezone.utc), expect_ws=os.environ.get("EXPECT_WEBSOCKETS", "false") == "true")


@app.get("/metrics", dependencies=[Depends(require_token)], response_class=PlainTextResponse)
def metrics(conn=Depends(db)) -> str:
    """Prometheus-Textformat: API-Prozess + letzter Stand der Dienste aus ihren Heartbeats."""
    lines = [METRICS.render()]
    for b in conn.execute("SELECT service, instance_id, metrics FROM service_heartbeats").fetchall():
        for name, series in b["metrics"].get("counters", {}).items():
            for labels, value in series.items():
                extra = ",".join(f'{k}="{v}"' for k, v in (p.split("=", 1) for p in labels.split(",") if p))
                lab = f'service="{b["service"]}",instance="{b["instance_id"]}"' + (f",{extra}" if extra else "")
                lines.append(f"{name}{{{lab}}} {value}")
    return "\n".join(lines) + "\n"


@app.get("/bot/status", dependencies=[Auth])
def bot_status(conn=Depends(db)) -> dict:
    cycles = conn.execute(
        """SELECT DISTINCT ON (scope) scope, cycle_id, started_at, finished_at, status, counts, error
           FROM bot_cycles ORDER BY scope, started_at DESC""").fetchall()
    regimes = conn.execute(
        """SELECT DISTINCT ON (scope) scope, as_of, labels, explanation, regime_version FROM regime_snapshots
           ORDER BY scope, as_of DESC""").fetchall()
    # Aktueller Stand je Instrument/Strategie = juengstes Signal (nur echte Zaehlung)
    current = conn.execute(
        """SELECT decision, count(*) AS n FROM (
             SELECT DISTINCT ON (instrument_id, strategy_id) decision, created_at FROM signals
             ORDER BY instrument_id, strategy_id, seq DESC) s
           -- nur Staende, die zum letzten Bot-Lauf passen (nicht Tage alte Einzelsignale)
           WHERE created_at >= (SELECT max(created_at) FROM signals) - interval '2 days' GROUP BY decision""").fetchall()
    universe = conn.execute(
        """SELECT CASE WHEN i.asset_class LIKE 'crypto%' THEN 'crypto' ELSE 'equity' END AS g, count(DISTINCT b.instrument_id) AS n
           FROM bars b JOIN instruments i USING (instrument_id) WHERE b.received_at >= now() - interval '3 days' GROUP BY 1""").fetchall()
    last_data = one(conn.execute("SELECT max(received_at) AS t FROM bars"))["t"]
    kill = conn.execute(
        "SELECT created_at, message FROM bot_events WHERE event_type='kill_switch' ORDER BY event_id DESC LIMIT 1").fetchone()
    worker_alive = any(c["started_at"] >= datetime.now(timezone.utc) - timedelta(minutes=5) for c in cycles)
    return envelope({
        "online": worker_alive,
        "cycles": cycles,
        "regimes": regimes,
        "current_decisions": {r["decision"]: r["n"] for r in current},
        "universe_monitored": {r["g"]: r["n"] for r in universe},
        "last_data_update": last_data,
        "last_kill_switch": kill,
    })


@app.get("/bot/events", dependencies=[Auth])
def bot_events(conn=Depends(db), limit: int = Query(100, le=500), after_id: int | None = None,
               min_severity: str = "info") -> dict:
    order = ["debug", "info", "notice", "warning", "error", "critical"]
    allowed = order[order.index(min_severity):] if min_severity in order else order
    rows = conn.execute(
        """SELECT event_id, created_at, event_type, severity, instrument_id, signal_id, message, payload FROM bot_events
           WHERE (%s::bigint IS NULL OR event_id > %s) AND severity = ANY(%s) ORDER BY event_id DESC LIMIT %s""",
        (after_id, after_id, allowed, limit)).fetchall()
    return envelope(rows)


@app.get("/signals", dependencies=[Auth])
def list_signals(conn=Depends(db), decision: str | None = None, instrument_id: str | None = None,
                 strategy_id: str | None = None, limit: int = Query(100, le=500)) -> dict:
    rows = conn.execute(
        """SELECT s.signal_id, s.created_at, s.instrument_id, i.name AS instrument_name, s.strategy_id, s.strategy_version,
                  s.direction, s.decision, s.signal_strength, s.price_at_signal, s.price_basis, s.time_horizon,
                  s.market_regime->'labels' AS regime_labels, s.risk_assessment->>'summary' AS summary
           FROM signals s JOIN instruments i USING (instrument_id)
           WHERE (%s::text IS NULL OR s.decision=%s) AND (%s::text IS NULL OR s.instrument_id=%s)
             AND (%s::text IS NULL OR s.strategy_id=%s)
           ORDER BY s.seq DESC LIMIT %s""",
        (decision, decision, instrument_id, instrument_id, strategy_id, strategy_id, limit)).fetchall()
    return envelope(rows)


@app.get("/signals/{signal_id}", dependencies=[Auth])
def get_signal(signal_id: uuid.UUID, conn=Depends(db)) -> dict:
    s = conn.execute("SELECT * FROM signals WHERE signal_id=%s", (signal_id,)).fetchone()
    if not s:
        raise HTTPException(404, "Signal nicht gefunden")
    outcomes = conn.execute("SELECT * FROM signal_outcomes WHERE signal_id=%s ORDER BY observed_at", (signal_id,)).fetchall()
    features = conn.execute("SELECT features FROM feature_snapshots WHERE feature_snapshot_id=%s",
                            (s["feature_snapshot_id"],)).fetchone() if s["feature_snapshot_id"] else None
    return envelope({"signal": s, "outcomes": outcomes, "features": features["features"] if features else None}, s["mode"])


@app.get("/trades/{position_id}/explain", dependencies=[Auth])
def trade_explain(position_id: uuid.UUID, conn=Depends(db)) -> dict:
    """Warum wurde dieser Trade eroeffnet? Signal, Begruendung, Eingangsmerkmale, Risk, Order, Ausfuehrung, Ergebnis."""
    from .backtest.explain import explain_trade
    x = explain_trade(conn, position_id)
    if x is None:
        raise HTTPException(404, "Trade nicht gefunden")
    return envelope(x)


@app.get("/strategies", dependencies=[Auth])
def strategies() -> dict:
    reg = StrategyRegistry()
    return envelope({"registry_version": reg.version, "strategies": [s.as_dict() for s in reg.specs()]})


@app.get("/paper/portfolio", dependencies=[Auth])
def paper_portfolio(conn=Depends(db)) -> dict:
    account = load_settings().paper_account_id
    acc = conn.execute("SELECT * FROM paper_accounts WHERE account_id=%s", (account,)).fetchone()
    if not acc:
        return envelope(None)
    positions = conn.execute(
        """SELECT p.*, i.name, i.asset_class,
                  (SELECT close FROM bars b WHERE b.instrument_id=p.instrument_id ORDER BY ts DESC LIMIT 1) AS last_close
           FROM paper_positions p JOIN instruments i USING (instrument_id)
           WHERE p.account_id=%s AND p.closed_at IS NULL ORDER BY opened_at""", (account,)).fetchall()
    closed = conn.execute(
        """SELECT p.*, i.name FROM paper_positions p JOIN instruments i USING (instrument_id)
           WHERE p.account_id=%s AND p.closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 100""", (account,)).fetchall()
    cash = one(conn.execute(
        """SELECT %s - COALESCE(SUM(CASE WHEN o.side='buy' THEN f.price*f.quantity + f.fee ELSE -(f.price*f.quantity) + f.fee END),0) AS c
           FROM paper_orders o JOIN paper_fills f USING (order_id) WHERE o.account_id=%s""", (acc["starting_cash"], account)))["c"]
    mtm = sum((p["last_close"] or p["entry_price"]) * p["quantity"] * (1 if p["side"] == "long" else -1) for p in positions)
    return envelope({"account": acc, "cash": cash, "equity_mark_to_market": cash + mtm,
                     "mark_basis": "letzter gespeicherter Schlusskurs je Instrument", "open_positions": positions, "closed_positions": closed})


@app.get("/paper/performance", dependencies=[Auth])
def paper_performance(conn=Depends(db)) -> dict:
    """Kennzahlen NUR aus geschlossenen Paper-Trades - mit Stichprobengroesse, ohne Hochrechnung."""
    account = load_settings().paper_account_id
    rows = conn.execute(
        """SELECT p.realized_pnl, p.entry_price, p.quantity, p.closed_at, s.strategy_id
           FROM paper_positions p JOIN signals s USING (signal_id)
           WHERE p.account_id=%s AND p.closed_at IS NOT NULL ORDER BY p.closed_at""", (account,)).fetchall()
    return envelope({"overall": _stats(rows), "by_strategy": {sid: _stats([r for r in rows if r["strategy_id"] == sid])
                                                                for sid in sorted({r["strategy_id"] for r in rows})}})


def _stats(rows: list[dict]) -> dict:
    pnl = [r["realized_pnl"] for r in rows]
    wins = [p for p in pnl if p > 0]
    losses = [p for p in pnl if p <= 0]
    equity, peak, max_dd = 0.0, 0.0, 0.0
    for p in pnl:
        equity += p
        peak = max(peak, equity)
        max_dd = min(max_dd, equity - peak)
    return {
        "sample_size": len(pnl), "wins": len(wins), "losses": len(losses),
        "win_rate": len(wins) / len(pnl) if pnl else None,
        "average_win": sum(wins) / len(wins) if wins else None,
        "average_loss": sum(losses) / len(losses) if losses else None,
        "profit_factor": (sum(wins) / -sum(losses)) if losses and sum(losses) < 0 else None,
        "expectancy": sum(pnl) / len(pnl) if pnl else None,
        "total_pnl": sum(pnl), "max_drawdown_realized": max_dd,
        "note": "Zu kleine Stichprobe fuer belastbare Aussagen." if len(pnl) < 30 else None,
    }


@app.get("/providers/health", dependencies=[Auth])
def providers_health(conn=Depends(db)) -> dict:
    return envelope(ProviderHealthService(conn).latest())


MESSAGE_COLUMNS = """message_id, kind, rule_version, ticker, issuer_cik, issuer_name, title, relevance, uncertainty, counter_arguments,
                     observations, sources, selection, value_usd, traded_from, traded_to, published_at, detected_at, mode, content_hash"""


@app.get("/messages", dependencies=[Auth])
def list_messages(conn=Depends(db), limit: int = Query(50, ge=1, le=500), ticker: str | None = None,
                  since: datetime | None = None) -> dict:
    """Archivierte Bot-Meldungen, neueste Erkennung zuerst. Unveraenderlich; detected_at ist der erste Erkennungszeitpunkt."""
    where: list[str] = ["mode = 'live'"]
    params: list[object] = []
    if ticker:
        where.append("ticker = %s")
        params.append(ticker.upper())
    if since:
        where.append("detected_at >= %s")
        params.append(since)
    rows = conn.execute(f"SELECT {MESSAGE_COLUMNS} FROM bot_messages WHERE {' AND '.join(where)} ORDER BY detected_at DESC, message_id LIMIT %s",
                        (*params, limit)).fetchall()
    return envelope(rows)


@app.get("/messages/{message_id}", dependencies=[Auth])
def get_message(message_id: uuid.UUID, conn=Depends(db)) -> dict:
    row = conn.execute(f"SELECT {MESSAGE_COLUMNS} FROM bot_messages WHERE message_id = %s", (message_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Meldung nicht gefunden")
    return envelope(row)


@app.get("/audit/verify", dependencies=[Auth])
def audit_verify(conn=Depends(db)) -> dict:
    ok, problems = SignalAuditService(conn).verify_chain()
    return envelope({"chain_intact": ok, "problems": problems[:50]})
