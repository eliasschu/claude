"""
Makrodaten mit Datenstaenden: Speicherung und "was wusste der Markt am Tag X?".

Jede Fassung (Vintage) ist eine eigene, unveraenderliche Zeile. revision_number 0
ist die Erstveroeffentlichung. Eine Abfrage zum Zeitpunkt X liefert je Periode die
juengste Fassung mit available_at <= X - nie eine spaetere Revision.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from .db import Conn
from .providers.base import MacroRelease
from .providers.fred import release_available_at


def store_vintages(conn: Conn, rows: list[MacroRelease], *, received_at: datetime, mode: str = "live",
                   historical_latency: timedelta = timedelta(minutes=5)) -> int:
    """
    mode="live": received_at = Bot-Uhr. mode="historical": received_at = Veroeffentlichung + Latenz
    (Nachladen fuer Backtests). Bereits gespeicherte Fassungen bleiben unberuehrt.
    """
    n = 0
    by_period: dict[tuple[str, date], list[MacroRelease]] = {}
    for r in rows:
        by_period.setdefault((r.series_id, r.period), []).append(r)
    for (series, period), versions in by_period.items():
        for rev, r in enumerate(sorted(versions, key=lambda x: x.realtime_start)):
            avail = release_available_at(series, r.realtime_start)
            recv = received_at if mode == "live" else avail + historical_latency
            cur = conn.execute(
                """INSERT INTO macro_observations (series_id, observation_period, value, vintage_date, revision_number, available_at,
                                                   received_at, source) VALUES (%s,%s,%s,%s,%s,%s,%s,'fred')
                   ON CONFLICT (series_id, observation_period, vintage_date) DO NOTHING""",
                (series, period, r.value, r.realtime_start, rev, avail, recv))
            n += cur.rowcount
    return n


def macro_as_of(conn: Conn, series_id: str, as_of: datetime, since: date | None = None) -> list[dict]:
    """Je Periode die zum Zeitpunkt as_of bekannte Fassung."""
    return conn.execute(
        """SELECT DISTINCT ON (observation_period) observation_period, value, vintage_date, revision_number, available_at
           FROM macro_observations
           WHERE series_id=%s AND GREATEST(available_at, received_at) <= %s AND (%s::date IS NULL OR observation_period >= %s)
           ORDER BY observation_period, vintage_date DESC""", (series_id, as_of, since, since)).fetchall()
