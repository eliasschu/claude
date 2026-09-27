"""SEC-Ingestion gegen nachgebildete EDGAR-Antworten: Point-in-Time, 13F-Aenderungen, Nachtraege, 13D/G, Fehler."""

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from quant.sec.client import SecClient, accepted_time
from quant.sec.ingest import SecIngestor, holdings_as_of, insider_transactions_as_of, latest_13f_changes
from quant.sec.schedule13 import parse_schedule13, stake_change

FIX = Path(__file__).parent / "fixtures"
FORM4 = (FIX / "form4_ceo_buy.xml").read_text()


def info_table(rows):
    body = "".join(f"""<infoTable><nameOfIssuer>{n}</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>{c}</cusip><value>{v}</value>
      <shrsOrPrnAmt><sshPrnamt>{s}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion>
      <votingAuthority><Sole>{s}</Sole><Shared>0</Shared><None>0</None></votingAuthority></infoTable>""" for n, c, v, s in rows)
    return f'<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">{body}</informationTable>'


def cover(period, amendment=None):
    amend = f"<isAmendment>true</isAmendment><amendmentInfo><amendmentType>{amendment}</amendmentType></amendmentInfo>" if amendment else "<isAmendment>false</isAmendment>"
    return f"<edgarSubmission><formData><coverPage><reportCalendarOrQuarter>{period}</reportCalendarOrQuarter>{amend}<filingManager><name>Test Fund</name></filingManager></coverPage></formData></edgarSubmission>"


def submissions(rows):
    cols = ["accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "form", "primaryDocument"]
    return {"filings": {"recent": {c: [r[i] for r in rows] for i, c in enumerate(cols)}}}


def transport(routes):
    def send(url, params, headers):
        assert "@" in headers["User-Agent"]
        for key, body in routes.items():
            if url.endswith(key):
                if isinstance(body, Exception):
                    raise body
                if isinstance(body, httpx.Response):
                    return body
                return httpx.Response(200, json=body) if isinstance(body, dict) else httpx.Response(200, text=body)
        return httpx.Response(404)
    return send


def test_acceptance_time_is_read_conservatively_as_new_york():
    assert accepted_time("2026-09-22T16:05:00.000Z") == datetime(2026, 9, 22, 20, 5, tzinfo=timezone.utc)  # EDT = UTC-4


def test_form4_ingest_and_point_in_time(db):
    now = datetime(2026, 9, 25, tzinfo=timezone.utc)
    client = SecClient("Test test@example.org", transport({
        "CIK0000320193.json": submissions([
            ("0001234567-26-000010", "2026-09-18", "2026-09-17", "2026-09-18T17:10:00.000Z", "4", "xslF345X05/wk-form4.xml"),
            ("0001234567-26-000011", "2026-09-19", "2026-09-19", "2026-09-19T09:00:00.000Z", "4", "bad.xml"),
            ("0001234567-26-000001", "2025-01-02", "2025-01-01", "2025-01-02T09:00:00.000Z", "4", "old.xml")]),
        "/wk-form4.xml": FORM4,
        "/bad.xml": "<ownershipDocument><issuer>",
    }))
    stats = SecIngestor(db, client, lambda: now).ingest_issuer("320193", since=date(2026, 1, 1))
    assert stats == {"form4": 2, "schedule13": 0, "errors": 0}
    statuses = {r["accession"]: r["parse_status"] for r in db.execute("SELECT accession, parse_status FROM sec_filings").fetchall()}
    assert statuses == {"0001234567-26-000010": "parsed", "0001234567-26-000011": "error"}
    # Vor der Annahme (17:10 New York = 21:10 UTC) ist die Meldung unbekannt - auch wenn das Handelsdatum frueher liegt
    before = datetime(2026, 9, 18, 21, 9, tzinfo=timezone.utc)
    after = datetime(2026, 9, 18, 21, 11, tzinfo=timezone.utc)
    # received_at (25.09.) liegt spaeter: fuer den LIVE-Bot war sie erst dann bekannt
    assert insider_transactions_as_of(db, "320193", after, date(2026, 9, 1)) == []
    rows = insider_transactions_as_of(db, "320193", now, date(2026, 9, 1))
    assert [r["classification"] for r in rows] == ["TAX_WITHHOLDING", "GIFT", "OPTION_EXERCISE", "OPEN_MARKET_BUY"]
    buy = rows[-1]
    assert buy["discretionary"] and "CEO" in buy["roles"] and buy["value"] == pytest.approx(521_000)
    assert before < buy["available_at"] <= after
    # Wiederholter Lauf: nichts doppelt
    assert SecIngestor(db, client, lambda: now).ingest_issuer("320193", since=date(2026, 1, 1))["form4"] == 0


def test_13f_changes_amendments_and_point_in_time(db):
    t = lambda d: datetime.fromisoformat(d).replace(tzinfo=timezone.utc)
    client = SecClient("Test test@example.org", transport({
        "CIK0001067983.json": submissions([
            ("0000950123-26-000001", "2026-05-15", "2026-03-31", "2026-05-15T16:00:00.000Z", "13F-HR", "primary_doc.xml"),
            ("0000950123-26-000002", "2026-08-14", "2026-06-30", "2026-08-14T16:00:00.000Z", "13F-HR", "primary_doc.xml"),
            ("0000950123-26-000003", "2026-08-20", "2026-06-30", "2026-08-20T16:00:00.000Z", "13F-HR/A", "primary_doc.xml")]),
        "000095012326000001/index.json": {"directory": {"item": [{"name": "primary_doc.xml"}, {"name": "infotable.xml"}]}},
        "000095012326000002/index.json": {"directory": {"item": [{"name": "primary_doc.xml"}, {"name": "infotable.xml"}]}},
        "000095012326000003/index.json": {"directory": {"item": [{"name": "primary_doc.xml"}, {"name": "infotable.xml"}]}},
        "000095012326000001/primary_doc.xml": cover("03-31-2026"),
        "000095012326000001/infotable.xml": info_table([("APPLE INC", "037833100", 1_000_000, 100), ("OLDCO", "111111111", 500, 10)]),
        "000095012326000002/primary_doc.xml": cover("06-30-2026"),
        "000095012326000002/infotable.xml": info_table([("APPLE INC", "037833100", 1_500_000, 150), ("NEWCO", "222222222", 800, 8)]),
        "000095012326000003/primary_doc.xml": cover("06-30-2026", "NEW HOLDINGS"),
        "000095012326000003/infotable.xml": info_table([("LATECO", "333333333", 200, 2)]),
    }))
    now = t("2026-09-01")
    stats = SecIngestor(db, client, lambda: now).ingest_manager("1067983", since=date(2026, 1, 1))
    assert stats["filings"] == 3 and stats["errors"] == 0
    # Stand 16.08. (nach Erstmeldung, vor Nachtrag), bekannt geworden am 01.09. -> fuer den Live-Bot erst ab 01.09.
    ch = latest_13f_changes(db, "1067983", now)
    changes = {c["issuer_name"]: c["change"] for c in ch["changes"]}
    assert changes == {"APPLE INC": "INCREASE", "OLDCO": "EXIT", "NEWCO": "NEW_POSITION", "LATECO": "NEW_POSITION"}
    assert ch["report_period"] == date(2026, 6, 30) and ch["data_age_days"] == 63
    assert ch["available_at"] > datetime(2026, 8, 20, tzinfo=timezone.utc)  # Nachtrag -> spaetester Zeitpunkt
    # Vor dem Abruf nichts bekannt
    assert holdings_as_of(db, "1067983", now - timedelta(days=1)) == {}


def test_13f_value_units_in_dollars_since_2023():
    from quant.sec.thirteenf import parse_info_table
    rows = parse_info_table(info_table([("A", "1", 150, 1)]), date(2022, 11, 14))
    assert rows[0].value_usd == 150_000
    assert parse_info_table(info_table([("A", "1", 150, 1)]), date(2026, 8, 14))[0].value_usd == 150


def test_schedule13_structured_and_metadata_only():
    xml = """<edgarSubmission><formData><coverPageHeaderReportingPersonDetails><reportingPersonName>Activist LP</reportingPersonName>
             <aggregateAmountOwned>5,500,000</aggregateAmountOwned><percentOfClass>6.2</percentOfClass></coverPageHeaderReportingPersonDetails>
             <coverPageHeaderReportingPersonDetails><reportingPersonName>Activist GP LLC</reportingPersonName>
             <aggregateAmountOwned>5500000</aggregateAmountOwned><percentOfClass>6.2</percentOfClass></coverPageHeaderReportingPersonDetails>
             </formData></edgarSubmission>"""
    s = parse_schedule13("SCHEDULE 13D", xml)
    assert s.schedule == "D" and s.parse_status == "structured" and s.percent_of_class == 6.2 and s.shares_owned == 5_500_000
    assert len(s.reporting_persons) == 2  # gemeinsame Melder -> Maximum, keine Doppelzaehlung
    old = parse_schedule13("SC 13G/A", "<html><body>Freitext</body></html>")
    assert old.parse_status == "metadata_only" and old.is_amendment and old.percent_of_class is None
    assert stake_change(None, 6.2, "D") == "NEW_LARGE_STAKE" and stake_change(6.2, 8.0, "D") == "STAKE_INCREASE"
    assert stake_change(8.0, 4.9, "D") == "STAKE_REDUCTION" and stake_change(None, None, "G") == "UNKNOWN"


def test_sec_unavailable_does_not_store_anything_and_does_not_crash(db):
    now = datetime(2026, 9, 25, tzinfo=timezone.utc)
    client = SecClient("Test test@example.org", transport({
        "CIK0000320193.json": submissions([("0001234567-26-000010", "2026-09-18", "2026-09-17", "2026-09-18T17:10:00.000Z", "4", "x.xml")]),
        "/x.xml": httpx.Response(503),
    }))
    stats = SecIngestor(db, client, lambda: now).ingest_issuer("320193", since=date(2026, 1, 1))
    assert stats["errors"] == 1 and db.execute("SELECT count(*) AS n FROM sec_filings").fetchone()["n"] == 0


def test_missing_user_agent_is_not_configured():
    from quant.providers.base import NotConfiguredError
    with pytest.raises(NotConfiguredError):
        SecClient(None)


def test_historical_backfill_knows_filing_from_publication_not_from_fetch(db):
    now = datetime(2026, 9, 25, tzinfo=timezone.utc)
    client = SecClient("Test test@example.org", transport({
        "CIK0000320193.json": submissions([("0001234567-26-000010", "2026-09-18", "2026-09-17", "2026-09-18T17:10:00.000Z", "4",
                                            "xslF345X05/wk-form4.xml")]),
        "/wk-form4.xml": FORM4}))
    SecIngestor(db, client, lambda: now, mode="historical").ingest_issuer("320193", since=date(2026, 1, 1))
    accepted = datetime(2026, 9, 18, 21, 10, tzinfo=timezone.utc)
    assert insider_transactions_as_of(db, "320193", accepted + timedelta(minutes=4), date(2026, 9, 1)) == []  # Latenz
    assert len(insider_transactions_as_of(db, "320193", accepted + timedelta(minutes=6), date(2026, 9, 1))) == 4
