import os
import time
import uuid

import psycopg
import pytest

from quant.db import connect, migrate

ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgresql://quant:quant@localhost:5432/quant_test")


@pytest.fixture()
def db():
    """Frische, migrierte Datenbank je Test (eigenes Schema-freies DB-Objekt)."""
    name = f"t_{uuid.uuid4().hex[:12]}"
    try:
        admin = psycopg.connect(ADMIN_URL, autocommit=True)
    except psycopg.OperationalError:
        pytest.skip("Keine Test-Datenbank erreichbar (TEST_ADMIN_DATABASE_URL)")
    admin.execute(f'CREATE DATABASE "{name}"')
    url = ADMIN_URL.rsplit("/", 1)[0] + f"/{name}"
    conn = connect(url)
    migrate(conn)
    try:
        yield conn
    finally:
        conn.close()
        drop_database(admin, name)
        admin.close()


def drop_database(admin, name: str) -> None:
    """Ein Autovacuum-Prozess des Superusers kann kurz noch verbunden sein; ihn darf die Testrolle nicht beenden."""
    for attempt in range(20):
        try:
            admin.execute(f'DROP DATABASE "{name}" WITH (FORCE)')
            return
        except psycopg.errors.InsufficientPrivilege:
            time.sleep(0.25)
    raise RuntimeError(f"Test-Datenbank {name} liess sich nicht loeschen")
