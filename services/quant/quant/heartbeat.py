"""Heartbeats: jeder Dienst meldet regelmaessig, dass er lebt und in welchem Zustand er ist."""

from __future__ import annotations

import os
import socket
from datetime import datetime

from psycopg.types.json import Jsonb

from .db import Conn
from .metrics import METRICS

INSTANCE_ID = os.environ.get("HOSTNAME") or socket.gethostname()


def beat(conn: Conn, service: str, *, now: datetime, started_at: datetime, status: str = "HEALTHY",
         details: dict | None = None) -> None:
    conn.execute(
        """INSERT INTO service_heartbeats (service, instance_id, started_at, last_beat, status, details, metrics)
           VALUES (%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (service, instance_id) DO UPDATE SET last_beat=EXCLUDED.last_beat, status=EXCLUDED.status,
             details=EXCLUDED.details, metrics=EXCLUDED.metrics, started_at=EXCLUDED.started_at""",
        (service, INSTANCE_ID, started_at, now, status, Jsonb(details or {}), Jsonb(METRICS.snapshot())),
    )
    conn.commit()
