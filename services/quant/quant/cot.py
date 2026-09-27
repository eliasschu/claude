"""COT-Speicherung (Point-in-Time) und abgeleitete Positionierung: Netto, Wochenaenderung, z-Score, Perzentil."""

from __future__ import annotations

from datetime import datetime, timedelta
from statistics import fmean, pstdev

from psycopg.types.json import Jsonb

from .db import Conn
from .providers.cftc import cot_available_at

# Beispiel-Kontrakte (CFTC-Codes laut CFTC; vor Nutzung live pruefen)
DEFAULT_CONTRACTS = {
    "13874A": ("tff", "E-mini S&P 500"), "209742": ("tff", "Nasdaq-100 E-mini"),
    "043602": ("tff", "10-Year T-Note"), "098662": ("tff", "US Dollar Index"),
    "088691": ("disaggregated", "Gold"), "067651": ("disaggregated", "WTI Crude Oil"),
    "133741": ("tff", "Bitcoin (CME)"),
}


def store_cot(conn: Conn, rows: list[dict], *, received_at: datetime, mode: str = "live",
              historical_latency: timedelta = timedelta(minutes=5)) -> int:
    """Neue Berichte speichern; geaenderte Werte eines bekannten Stichtags werden als neue Revision abgelegt."""
    n = 0
    for r in rows:
        prev = conn.execute("""SELECT revision, categories, open_interest FROM cot_reports WHERE report_type=%s AND contract_code=%s
                               AND report_date=%s ORDER BY revision DESC LIMIT 1""",
                            (r["report_type"], r["contract_code"], r["report_date"])).fetchone()
        if prev and prev["categories"] == r["categories"] and prev["open_interest"] == r["open_interest"]:
            continue
        avail = cot_available_at(r["report_date"])
        recv = received_at if mode == "live" else avail + historical_latency
        conn.execute(
            """INSERT INTO cot_reports (report_type, contract_code, market_name, report_date, revision, open_interest, categories, raw,
                                        available_at, received_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (r["report_type"], r["contract_code"], r["market_name"], r["report_date"], (prev["revision"] + 1) if prev else 0,
             r["open_interest"], Jsonb(r["categories"]), Jsonb(r["raw"]), avail, recv))
        n += 1
    return n


def positioning_as_of(conn: Conn, contract_code: str, report_type: str, category: str, as_of: datetime,
                      lookback_weeks: int = 156) -> dict | None:
    """Netto-Positionierung einer Kategorie mit Wochenaenderung, z-Score und Perzentil (nur zum Zeitpunkt as_of bekannte Berichte)."""
    rows = conn.execute(
        """SELECT DISTINCT ON (report_date) report_date, categories, open_interest, available_at FROM cot_reports
           WHERE contract_code=%s AND report_type=%s AND GREATEST(available_at, received_at) <= %s
           ORDER BY report_date DESC, revision DESC LIMIT %s""", (contract_code, report_type, as_of, lookback_weeks)).fetchall()
    rows = [r for r in reversed(rows) if category in r["categories"]]
    if not rows:
        return None
    nets = [(r["categories"][category]["long"] or 0) - (r["categories"][category]["short"] or 0) for r in rows]
    cur = nets[-1]
    hist = nets[:-1]
    sd = pstdev(hist) if len(hist) >= 10 else None
    return {
        "report_date": rows[-1]["report_date"], "available_at": rows[-1]["available_at"],
        "data_age_days": (as_of.date() - rows[-1]["report_date"]).days, "net": cur,
        "weekly_change": cur - nets[-2] if len(nets) > 1 else None,
        "net_pct_open_interest": cur / rows[-1]["open_interest"] * 100 if rows[-1]["open_interest"] else None,
        "zscore": (cur - fmean(hist)) / sd if sd else None,
        "percentile": sum(1 for h in hist if h < cur) / len(hist) * 100 if len(hist) >= 10 else None,
        "sample_weeks": len(nets),
    }
