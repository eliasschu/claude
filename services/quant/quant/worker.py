"""
bot-worker: dauerhaft laufender Prozess fuer den Krypto-Zyklus.
Laeuft unabhaengig davon, ob jemand die Website geoeffnet hat.

Robustheit
 * Ein fehlgeschlagener Zyklus beendet den Worker nie.
 * Bricht die Datenbankverbindung ab, wird sie mit exponentiellem Backoff +
   Jitter neu aufgebaut (keine aggressive Endlosschleife).
 * Laeuft der Zyklus bereits in einer anderen Worker-Instanz (Sperre), wird
   der Takt uebersprungen.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from typing import Callable

import psycopg

from datetime import datetime, timezone

from .heartbeat import beat
from .runtime import build, stop_event

log = logging.getLogger("quant.worker")

MAX_BACKOFF_S = 60.0


def backoff_delay(attempt: int, base: float = 1.0, cap: float = MAX_BACKOFF_S, rng: random.Random | None = None) -> float:
    """Exponentiell mit 'full jitter' (AWS-Architekturempfehlung): gleichverteilt in [0, min(cap, base*2^attempt)]."""
    r = rng or random
    return r.uniform(0, min(cap, base * 2 ** attempt))


def _beat(bot, rep, started_at: datetime) -> None:
    """Heartbeat nach jedem Takt; ein Kill Switch ist DEGRADED (Dienst lebt, handelt aber nicht)."""
    conn = getattr(bot, "conn", None)
    if conn is None or not hasattr(conn, "execute"):
        return
    if rep is None:
        status, reason = "HEALTHY", "Takt uebersprungen (Zyklus laeuft in anderer Instanz)"
    elif rep.kill_switch:
        status, reason = "DEGRADED", f"Kill Switch: {rep.kill_switch}"
    elif rep.fallbacks:
        status, reason = "DEGRADED", "Ersatzquelle aktiv: " + ", ".join(sorted(rep.fallbacks))
    else:
        status, reason = "HEALTHY", "Zyklus abgeschlossen"
    try:
        beat(conn, "worker", now=datetime.now(timezone.utc), started_at=started_at, status=status, details={"reason": reason})
    except psycopg.Error:
        conn.rollback()


def run_loop(make_bot: Callable[[], tuple[object, object]], stop: threading.Event, *, max_cycles: int | None = None,
             sleep: Callable[[float], None] | None = None) -> dict:
    """Testbare Hauptschleife. Rueckgabe: Zaehler fuer Tests/Diagnose."""
    wait = sleep or stop.wait
    stats = {"cycles": 0, "failed": 0, "skipped_locked": 0, "reconnects": 0}
    bot = None
    settings = None
    attempt = 0
    started_at = datetime.now(timezone.utc)
    while not stop.is_set() and (max_cycles is None or stats["cycles"] + stats["failed"] + stats["skipped_locked"] < max_cycles):
        if bot is None:
            try:
                settings, bot = make_bot()
                attempt = 0
            except psycopg.OperationalError as exc:
                delay = backoff_delay(attempt)
                attempt += 1
                stats["reconnects"] += 1
                log.warning("Datenbank nicht erreichbar", extra={"event": "db_unavailable", "error_type": type(exc).__name__,
                                                                  "retry_in_s": round(delay, 2)})
                wait(delay)
                continue
        started = time.monotonic()
        try:
            rep = bot.run_crypto_cycle()  # type: ignore[attr-defined]
            _beat(bot, rep, started_at)
            if rep is None:
                stats["skipped_locked"] += 1
                log.info("Zyklus uebersprungen: laeuft bereits in anderer Instanz", extra={"event": "cycle_skipped_locked"})
            else:
                stats["cycles"] += 1
                log.info("Zyklus beendet", extra={"event": "cycle_finished", "cycle_id": str(rep.cycle_id), "status": "halted" if rep.kill_switch else "completed",
                                                  "duration_ms": round((time.monotonic() - started) * 1000), "counts": rep.counts})
        except (psycopg.OperationalError, psycopg.InterfaceError) as exc:
            stats["failed"] += 1
            log.error("Datenbankverbindung verloren - baue neu auf", extra={"event": "db_connection_lost", "error_type": type(exc).__name__})
            try:
                bot.conn.close()  # type: ignore[attr-defined]
            except Exception:  # noqa: BLE001 - Verbindung ist ohnehin kaputt
                pass
            bot = None
            continue
        except Exception as exc:  # noqa: BLE001 - ein Zyklusfehler darf den Worker nicht beenden
            stats["failed"] += 1
            log.exception("Krypto-Zyklus fehlgeschlagen", extra={"event": "cycle_failed", "error_type": type(exc).__name__})
        period = getattr(settings, "crypto_cycle_seconds", 60)
        wait(max(1.0, period - (time.monotonic() - started)))
    return stats


def main() -> None:
    from .logs import configure_logging

    configure_logging("bot-worker")
    stop = stop_event()
    log.info("bot-worker gestartet", extra={"event": "service_started"})
    run_loop(build, stop)
    log.info("bot-worker beendet", extra={"event": "service_stopped"})


if __name__ == "__main__":
    main()
