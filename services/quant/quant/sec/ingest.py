"""
SEC-Ingestion (Point-in-Time) und Abfragen "was war zum Zeitpunkt X bekannt?".

Jede Einreichung wird genau einmal gespeichert. Parser-Fehler fuehren zu
parse_status='error' mit Grund - die Meldung ist damit sichtbar, aber nie mit
geratenen Werten befuellt.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from psycopg.types.json import Jsonb

from ..db import Conn, one
from ..providers.base import ProviderError
from .client import FilingRef, SecClient, available_at
from .form4 import CLASSIFICATION_VERSION, parse_form4
from .schedule13 import parse_schedule13
from .thirteenf import Holding, parse_cover, parse_info_table, position_changes
from .xml import SecParseError

log = logging.getLogger("quant.sec")

FORM4 = {"4", "4/A"}
THIRTEEN_F = {"13F-HR", "13F-HR/A"}
SCHEDULE_13 = {"SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A", "SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A"}


def _known(conn: Conn, accessions: list[str]) -> set[str]:
    if not accessions:
        return set()
    return {r["accession"] for r in conn.execute("SELECT accession FROM sec_filings WHERE accession = ANY(%s)", (accessions,)).fetchall()}


def _store_filing(conn, ref: FilingRef, *, received_at: datetime, status: str, url: str | None, error: str | None = None) -> None:
    conn.execute(
        """INSERT INTO sec_filings (accession, form, filer_cik, filing_date, report_date, accepted_at, available_at, received_at,
                                    primary_document, url, parse_status, parse_error)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (accession) DO NOTHING""",
        (ref.accession, ref.form, ref.filer_cik, ref.filing_date, ref.report_date, ref.accepted_at, available_at(ref), received_at,
         ref.primary_document, url, status, error))


class SecIngestor:
    """
    mode="live":       received_at = Bot-Uhr beim Abruf (was der laufende Bot tatsaechlich wusste).
    mode="historical": Nachladen fuer Backtests - received_at = Veroeffentlichung + Latenz (was ein Bot damals
                       haette wissen koennen). Nie frueher als die Veroeffentlichung.
    """

    def __init__(self, conn: Conn, client: SecClient, clock, mode: str = "live",
                 historical_latency: timedelta = timedelta(minutes=5)):
        if mode not in ("live", "historical"):
            raise ValueError("mode: live | historical")
        self.conn, self.client, self.clock, self.mode, self.latency = conn, client, clock, mode, historical_latency

    def _received(self, ref: FilingRef) -> datetime:
        return self.clock() if self.mode == "live" else available_at(ref) + self.latency

    # ------------------------------------------------------------------ Emittent: Form 4 + 13D/G
    def ingest_issuer(self, cik: str, since: date) -> dict:
        stats = {"form4": 0, "schedule13": 0, "errors": 0}
        refs = [r for r in self.client.submissions(cik) if r.filing_date >= since and (r.form in FORM4 or r.form in SCHEDULE_13)]
        new = [r for r in refs if r.accession not in _known(self.conn, [x.accession for x in refs])]
        for ref in new:
            try:
                if ref.form in FORM4:
                    self._form4(ref)
                    stats["form4"] += 1
                else:
                    self._schedule13(ref, subject_cik=cik)
                    stats["schedule13"] += 1
            except ProviderError as exc:
                stats["errors"] += 1  # Netz/Quelle: naechster Lauf versucht es erneut (nichts gespeichert)
                log.warning("SEC-Abruf fehlgeschlagen", extra={"event": "sec_fetch_failed", "accession": ref.accession, "error_type": exc.reason})
            self.conn.commit()
        return stats

    def _form4(self, ref: FilingRef) -> None:
        url = ref.raw_primary
        now = self._received(ref)
        doc = self.client.text(url)
        try:
            f = parse_form4(doc)
        except SecParseError as exc:
            _store_filing(self.conn, ref, received_at=now, status="error", url=url, error=str(exc)[:500])
            return
        _store_filing(self.conn, ref, received_at=now, status="parsed", url=url)
        avail = available_at(ref)
        for t in f.transactions:
            roles = sorted({r for o in f.owners for r in o.roles})
            self.conn.execute(
                """INSERT INTO insider_transactions (accession, seq, document_type, issuer_cik, issuer_ticker, owner_ciks, owner_names, roles,
                       officer_title, table_kind, security_title, transaction_date, code, classification, classification_confidence,
                       classification_version, context, discretionary, plan_10b5_1, shares, price, value, acquired_disposed, shares_after,
                       ownership, nature_of_ownership, footnotes, available_at, received_at, issuer_name)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (ref.accession, t.seq, f.document_type, f.issuer_cik, f.issuer_ticker, [o.cik or "" for o in f.owners],
                 [o.name for o in f.owners], roles, next((o.officer_title for o in f.owners if o.officer_title), None), t.table,
                 t.security_title, t.transaction_date, t.code, t.classification, t.classification_confidence, CLASSIFICATION_VERSION,
                 list(t.context), t.discretionary, t.plan_10b5_1, t.shares, t.price, t.value, t.acquired_disposed, t.shares_after,
                 t.ownership, t.nature_of_ownership, Jsonb(list(t.footnotes)), avail, now, f.issuer_name))

    def _schedule13(self, ref: FilingRef, subject_cik: str) -> None:
        url = f"{ref.folder}/{ref.primary_document}"
        now = self._received(ref)
        s = parse_schedule13(ref.form, self.client.text(url))
        _store_filing(self.conn, ref, received_at=now, status="parsed" if s.parse_status == "structured" else "metadata_only", url=url)
        self.conn.execute(
            """INSERT INTO ownership_reports_13dg (accession, form, schedule, is_amendment, subject_cik, filer_ciks, parse_status,
                   reporting_persons, percent_of_class, shares_owned, available_at, received_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
            # Melder-CIKs sind aus der Emittentenliste nicht ableitbar (Accession-Praefix = oft Filing-Agent) -> leer statt falsch
            (ref.accession, ref.form, s.schedule, s.is_amendment, subject_cik, [],
             s.parse_status, Jsonb(s.reporting_persons), s.percent_of_class, s.shares_owned, available_at(ref), now))

    # ------------------------------------------------------------------ Manager: 13F
    def ingest_manager(self, cik: str, since: date) -> dict:
        stats = {"filings": 0, "holdings": 0, "errors": 0}
        refs = [r for r in self.client.submissions(cik) if r.form in THIRTEEN_F and r.filing_date >= since]
        new = [r for r in refs if r.accession not in _known(self.conn, [x.accession for x in refs])]
        for ref in new:
            try:
                stats["holdings"] += self._thirteen_f(ref)
                stats["filings"] += 1
            except ProviderError as exc:
                stats["errors"] += 1
                log.warning("13F-Abruf fehlgeschlagen", extra={"event": "sec_fetch_failed", "accession": ref.accession, "error_type": exc.reason})
            self.conn.commit()
        return stats

    def _thirteen_f(self, ref: FilingRef) -> int:
        now = self._received(ref)
        names = self.client.filing_index(ref)
        xmls = [n for n in names if n.lower().endswith(".xml")]
        cover_name = "primary_doc.xml" if "primary_doc.xml" in xmls else None
        table_name = next((n for n in xmls if "infotable" in n.lower()), next((n for n in xmls if n != cover_name), None))
        if table_name is None:
            _store_filing(self.conn, ref, received_at=now, status="error", url=ref.folder, error="keine Informationstabelle")
            return 0
        try:
            cover = parse_cover(self.client.text(f"{ref.folder}/{cover_name}")) if cover_name else None
            holdings = parse_info_table(self.client.text(f"{ref.folder}/{table_name}"), ref.filing_date)
        except SecParseError as exc:
            _store_filing(self.conn, ref, received_at=now, status="error", url=ref.folder, error=str(exc)[:500])
            return 0
        period = (cover.report_period if cover else None) or ref.report_date
        if period is None:
            _store_filing(self.conn, ref, received_at=now, status="error", url=ref.folder, error="Stichtag fehlt")
            return 0
        _store_filing(self.conn, ref, received_at=now, status="parsed", url=f"{ref.folder}/{table_name}")
        avail = available_at(ref)
        amend = cover.amendment_type if cover and cover.is_amendment else None
        with self.conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO institutional_holdings (accession, row_no, manager_cik, report_period, amendment_type, cusip, issuer_name,
                       title_of_class, value_usd, shares, share_type, put_call, investment_discretion, voting_sole, voting_shared, voting_none,
                       available_at, received_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(ref.accession, h.row_no, ref.filer_cik, period, amend, h.cusip, h.issuer_name, h.title_of_class, h.value_usd, h.shares,
                  h.share_type, h.put_call, h.investment_discretion, h.voting_sole, h.voting_shared, h.voting_none, avail, now) for h in holdings])
        return len(holdings)


# ---------------------------------------------------------------------- Point-in-Time-Abfragen
def _knowable(alias: str = "") -> str:
    p = f"{alias}." if alias else ""
    return f"GREATEST({p}available_at, {p}received_at) <= %s"


def insider_transactions_as_of(conn, issuer_cik: str, as_of: datetime, since: date) -> list[dict]:
    return conn.execute(f"""SELECT * FROM insider_transactions WHERE issuer_cik=%s AND transaction_date >= %s AND {_knowable()}
                            ORDER BY transaction_date, accession, seq""", (str(int(issuer_cik)), since, as_of)).fetchall()


def holdings_as_of(conn, manager_cik: str, as_of: datetime) -> dict[date, list[Holding]]:
    """
    Bestaende je Stichtag, wie sie zum Zeitpunkt as_of bekannt waren. Nachtraege: RESTATEMENT ersetzt
    die Meldung des Stichtags, NEW HOLDINGS ergaenzt sie.
    """
    rows = conn.execute(f"""SELECT h.* FROM institutional_holdings h
                            WHERE h.manager_cik=%s AND {_knowable('h')} ORDER BY h.report_period, h.available_at, h.accession, h.row_no""",
                        (str(int(manager_cik)), as_of)).fetchall()
    by_acc: dict[str, list[dict]] = {}
    order: dict[date, list[tuple[str, str | None]]] = {}
    for r in rows:
        if r["accession"] not in by_acc:
            order.setdefault(r["report_period"], []).append((r["accession"], (r["amendment_type"] or "").upper() or None))
        by_acc.setdefault(r["accession"], []).append(r)
    out: dict[date, list[Holding]] = {}
    for period, filings in order.items():
        current: list[str] = []
        for acc, amend in filings:  # in Reihenfolge der Veroeffentlichung
            if amend == "NEW HOLDINGS":
                current.append(acc)      # Nachtrag ergaenzt
            else:
                current = [acc]          # Erstmeldung oder RESTATEMENT ersetzt
        out[period] = [Holding(r["row_no"], r["issuer_name"], r["title_of_class"], r["cusip"], r["value_usd"], r["shares"], r["share_type"],
                               r["put_call"], r["investment_discretion"], r["voting_sole"], r["voting_shared"], r["voting_none"])
                       for acc in current for r in by_acc[acc]]
    return out


def latest_13f_changes(conn, manager_cik: str, as_of: datetime) -> dict | None:
    periods = holdings_as_of(conn, manager_cik, as_of)
    if not periods:
        return None
    keys = sorted(periods)
    cur = keys[-1]
    prev = keys[-2] if len(keys) > 1 else None
    avail = one(conn.execute(f"""SELECT max(available_at) AS a FROM institutional_holdings WHERE manager_cik=%s AND report_period=%s
                             AND {_knowable()}""", (str(int(manager_cik)), cur, as_of)))["a"]
    return {"report_period": cur, "previous_period": prev, "available_at": avail,
            "data_age_days": (as_of.date() - cur).days, "changes": position_changes(periods.get(prev) if prev else None, periods[cur])}
