"""Gemeinsamer Start fuer Worker und Scheduler: Einstellungen, Migration, Verbindungen."""

from __future__ import annotations

import logging
import signal
import threading

from .config import Settings, load_settings
from .db import connect, migrate
from .events import BotEventLog
from .orchestrator import BotOrchestrator
from .providers.registry import default_providers

log = logging.getLogger("quant")


def build(settings: Settings | None = None) -> tuple[Settings, BotOrchestrator]:
    s = settings or load_settings()
    conn = connect(s.database_url)
    applied = migrate(conn)
    if applied:
        log.info("Migrationen angewandt: %s", applied)
    redis_client = None
    if s.redis_url:
        import redis

        redis_client = redis.Redis.from_url(s.redis_url, socket_timeout=2)
    bot = BotOrchestrator(conn, default_providers(), mode=s.mode, account_id=s.paper_account_id, starting_cash=s.paper_starting_cash,
                          crypto_symbols=s.crypto_symbols, equity_symbols=s.equity_symbols, events=BotEventLog(conn, redis_client),
                          shadow=s.shadow_execution)
    return s, bot


def stop_event() -> threading.Event:
    """SIGTERM/SIGINT beenden die Schleifen sauber nach dem laufenden Zyklus (Docker stop)."""
    ev = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: ev.set())
    return ev
