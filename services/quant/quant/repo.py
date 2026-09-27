"""Lesen/Schreiben von Stammdaten, Balken und Point-in-Time-Beobachtungen."""

from __future__ import annotations

from datetime import datetime
from typing import Iterable, Sequence

import psycopg
from psycopg.types.json import Jsonb

from .providers.base import Bar


def ensure_instrument(conn: psycopg.Connection, instrument_id: str, asset_class: str, name: str, *, currency: str | None = None,
                      base_asset: str | None = None, quote_asset: str | None = None, exchange_mic: str | None = None,
                      identifiers: Iterable[tuple[str, str, str]] = ()) -> None:
    """identifiers: (scheme, value, venue)."""
    conn.execute(
        """INSERT INTO instruments (instrument_id, asset_class, name, currency, base_asset, quote_asset, exchange_mic)
           VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (instrument_id) DO NOTHING""",
        (instrument_id, asset_class, name, currency, base_asset, quote_asset, exchange_mic),
    )
    for scheme, value, venue in identifiers:
        conn.execute(
            """INSERT INTO instrument_identifiers (instrument_id, scheme, value, venue) VALUES (%s,%s,%s,%s)
               ON CONFLICT DO NOTHING""",
            (instrument_id, scheme, value, venue),
        )


def resolve(conn: psycopg.Connection, scheme: str, value: str, venue: str = "", on: datetime | None = None) -> str | None:
    row = conn.execute(
        """SELECT instrument_id FROM instrument_identifiers
           WHERE scheme=%s AND value=%s AND venue=%s AND valid_from <= COALESCE(%s::date, CURRENT_DATE)
             AND (valid_to IS NULL OR valid_to > COALESCE(%s::date, CURRENT_DATE))
           ORDER BY valid_from DESC LIMIT 1""",
        (scheme, value, venue, on, on),
    ).fetchone()
    return row["instrument_id"] if row else None


def upsert_bars(conn: psycopg.Connection, instrument_id: str, source_id: str, timeframe: str, bars: Sequence[Bar],
                adjustment: str = "raw", received_at: datetime | None = None) -> int:
    """
    Abgeschlossene Balken werden gespeichert; ein bereits finaler Balken wird
    nie ueberschrieben. Offene Balken werden gar nicht gespeichert.
    Bei bereinigten Tageskursen (split_dividend) aendert eine neue Dividende
    die gesamte Historie - diese Reihen werden deshalb ersetzt.
    """
    rows = [b for b in bars if b.is_final]
    if not rows:
        return 0
    conflict = "DO NOTHING" if adjustment == "raw" else (
        "DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close, "
        "volume=EXCLUDED.volume, received_at=EXCLUDED.received_at"
    )
    with conn.cursor() as cur:
        cur.executemany(
            f"""INSERT INTO bars (instrument_id, source_id, timeframe, ts, open, high, low, close, volume, quote_volume,
                                  trade_count, taker_buy_volume, is_final, adjustment, received_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,%s,COALESCE(%s, now()))
                ON CONFLICT (instrument_id, source_id, timeframe, adjustment, ts) {conflict}""",
            [(instrument_id, source_id, timeframe, b.ts, b.open, b.high, b.low, b.close, b.volume, b.quote_volume,
              b.trade_count, b.taker_buy_volume, adjustment, received_at) for b in rows],
        )
    return len(rows)


def load_bars(conn: psycopg.Connection, instrument_id: str, timeframe: str, since: datetime, until: datetime,
              source_id: str | None = None, known_at: datetime | None = None) -> list[Bar]:
    """
    Balken im Zeitfenster [since, until), die zum Zeitpunkt `known_at` (Standard: until)
    bereits vorlagen. Fuer Entscheidungen gilt known_at = Entscheidungszeitpunkt
    (Point-in-Time); nur die nachtraegliche Ergebnisaufloesung darf spaeteres Wissen nutzen.
    """
    rows = conn.execute(
        """SELECT ts, open, high, low, close, volume, quote_volume, trade_count, taker_buy_volume FROM bars
           WHERE instrument_id=%s AND timeframe=%s AND ts >= %s AND ts < %s AND (%s::text IS NULL OR source_id=%s)
             AND received_at <= %s
           ORDER BY ts""",
        (instrument_id, timeframe, since, until, source_id, source_id, known_at or until),
    ).fetchall()
    return [Bar(ts=r["ts"], open=r["open"], high=r["high"], low=r["low"], close=r["close"], volume=r["volume"],
                quote_volume=r["quote_volume"], trade_count=r["trade_count"], taker_buy_volume=r["taker_buy_volume"], is_final=True)
            for r in rows]


def record_observation(conn: psycopg.Connection, series_key: str, source_id: str, event_time: datetime, value: float | None,
                       *, instrument_id: str | None = None, published_time: datetime | None = None,
                       effective_time: datetime | None = None, value_json: dict | None = None, unit: str | None = None) -> bool:
    """Neue Beobachtung. Identischer Wert fuer denselben Zeitpunkt -> nichts tun; geaenderter Wert -> neue Revision."""
    latest = conn.execute(
        """SELECT value, value_json, revision FROM observations
           WHERE series_key=%s AND instrument_id IS NOT DISTINCT FROM %s AND source_id=%s AND event_time=%s
           ORDER BY revision DESC LIMIT 1""",
        (series_key, instrument_id, source_id, event_time),
    ).fetchone()
    if latest and latest["value"] == value and latest["value_json"] == value_json:
        return False
    revision = latest["revision"] + 1 if latest else 0
    conn.execute(
        """INSERT INTO observations (series_key, instrument_id, source_id, event_time, published_time, effective_time,
                                     value, value_json, unit, revision)
           VALUES (%s,%s,%s,%s,%s,COALESCE(%s, now()),%s,%s,%s,%s)""",
        (series_key, instrument_id, source_id, event_time, published_time, effective_time, value,
         Jsonb(value_json) if value_json is not None else None, unit, revision),
    )
    return True


def observations_as_of(conn: psycopg.Connection, series_key: str, instrument_id: str | None, since: datetime,
                       as_of: datetime) -> list[dict]:
    """Je Ereigniszeitpunkt die Revision, die zum Zeitpunkt as_of bekannt war."""
    return conn.execute(
        """SELECT DISTINCT ON (event_time) event_time, value, value_json, revision FROM observations
           WHERE series_key=%s AND instrument_id IS NOT DISTINCT FROM %s AND event_time >= %s AND effective_time <= %s
           ORDER BY event_time, revision DESC""",
        (series_key, instrument_id, since, as_of),
    ).fetchall()
