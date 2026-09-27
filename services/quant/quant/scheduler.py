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
from .repo import resolve
from .runtime import build, stop_event
from .shadow import resolve_shadows

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


def run_sec(conn, settings, now: datetime) -> dict:
    """Form 4 + 13D/G fuer das Aktienuniversum, 13F fuer die Manager-Liste. Fehler je Firma isoliert."""
    from .providers.base import ProviderError
    from .sec.client import SecClient
    from .sec.ingest import SecIngestor

    totals = {"issuers": 0, "managers": 0, "errors": 0}
    try:
        client = SecClient(settings.sec_user_agent)
        tickers = client.ticker_map()
    except ProviderError as exc:
        log.warning("SEC nicht verfuegbar", extra={"event": "sec_unavailable", "error_type": exc.reason})
        return totals
    ing = SecIngestor(conn, client, lambda: datetime.now(timezone.utc))
    since = (now - timedelta(days=120)).date()
    for t in settings.equity_symbols:
        cik = tickers.get(t.upper())
        if not cik:
            continue  # ETFs haben keine Form-4-Meldungen
        try:
            ing.ingest_issuer(cik, since)
            totals["issuers"] += 1
        except ProviderError:
            totals["errors"] += 1
            conn.rollback()
    for cik in settings.sec_13f_managers:
        try:
            ing.ingest_manager(cik, (now - timedelta(days=400)).date())
            totals["managers"] += 1
        except ProviderError:
            totals["errors"] += 1
            conn.rollback()
    log.info("SEC-Abgleich", extra={"event": "sec_ingest", **totals})
    return totals


MACRO_SERIES = ("CPIAUCSL", "CPILFESL", "PCEPILFE", "PAYEMS", "UNRATE", "GDPC1", "INDPRO", "FEDFUNDS", "DGS10", "DGS2",
                "T10Y2Y", "BAMLH0A0HYM2", "VIXCLS", "DTWEXBGS")


def run_macro_and_cot(conn, settings, now: datetime) -> dict:
    """Taeglich: FRED/ALFRED-Vintages (mit Schluessel) und CFTC COT. Ausfall einer Quelle blockiert die andere nicht."""
    from .cot import DEFAULT_CONTRACTS, store_cot
    from .macro import store_vintages
    from .providers.base import ProviderError
    from .providers.cftc import CftcProvider
    from .providers.fred import FredProvider

    totals = {"macro_rows": 0, "cot_rows": 0, "errors": 0}
    if settings.fred_api_key:
        fred = FredProvider(settings.fred_api_key)
        for series in MACRO_SERIES:
            try:
                r = fred.releases(series, (now - timedelta(days=3 * 365)).date())
                totals["macro_rows"] += store_vintages(conn, r.data, received_at=datetime.now(timezone.utc))
                conn.commit()
            except ProviderError as exc:
                conn.rollback()
                totals["errors"] += 1
                log.warning("FRED-Abruf fehlgeschlagen", extra={"event": "fred_failed", "series": series, "error_type": exc.reason})
    cftc = CftcProvider()
    by_type: dict[str, list[str]] = {}
    for code, (rtype, _name) in DEFAULT_CONTRACTS.items():
        by_type.setdefault(rtype, []).append(code)
    for rtype, codes in by_type.items():
        try:
            cot = cftc.reports(rtype, codes, (now - timedelta(days=3 * 365)).date())
            totals["cot_rows"] += store_cot(conn, cot.data, received_at=datetime.now(timezone.utc))
            conn.commit()
        except ProviderError as exc:
            conn.rollback()
            totals["errors"] += 1
            log.warning("CFTC-Abruf fehlgeschlagen", extra={"event": "cftc_failed", "report": rtype, "error_type": exc.reason})
    log.info("Makro/COT-Abgleich", extra={"event": "macro_cot_ingest", **totals})
    return totals


def main() -> None:
    import psycopg

    from .logs import configure_logging
    from .worker import backoff_delay

    configure_logging("scheduler")
    stop = stop_event()
    bot = None
    attempt = 0
    last_outcomes = datetime.min.replace(tzinfo=timezone.utc)
    last_sec = datetime.min.replace(tzinfo=timezone.utc)
    last_macro = datetime.min.replace(tzinfo=timezone.utc)
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
            if now - last_macro >= timedelta(hours=6):
                run_macro_and_cot(conn, _settings, now)
                last_macro = now
            if now - last_sec >= timedelta(minutes=30):
                run_sec(conn, _settings, now)
                last_sec = now
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
