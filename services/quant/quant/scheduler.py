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

from .outcomes import resolve_outcomes
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
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings, bot = build()
    conn = bot.conn
    stop = stop_event()
    last_outcomes = datetime.min.replace(tzinfo=timezone.utc)
    log.info("scheduler gestartet")
    while not stop.is_set():
        now = datetime.now(timezone.utc)
        try:
            if equity_due(conn, now):
                rep = bot.run_equity_cycle()
                log.info("Aktien-Zyklus %s: %s", rep.cycle_id, rep.counts)
            if now - last_outcomes >= timedelta(minutes=5):
                bench = {"equity": resolve(conn, "ticker", "SPY", "US"), "crypto": resolve(conn, "exchange_symbol", "BTCUSDT", "binance")}
                n = resolve_outcomes(conn, now, bench)
                conn.commit()
                if n:
                    log.info("%s Signal-Ergebnisse aufgeloest", n)
                last_outcomes = now
        except Exception:
            conn.rollback()
            log.exception("Scheduler-Aufgabe fehlgeschlagen")
        stop.wait(30)
    log.info("scheduler beendet")


if __name__ == "__main__":
    main()
