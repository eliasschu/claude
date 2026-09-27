import uuid
from datetime import datetime, timezone

import psycopg
import pytest

from quant.db import migrate


def _instrument(db, iid="ins_btcusdt_spot"):
    db.execute("INSERT INTO instruments (instrument_id, asset_class, name) VALUES (%s, 'crypto_spot', 'Bitcoin / Tether')", (iid,))


def test_migrations_are_idempotent(db):
    assert migrate(db) == []
    names = [r["name"] for r in db.execute("SELECT name FROM schema_migrations ORDER BY name").fetchall()]
    assert names[:2] == ["0001_core.sql", "0002_seed_sources.sql"]


def test_instrument_id_is_not_a_ticker(db):
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("INSERT INTO instruments (instrument_id, asset_class, name) VALUES ('AAPL', 'equity', 'Apple')")
    db.rollback()


def test_bar_plausibility_is_enforced(db):
    _instrument(db)
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(
            "INSERT INTO bars (instrument_id, source_id, timeframe, ts, open, high, low, close, volume, is_final) "
            "VALUES ('ins_btcusdt_spot','binance','1m', now(), 100, 90, 95, 99, 1, true)"
        )
    db.rollback()


def test_observations_are_append_only_and_keep_revisions(db):
    t = datetime(2026, 9, 1, tzinfo=timezone.utc)
    ins = "INSERT INTO observations (series_key, source_id, event_time, effective_time, value, revision) VALUES ('fred:CPIAUCSL','fred',%s,%s,%s,%s)"
    db.execute(ins, (t, t, 2.9, 0))
    db.execute(ins, (t, datetime(2026, 10, 1, tzinfo=timezone.utc), 3.0, 1))
    db.commit()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("UPDATE observations SET value = 1")
    db.rollback()
    with pytest.raises(psycopg.errors.UniqueViolation):
        db.execute(ins, (t, t, 2.8, 0))
    db.rollback()
    rows = db.execute("SELECT value, revision FROM observations ORDER BY revision").fetchall()
    assert [(r["value"], r["revision"]) for r in rows] == [(2.9, 0), (3.0, 1)]


def test_bot_events_cannot_be_deleted(db):
    db.execute("INSERT INTO bot_events (created_at, event_type, severity, message) VALUES (now(), 'test', 'info', 'x')")
    db.commit()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("DELETE FROM bot_events")
    db.rollback()


def test_parallel_migrations_do_not_race():
    """Worker, Scheduler und API starten gleichzeitig und migrieren alle."""
    import threading
    import uuid as _uuid
    from tests.conftest import ADMIN_URL, drop_database
    from quant.db import connect
    name = f"t_{_uuid.uuid4().hex[:12]}"
    admin = psycopg.connect(ADMIN_URL, autocommit=True)
    admin.execute(f'CREATE DATABASE "{name}"')
    url = ADMIN_URL.rsplit("/", 1)[0] + f"/{name}"
    errors = []

    def run():
        try:
            with connect(url) as c:
                migrate(c)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    drop_database(admin, name)
    assert errors == []


def test_migrations_ship_inside_the_package():
    """Docker installiert das Paket nach site-packages; die Migrationen muessen mitkommen."""
    from pathlib import Path
    import quant
    from quant.db import MIGRATIONS_DIR
    assert MIGRATIONS_DIR.parent == Path(quant.__file__).resolve().parent
    assert len(list(MIGRATIONS_DIR.glob("*.sql"))) >= 2
