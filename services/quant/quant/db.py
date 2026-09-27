"""Datenbankzugriff (psycopg 3) und Migrationslauf."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

# Teil des Pakets (package-data), damit auch eine installierte Kopie ihre Migrationen findet
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def connect(database_url: str) -> psycopg.Connection:
    # UTC fuer die Sitzung: Zeitstempel kommen immer in derselben Darstellung zurueck (Hash-Kette, Anzeige)
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=False, options="-c timezone=UTC")


@contextmanager
def transaction(conn: psycopg.Connection) -> Iterator[psycopg.Connection]:
    with conn.transaction():
        yield conn


def migrate(conn: psycopg.Connection) -> list[str]:
    """Wendet alle noch nicht angewandten SQL-Migrationen in Dateinamen-Reihenfolge an."""
    applied: list[str] = []
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise RuntimeError(f"Keine Migrationen gefunden unter {MIGRATIONS_DIR} - Installation unvollstaendig")
    with conn.transaction():
        # Parallele Starts (api + worker + scheduler) duerfen nicht gleichzeitig migrieren.
        # Die Sperre kommt ZUERST - auch das Anlegen der Verwaltungstabelle ist sonst ein Wettlauf.
        conn.execute("SELECT pg_advisory_xact_lock(424242)")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        done = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations").fetchall()}
        for path in files:
            if path.name in done:
                continue
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
            applied.append(path.name)
    return applied


if __name__ == "__main__":
    from .config import load_settings

    with connect(load_settings().database_url) as c:
        for name in migrate(c):
            print(f"angewandt: {name}")
