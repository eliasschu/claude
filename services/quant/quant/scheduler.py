"""
scheduler: zeitgesteuerte Aufgaben ausserhalb des Krypto-Takts.
  * Aktien-Zyklus einmal je US-Handelstag nach 18:15 New York (EOD-Daten)
  * Ergebnisaufloesung vergangener Signale alle 5 Minuten
Doppelte Ausfuehrung wird ueber bot_cycles verhindert (auch bei Neustart).
"""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .heartbeat import beat
from .outcomes import resolve_outcomes
from .shadow import resolve_shadows
from .repo import resolve
from .runtime import build, stop_event

log = logging.getLogger("quant.scheduler")
NEW_YORK = ZoneInfo("America/New_York")
EQUITY_RUN_AFTER = time(18, 15)


def equity_due(conn, now: datetime) -> bool:
    ny = now.astimezone(NEW_YORK)
    if ny.weekday() >= 5 or ny.time() < EQUITY_RUN_AFTER:
        return False
    day_start = datetime.combine(ny.date(), time(0), tzinfo=NEW_YORK).astimezone(timezone.utc)
    row = conn.execute("SELECT 1 FROM bot_cycles WHERE scope='equity_us' AND status IN ('completed','halted') AND started_at >= %s",
                       (day_start,)).fetchone()
    return row is None


def main() -> None:
    import psycopg

    from .logs import configure_logging
    from .worker import backoff_delay

    configure_logging("scheduler")
    stop = stop_event()
    bot = None
    attempt = 0
    last_outcomes = datetime.min.replace(tzinfo=timezone.utc)
    started_at = datetime.now(timezone.utc)
    log.info("scheduler gestartet", extra={"event": "service_started"})
    while not stop.is_set():
        if bot is None:
            try:
                _settings, bot = build()
                attempt = 0
            except psycopg.OperationalError as exc:
                delay = backoff_delay(attempt)
                attempt += 1
                log.warning("Datenbank nicht erreichbar", extra={"event": "db_unavailable", "error_type": type(exc).__name__})
                stop.wait(delay)
                continue
        conn = bot.conn
        now = datetime.now(timezone.utc)
        try:
            beat(conn, "scheduler", now=now, started_at=started_at, details={"reason": "laeuft"})
            if equity_due(conn, now):
                rep = bot.run_equity_cycle()
                if rep is not None:
                    log.info("Aktien-Zyklus beendet", extra={"event": "cycle_finished", "cycle_id": str(rep.cycle_id), "counts": rep.counts})
            if now - last_outcomes >= timedelta(minutes=5):
                bench = {"equity": resolve(conn, "ticker", "SPY", "US"), "crypto": resolve(conn, "exchange_symbol", "BTCUSDT", "binance")}
                n = resolve_outcomes(conn, now, bench)
                n_shadow = resolve_shadows(conn, now)
                conn.commit()
                log.info("Ergebnisse aufgeloest", extra={"event": "outcomes_resolved", "count": n, "shadow_count": n_shadow})
                last_outcomes = now
        except (psycopg.OperationalError, psycopg.InterfaceError) as exc:
            log.error("Datenbankverbindung verloren", extra={"event": "db_connection_lost", "error_type": type(exc).__name__})
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
            bot = None
            continue
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            log.exception("Scheduler-Aufgabe fehlgeschlagen", extra={"event": "task_failed", "error_type": type(exc).__name__})
        stop.wait(30)
    log.info("scheduler beendet", extra={"event": "service_stopped"})


if __name__ == "__main__":
    main()
