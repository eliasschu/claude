"""
ProviderHealthService (§83), Kill Switch (§45) und System-Health.

System-Health kennt drei Zustaende: HEALTHY, DEGRADED, UNHEALTHY.
Ein einzelner Datenanbieter- oder WebSocket-Ausfall macht das System nur
DEGRADED, solange eine Ersatzquelle liefert bzw. Kerndienste laufen.
UNHEALTHY ist reserviert fuer: Datenbank weg, Worker/Scheduler tot, oder
KEINE Marktdatenquelle mehr erreichbar.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timedelta

import psycopg

from .db import Conn

MAX_CLOCK_SKEW = timedelta(seconds=5)
ORDER = {"HEALTHY": 0, "DEGRADED": 1, "UNHEALTHY": 2}


class ProviderHealthService:
    def __init__(self, conn: Conn):
        self._conn = conn

    def record(self, source_id: str, status: str, *, checked_at: datetime, latency_ms: float | None = None,
               last_data_at: datetime | None = None, source_time: datetime | None = None, message: str | None = None) -> str:
        """Speichert eine Messung. `source_time` = Uhrzeit laut Quelle (Date-Header) -> Uhrabweichung."""
        skew = (checked_at - source_time).total_seconds() * 1000 if source_time else None
        if status == "ok" and skew is not None and abs(skew) > MAX_CLOCK_SKEW.total_seconds() * 1000:
            status, message = "degraded", f"Uhrabweichung {skew:.0f} ms gegenueber der Quelle"
        self._conn.execute(
            """INSERT INTO provider_health (source_id, checked_at, status, latency_ms, last_data_at, clock_skew_ms, message)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (source_id, checked_at, status, latency_ms, last_data_at, skew, message),
        )
        return status

    def latest(self) -> list[dict]:
        return self._conn.execute(
            """SELECT DISTINCT ON (source_id) source_id, checked_at, status, latency_ms, last_data_at, clock_skew_ms, message
               FROM provider_health ORDER BY source_id, checked_at DESC"""
        ).fetchall()


@dataclass(frozen=True)
class KillSwitchLimits:
    daily_loss_pct: float = 2.0
    max_drawdown_pct: float = 10.0
    max_abnormal_slippage_bps: float = 50.0


def kill_switch_reason(*, equity: float, starting_cash: float, day_start_equity: float | None, core_data_stale: list[str],
                       providers_down: list[str], recent_slippage_bps: list[float], limits: KillSwitchLimits = KillSwitchLimits()) -> str | None:
    """Liefert den ersten verletzten Grund oder None. Aktiv -> keine neuen Orders (bestehende Exits laufen weiter)."""
    if day_start_equity and (equity / day_start_equity - 1) * 100 <= -limits.daily_loss_pct:
        return f"Tagesverlustlimit ({limits.daily_loss_pct} %) erreicht"
    if (equity / starting_cash - 1) * 100 <= -limits.max_drawdown_pct:
        return f"Drawdown-Limit ({limits.max_drawdown_pct} % vom Startkapital) erreicht"
    if providers_down:
        return "Datenquelle ausgefallen: " + ", ".join(providers_down)
    if core_data_stale:
        return "Veraltete Kerndaten: " + ", ".join(core_data_stale)
    if recent_slippage_bps and max(recent_slippage_bps) > limits.max_abnormal_slippage_bps:
        return f"Ungewoehnliche Slippage ({max(recent_slippage_bps):.0f} bps)"
    return None


# ------------------------------------------------------------------------------------ System-Health
@dataclass(frozen=True)
class HealthThresholds:
    worker_max_silence: timedelta = timedelta(minutes=3)
    scheduler_max_silence: timedelta = timedelta(minutes=3)
    ws_max_silence: timedelta = timedelta(minutes=2)
    crypto_cycle_max_age: timedelta = timedelta(minutes=5)
    provider_window: timedelta = timedelta(minutes=15)


def _component(name: str, state: str, reason: str, **extra) -> dict:
    return {"component": name, "state": state, "reason": reason, **extra}


def system_health(conn: Conn, now: datetime, t: HealthThresholds = HealthThresholds(),
                  expect_ws: bool = False, expect_worker: bool = True) -> dict:
    """
    expect_worker=False: lokaler Insider-Betrieb (z. B. auf dem Mac) ohne Handels-Worker. Worker, Krypto-Zyklen und
    Marktdatenquellen werden dann nicht verlangt; massgeblich ist der SEC-Insiderabruf.
    """
    comps: list[dict] = []
    # DATABASE
    started = time.monotonic()
    try:
        conn.execute("SELECT 1")
        latency = (time.monotonic() - started) * 1000
        comps.append(_component("database", "HEALTHY" if latency < 500 else "DEGRADED", f"Antwort in {latency:.0f} ms", latency_ms=latency))
    except psycopg.Error as exc:
        return {"state": "UNHEALTHY", "checked_at": now.isoformat(),
                "components": [_component("database", "UNHEALTHY", f"nicht erreichbar ({type(exc).__name__})")]}

    beats = {r["service"]: r for r in conn.execute(
        "SELECT DISTINCT ON (service) * FROM service_heartbeats ORDER BY service, last_beat DESC").fetchall()}

    def service(name: str, silence: timedelta, required: bool = True) -> None:
        b = beats.get(name)
        if b is None:
            comps.append(_component(name, "UNHEALTHY" if required else "DEGRADED", "kein Heartbeat"))
            return
        age = now - b["last_beat"]
        if age > silence:
            comps.append(_component(name, "UNHEALTHY" if required else "DEGRADED", f"letzter Heartbeat vor {age.total_seconds():.0f} s",
                                    last_beat=b["last_beat"].isoformat()))
        else:
            comps.append(_component(name, b["status"], b["details"].get("reason", "laeuft"), last_beat=b["last_beat"].isoformat()))

    if expect_worker:
        service("worker", t.worker_max_silence)
    service("scheduler", t.scheduler_max_silence)
    insider = _insider_ingest(conn, now)
    # Im Serverbetrieb zaehlt der Insiderabruf erst, sobald er einmal gelaufen ist; lokal ist er die Hauptaufgabe.
    if not expect_worker or insider["state"] != "DEGRADED" or insider.get("ran"):
        comps.append({k: v for k, v in insider.items() if k != "ran"})
    if not expect_worker:
        comps.append(_component("trading_engine", "HEALTHY", "nicht aktiv (lokaler Insider-Betrieb ohne Handels-Worker)"))
        return _overall(comps, now)

    # BOT CORE: letzter Krypto-Zyklus
    # Aktualitaet am juengsten (auch laufenden) Zyklus, Zustand am juengsten ABGESCHLOSSENEN
    newest = conn.execute("SELECT started_at FROM bot_cycles WHERE scope='crypto' ORDER BY started_at DESC LIMIT 1").fetchone()
    cyc = conn.execute("""SELECT status, started_at, error FROM bot_cycles WHERE scope='crypto' AND status <> 'running'
                          ORDER BY started_at DESC LIMIT 5""").fetchall()
    if not newest or not cyc:
        comps.append(_component("bot_core", "UNHEALTHY", "noch kein abgeschlossener Zyklus"))
    else:
        last = {**cyc[0], "started_at": newest["started_at"]}
        failed_in_row = next((i for i, c in enumerate(cyc) if c["status"] != "failed"), len(cyc))
        if now - last["started_at"] > t.crypto_cycle_max_age:
            comps.append(_component("bot_core", "UNHEALTHY", f"letzter Zyklus vor {(now - last['started_at']).total_seconds():.0f} s"))
        elif failed_in_row >= 3:
            comps.append(_component("bot_core", "UNHEALTHY", f"{failed_in_row} Zyklen in Folge fehlgeschlagen: {last['error']}"))
        elif last["status"] in ("halted", "failed"):
            comps.append(_component("bot_core", "DEGRADED", f"letzter Zyklus: {last['status']} (Kill Switch/Fehler, keine neuen Orders)"))
        else:
            comps.append(_component("bot_core", "HEALTHY", "Zyklen laufen"))

    # MARKET DATA PROVIDERS: ein Ausfall mit funktionierender Alternative = DEGRADED
    rows = conn.execute("""SELECT DISTINCT ON (source_id) source_id, status, checked_at, message FROM provider_health
                           WHERE checked_at >= %s ORDER BY source_id, checked_at DESC""", (now - t.provider_window,)).fetchall()
    ok = [r["source_id"] for r in rows if r["status"] == "ok"]
    bad = [r for r in rows if r["status"] in ("down", "degraded")]
    if not rows:
        comps.append(_component("market_data_providers", "UNHEALTHY", "keine Provider-Messung im Zeitfenster"))
    elif not ok:
        comps.append(_component("market_data_providers", "UNHEALTHY", "keine Marktdatenquelle erreichbar",
                                sources={r["source_id"]: r["status"] for r in rows}))
    elif bad:
        comps.append(_component("market_data_providers", "DEGRADED",
                                "Ausfall: " + ", ".join(f"{r['source_id']} ({r['status']})" for r in bad) + "; erreichbar: " + ", ".join(ok),
                                sources={r["source_id"]: r["status"] for r in rows}))
    else:
        comps.append(_component("market_data_providers", "HEALTHY", "alle erreichbar", sources={s: "ok" for s in ok}))

    # WEBSOCKET CONNECTIONS (ws-ingestor meldet je Strom den Zustand)
    b = beats.get("ws-ingestor")
    if b is None:
        comps.append(_component("websocket_connections", "DEGRADED" if expect_ws else "HEALTHY",
                                "ws-ingestor laeuft nicht" if expect_ws else "nicht konfiguriert (REST-Polling)"))
    elif now - b["last_beat"] > t.ws_max_silence:
        comps.append(_component("websocket_connections", "DEGRADED", "ws-ingestor ohne Heartbeat"))
    else:
        streams = b["details"].get("streams", {})
        down = [k for k, v in streams.items() if v.get("state") != "live"]
        # Auch ein komplett ausgefallener WebSocket ist nur DEGRADED: der REST-Zyklus liefert weiter Daten
        state = "HEALTHY" if streams and not down else "DEGRADED"
        comps.append(_component("websocket_connections", state, "alle Stroeme live" if not down else "nicht live: " + ", ".join(down),
                                streams=streams))

    return _overall(comps, now)


def _overall(comps: list[dict], now: datetime) -> dict:
    overall = "HEALTHY"
    for c in comps:
        if ORDER[c["state"]] > ORDER[overall]:
            overall = c["state"]
    return {"state": overall, "checked_at": now.isoformat(), "components": comps}


# Abrufintervall des Insider-Abgleichs (siehe scheduler.SEC_INTERVAL); veraltet nach drei verpassten Laeufen.
INSIDER_STALE_AFTER = timedelta(minutes=90)


def _insider_ingest(conn: Conn, now: datetime) -> dict:
    """SEC-Insiderabruf: ein Quellenausfall ist DEGRADED (Archiv bleibt nutzbar), nie UNHEALTHY."""
    row = conn.execute("SELECT max(finished_at) FILTER (WHERE ok) AS last_ok, max(finished_at) AS last_try FROM ingest_runs "
                       "WHERE task='sec_insider'").fetchone()
    if not row or row["last_ok"] is None:
        ran = bool(row and row["last_try"])
        return _component("insider_ingest", "DEGRADED", "noch kein erfolgreicher SEC-Abruf", ran=ran)
    age = now - row["last_ok"]
    if age > INSIDER_STALE_AFTER:
        return _component("insider_ingest", "DEGRADED", f"letzter erfolgreicher Abruf vor {age.total_seconds() / 60:.0f} min",
                          last_success=row["last_ok"].isoformat(), ran=True)
    return _component("insider_ingest", "HEALTHY", "Abrufe laufen", last_success=row["last_ok"].isoformat())
