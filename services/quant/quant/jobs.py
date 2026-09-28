"""
Einzelne Aufgaben von Hand ausfuehren - fuer "./bot-lokal.sh jetzt-abrufen" und die Betriebspruefung.

  python -m quant.jobs insider   SEC-Insidermeldungen jetzt abrufen und auswerten (ein Durchlauf, protokolliert)
  python -m quant.jobs archiv    Umfang des Archivs und Doppelten-Pruefung als JSON

Exit-Code 0 = erfolgreich, 2 = Abruf fehlgeschlagen oder uebersprungen.
"""

from __future__ import annotations

import json
import sys

from .config import load_settings
from .db import connect, migrate, one


def archive_summary(conn) -> dict:
    row = one(conn.execute("""SELECT count(*) AS messages, count(DISTINCT dedup_key) AS distinct_keys,
                                     min(detected_at) AS first_detected, max(detected_at) AS last_detected FROM bot_messages"""))
    runs = one(conn.execute("SELECT count(*) AS runs, count(*) FILTER (WHERE ok) AS ok_runs FROM ingest_runs"))
    filings = one(conn.execute("SELECT count(*) AS filings, count(DISTINCT accession) AS distinct_accessions FROM sec_filings"))
    return {**row, **runs, **filings, "duplicates": row["messages"] - row["distinct_keys"]}


def main(argv: list[str]) -> int:
    task = argv[1] if len(argv) > 1 else ""
    settings = load_settings()
    with connect(settings.database_url) as conn:
        migrate(conn)
        if task == "insider":
            from .scheduler import run_insider_task
            out = run_insider_task(conn, settings)
            print(json.dumps({k: out.get(k) for k in ("ok", "skipped", "issuers", "errors", "new_messages", "error")}, ensure_ascii=False))
            return 0 if out.get("ok") else 2
        if task == "archiv":
            print(json.dumps(archive_summary(conn), default=str, ensure_ascii=False))
            return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
