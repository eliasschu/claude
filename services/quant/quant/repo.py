"""Lesen/Schreiben von Stammdaten, Balken und Point-in-Time-Beobachtungen."""

from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Iterable, Sequence

import psycopg
from psycopg.types.json import Jsonb

from .metrics import METRICS
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
                adjustment: str = "raw", *, received_at: datetime) -> int:
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
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,%s,%s)
                ON CONFLICT (instrument_id, source_id, timeframe, adjustment, ts) {conflict}""",
            [(instrument_id, source_id, timeframe, b.ts, b.open, b.high, b.low, b.close, b.volume, b.quote_volume,
              b.trade_count, b.taker_buy_volume, adjustment, received_at) for b in rows],
        )
    return len(rows)


def load_bars(conn: psycopg.Connection, instrument_id: str, timeframe: str, since: datetime, until: datetime,
              source_id: str | None = None, known_at: datetime | None = None, prefer_source: str | None = None) -> list[Bar]:
    """
    Balken im Zeitfenster [since, until), die zum Zeitpunkt `known_at` (Standard: until)
    bereits vorlagen. Fuer Entscheidungen gilt known_at = Entscheidungszeitpunkt
    (Point-in-Time); nur die nachtraegliche Ergebnisaufloesung darf spaeteres Wissen nutzen.

    Liegen fuer einen Zeitpunkt Balken mehrerer Quellen vor (Ersatzquelle bei Ausfall), gewinnt
    `prefer_source`, danach die Rangfolge aus data_sources - nie eine doppelte Zeile je Zeitpunkt.
    """
    t0 = time.monotonic()
    rows = conn.execute(
        """SELECT DISTINCT ON (b.ts) b.ts, b.open, b.high, b.low, b.close, b.volume, b.quote_volume, b.trade_count,
                  b.taker_buy_volume, b.source_id
           FROM bars b LEFT JOIN data_sources d ON d.source_id = b.source_id
           WHERE b.instrument_id=%s AND b.timeframe=%s AND b.ts >= %s AND b.ts < %s AND (%s::text IS NULL OR b.source_id=%s)
             AND b.received_at <= %s
           ORDER BY b.ts, (b.source_id = %s) DESC NULLS LAST, d.priority NULLS LAST, b.source_id""",
        (instrument_id, timeframe, since, until, source_id, source_id, known_at or until, prefer_source),
    ).fetchall()
    METRICS.observe("db_query_latency_ms", (time.monotonic() - t0) * 1000, query="load_bars")
    return [Bar(ts=r["ts"], open=r["open"], high=r["high"], low=r["low"], close=r["close"], volume=r["volume"],
                quote_volume=r["quote_volume"], trade_count=r["trade_count"], taker_buy_volume=r["taker_buy_volume"], is_final=True)
            for r in rows]


def record_observation(conn: psycopg.Connection, series_key: str, source_id: str, event_time: datetime, value: float | None,
                       *, received_at: datetime, instrument_id: str | None = None, published_time: datetime | None = None,
                       available_at: datetime | None = None, value_json: dict | None = None, unit: str | None = None,
                       vintage: str | None = None) -> bool:
    """
    Neue Point-in-Time-Beobachtung.

    received_at  - wann der BOT den Wert erhalten hat (Bot-/Simulationsuhr, nie die DB-Uhr)
    available_at - fruehester Zeitpunkt, zu dem der Wert oeffentlich verfuegbar war (z. B. Veroeffentlichung)
    effective_time = max(received_at, available_at): ab dann darf eine Entscheidung ihn verwenden.

    Identischer Wert fuer denselben Ereigniszeitpunkt -> nichts tun; geaenderter Wert -> neue Revision.
    """
    latest = conn.execute(
        """SELECT value, value_json, revision FROM observations
           WHERE series_key=%s AND instrument_id IS NOT DISTINCT FROM %s AND source_id=%s AND event_time=%s
           ORDER BY revision DESC LIMIT 1""",
        (series_key, instrument_id, source_id, event_time),
    ).fetchone()
    if latest and latest["value"] == value and latest["value_json"] == value_json:
        return False
    revision = latest["revision"] + 1 if latest else 0
    effective = max(received_at, available_at) if available_at else received_at
    conn.execute(
        """INSERT INTO observations (series_key, instrument_id, source_id, event_time, published_time, received_time,
                                     effective_time, value, value_json, unit, revision, version)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (series_key, instrument_id, source_id, event_time, published_time, received_at, effective, value,
         Jsonb(value_json) if value_json is not None else None, unit, revision, vintage or "1"),
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


# --------------------------------------------------------------------------- WebSocket-Sekundenzeilen
def store_flow(conn: psycopg.Connection, instrument_id: str, source_id: str, rows: Sequence[dict], *, received_at: datetime) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO trade_flow_1s (instrument_id, source_id, ts, buy_qty, sell_qty, buy_notional, sell_notional, trades,
                                          last_price, max_trade_notional, received_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
            [(instrument_id, source_id, r["ts"], r["buy_qty"], r["sell_qty"], r["buy_notional"], r["sell_notional"], r["trades"],
              r["last_price"], r["max_trade_notional"], received_at) for r in rows])
    return len(rows)


def store_book(conn: psycopg.Connection, instrument_id: str, source_id: str, rows: Sequence[dict], *, received_at: datetime) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO orderbook_1s (instrument_id, source_id, ts, best_bid, best_ask, spread_bps, depth_bid_10bps, depth_ask_10bps,
                                         imbalance_10bps, last_update_id, exchange_time, received_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
            [(instrument_id, source_id, r["ts"], r["best_bid"], r["best_ask"], r["spread_bps"], r["depth_bid_10bps"], r["depth_ask_10bps"],
              r["imbalance_10bps"], r["last_update_id"], r["exchange_time"], received_at) for r in rows])
    return len(rows)


def store_liquidations(conn: psycopg.Connection, instrument_id: str, source_id: str, liqs: Sequence) -> int:
    if not liqs:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO liquidations (instrument_id, source_id, exchange_time, received_at, side, price, quantity, notional)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
            [(instrument_id, source_id, l.exchange_time, l.received_at, l.side, l.price, l.quantity, l.notional) for l in liqs])
    return len(liqs)


def load_flow(conn: psycopg.Connection, spot_id: str, perp_id: str, as_of: datetime, window: timedelta = timedelta(minutes=5)):
    """Sekundenzeilen, die der Bot zum Zeitpunkt as_of kannte (received_at <= as_of)."""
    since = as_of - window
    flow = conn.execute("""SELECT * FROM trade_flow_1s WHERE instrument_id=%s AND ts >= %s AND received_at <= %s ORDER BY ts""",
                        (spot_id, since, as_of)).fetchall()
    book = conn.execute("""SELECT * FROM orderbook_1s WHERE instrument_id=%s AND ts >= %s AND received_at <= %s ORDER BY ts""",
                        (spot_id, since, as_of)).fetchall()
    liqs = conn.execute("""SELECT * FROM liquidations WHERE instrument_id=%s AND exchange_time >= %s AND received_at <= %s""",
                        (perp_id, since, as_of)).fetchall()
    alive = conn.execute("""SELECT max(received_at) AS t FROM ws_stream_status WHERE stream LIKE %s AND state='live'
                            AND received_at <= %s""", (f"%:liquidations:{perp_id}", as_of)).fetchone()["t"]
    return flow, book, liqs, alive
