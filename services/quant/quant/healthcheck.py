"""
Container-Healthcheck: `python -m quant.healthcheck <service>` -> Exit 0 (gesund/degradiert) oder 1.

Prueft den eigenen Heartbeat in der Datenbank. DEGRADED gilt fuer Docker als
gesund - ein Anbieterausfall soll keinen Neustart-Kreislauf ausloesen.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

import psycopg

from .config import load_settings
from .db import connect

MAX_SILENCE = {"bot-worker": timedelta(minutes=3), "worker": timedelta(minutes=3), "scheduler": timedelta(minutes=3),
               "ws-ingestor": timedelta(minutes=2)}


def check(service: str) -> tuple[bool, str]:
    name = "worker" if service == "bot-worker" else service
    try:
        with connect(load_settings().database_url) as conn:
            row = conn.execute("SELECT last_beat, status FROM service_heartbeats WHERE service=%s ORDER BY last_beat DESC LIMIT 1",
                               (name,)).fetchone()
    except psycopg.Error as exc:
        return False, f"Datenbank nicht erreichbar: {type(exc).__name__}"
    if row is None:
        return False, "kein Heartbeat"
    age = datetime.now(timezone.utc) - row["last_beat"]
    if age > MAX_SILENCE.get(service, timedelta(minutes=3)):
        return False, f"Heartbeat {age.total_seconds():.0f} s alt"
    return row["status"] != "UNHEALTHY", f"{row['status']}, Heartbeat vor {age.total_seconds():.0f} s"


if __name__ == "__main__":
    ok, msg = check(sys.argv[1] if len(sys.argv) > 1 else "worker")
    print(msg)
    sys.exit(0 if ok else 1)
