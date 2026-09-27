"""BotEventLog: jede Entscheidung, Ablehnung und Stoerung als append-only Ereignis (§6 Live-Feed)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from .db import Conn, one

REDIS_CHANNEL = "bot:events"


class BotEventLog:
    def __init__(self, conn: Conn, redis_client: Any | None = None):
        self._conn = conn
        self._redis = redis_client

    def emit(self, event_type: str, message: str, *, severity: str = "info", cycle_id: uuid.UUID | None = None,
             instrument_id: str | None = None, signal_id: uuid.UUID | None = None, payload: dict | None = None,
             at: datetime | None = None) -> int:
        created = at or datetime.now(timezone.utc)
        row = one(self._conn.execute(
            """INSERT INTO bot_events (created_at, cycle_id, event_type, severity, instrument_id, signal_id, message, payload)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING event_id""",
            (created, cycle_id, event_type, severity, instrument_id, signal_id, message, Jsonb(payload or {})),
        ))
        if self._redis is not None:
            try:
                self._redis.publish(REDIS_CHANNEL, json.dumps({
                    "event_id": row["event_id"], "created_at": created.isoformat(), "event_type": event_type,
                    "severity": severity, "instrument_id": instrument_id, "message": message,
                }))
            except Exception:  # noqa: BLE001 - Redis ist nur Beschleuniger; die Datenbank bleibt die Wahrheit
                pass
        return row["event_id"]
