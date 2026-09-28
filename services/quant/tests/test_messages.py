"""Bot-Meldungen: Regeln, einmalige Archivierung, getrennte Zeitpunkte, Unveraenderlichkeit, API."""

from datetime import datetime, timedelta, timezone

import httpx
import psycopg
import pytest

from quant.messages import RULES, detect_insider_messages, format_name, money
from quant.sec.client import SecClient
from quant.sec.ingest import SecIngestor


def form4(owner: str, code: str, date: str, shares: int, price: float, after: int, *, plan: int = 0, title: str = "Chief Executive Officer",
          acquired: str | None = None) -> str:
    ad = acquired or ("A" if code == "P" else "D")
    return f"""<ownershipDocument><documentType>4</documentType><aff10b5One>{plan}</aff10b5One>
<issuer><issuerCik>0000000042</issuerCik><issuerName>Test Corp</issuerName><issuerTradingSymbol>TST</issuerTradingSymbol></issuer>
<reportingOwner><reportingOwnerId><rptOwnerCik>1</rptOwnerCik><rptOwnerName>{owner}</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isOfficer>1</isOfficer><officerTitle>{title}</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle>
<transactionDate><value>{date}</value></transactionDate><transactionCoding><transactionCode>{code}</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>{shares}</value></transactionShares><transactionPricePerShare><value>{price}</value></transactionPricePerShare>
<transactionAcquiredDisposedCode><value>{ad}</value></transactionAcquiredDisposedCode></transactionAmounts>
<postTransactionAmounts><sharesOwnedFollowingTransaction><value>{after}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
<ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
</nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>"""


def submissions(rows):
    cols = ["accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "form", "primaryDocument"]
    return {"filings": {"recent": {c: [r[i] for r in rows] for i, c in enumerate(cols)}}}


FILINGS = [
    # accession, filed, report, accepted, form, doc
    ("0000000042-26-000001", "2026-09-18", "2026-09-17", "2026-09-18T17:00:00.000Z", "4", "xslF345X05/a.xml"),   # Kauf A
    ("0000000042-26-000002", "2026-09-22", "2026-09-21", "2026-09-22T17:00:00.000Z", "4", "xslF345X05/b.xml"),   # Kauf B -> Cluster
    ("0000000042-26-000003", "2026-09-23", "2026-09-22", "2026-09-23T17:00:00.000Z", "4", "xslF345X05/c.xml"),   # grosser Verkauf
    ("0000000042-26-000004", "2026-09-23", "2026-09-22", "2026-09-23T18:00:00.000Z", "4", "xslF345X05/d.xml"),   # Kauf mit Plan
    ("0000000042-26-000005", "2026-09-23", "2026-09-22", "2026-09-23T19:00:00.000Z", "4", "xslF345X05/e.xml"),   # kleiner Verkauf
    ("0000000042-26-000006", "2026-08-20", "2026-08-19", "2026-08-20T17:00:00.000Z", "4", "xslF345X05/f.xml"),   # zu alt
]
DOCS = {
    "/a.xml": form4("MUSTER ANNA", "P", "2026-09-17", 10_000, 50, 30_000),
    "/b.xml": form4("PROBE BERND", "P", "2026-09-21", 4_000, 51, 9_000, title="Chief Financial Officer"),
    "/c.xml": form4("BEISPIEL DORA", "S", "2026-09-22", 40_000, 60, 200_000),
    "/d.xml": form4("PLAN PETER", "P", "2026-09-22", 1_000, 50, 5_000, plan=1),
    "/e.xml": form4("KLEIN KARL", "S", "2026-09-22", 100, 50, 100_000),
    "/f.xml": form4("ALT ALBERT", "P", "2026-08-19", 1_000, 50, 5_000),
}


def client(filings):
    def send(url, params, headers):
        if url.endswith("CIK0000000042.json"):
            return httpx.Response(200, json=submissions(filings))
        for key, body in DOCS.items():
            if url.endswith(key):
                return httpx.Response(200, text=body)
        return httpx.Response(404)
    return SecClient("Test test@example.org", send)


def ingest(db, filings, at):
    SecIngestor(db, client(filings), lambda: at).ingest_issuer("42", (at - timedelta(days=120)).date())


def messages(db):
    return db.execute("SELECT * FROM bot_messages ORDER BY detected_at, kind, dedup_key").fetchall()


def test_rules_cluster_sale_and_exclusions(db):
    now = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS, now)
    assert detect_insider_messages(db, now) == 2
    rows = messages(db)
    kinds = sorted(r["kind"] for r in rows)
    assert kinds == ["insider_cluster", "insider_sale"], "Plan-Kauf, kleiner Verkauf und alte Meldung loesen nichts aus"
    cluster = next(r for r in rows if r["kind"] == "insider_cluster")
    assert cluster["title"].startswith("2 Insider von Test Corp kaufen innerhalb von 5 Tagen")
    assert "Anna Muster" in cluster["relevance"] and "Bernd Probe" in cluster["relevance"]
    assert str(cluster["traded_from"]) == "2026-09-17" and str(cluster["traded_to"]) == "2026-09-21"
    assert len(cluster["observations"]) == 2 and len(cluster["sources"]) == 2
    assert cluster["sources"][0]["url"].endswith("/")  # Index der Einreichung, nicht die XSL-Ansicht
    assert cluster["counter_arguments"] and cluster["uncertainty"]
    sale = next(r for r in rows if r["kind"] == "insider_sale")
    assert "2,40 Mio. $" in sale["title"] and sale["ticker"] == "TST"


def test_detected_at_is_first_detection_and_three_times_are_separate(db):
    first = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS, first)
    detect_insider_messages(db, first)
    later = first + timedelta(hours=6)
    assert detect_insider_messages(db, later) == 0, "gleiche Erkennung wird nicht erneut archiviert"
    for r in messages(db):
        assert r["detected_at"] == first
        assert r["published_at"] < r["detected_at"]
        assert r["traded_to"] <= r["published_at"].date()


def test_single_buy_first_then_cluster_is_a_new_message(db):
    t1 = datetime(2026, 9, 19, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:1], t1)
    detect_insider_messages(db, t1)
    assert [r["kind"] for r in messages(db)] == ["insider_buy"]
    t2 = datetime(2026, 9, 23, 12, tzinfo=timezone.utc)  # Annahme 17:00 wird als New-Yorker Zeit gelesen = 21:00 UTC
    ingest(db, FILINGS[:2], t2)
    detect_insider_messages(db, t2)
    rows = messages(db)
    assert [r["kind"] for r in rows] == ["insider_buy", "insider_cluster"]
    assert rows[0]["detected_at"] == t1 and rows[1]["detected_at"] == t2


def test_not_detected_before_the_bot_received_the_filing(db):
    received = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS, received)
    assert detect_insider_messages(db, received - timedelta(minutes=1)) == 0


def test_archive_is_append_only(db):
    now = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS, now)
    detect_insider_messages(db, now)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("UPDATE bot_messages SET title = 'geaendert'")
    db.rollback()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("DELETE FROM bot_messages")
    db.rollback()


def test_helpers():
    assert format_name("COOK TIMOTHY D") == "Timothy D Cook"
    assert format_name("Doe, Jane") == "Jane Doe"
    assert money(4_210_000) == "4,21 Mio. $"
    assert RULES["max_age_days"] == 14


def test_api_lists_and_returns_messages(db, monkeypatch):
    from fastapi.testclient import TestClient

    import quant.api as api
    now = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS, now)
    detect_insider_messages(db, now)
    monkeypatch.setenv("BOT_API_TOKEN", "t")
    db.autocommit = True
    api.app.dependency_overrides[api.db] = lambda: db
    try:
        c = TestClient(api.app)
        assert c.get("/messages").status_code == 401
        h = {"Authorization": "Bearer t"}
        body = c.get("/messages?ticker=tst", headers=h).json()
        assert len(body["data"]) == 2 and body["meta"]["audience"] == "internal"
        one = c.get(f"/messages/{body['data'][0]['message_id']}", headers=h).json()["data"]
        assert one["detected_at"] and one["published_at"] and one["observations"]
        assert c.get("/messages/00000000-0000-0000-0000-000000000000", headers=h).status_code == 404
    finally:
        api.app.dependency_overrides.clear()


def test_run_log_and_status_endpoint(db, monkeypatch):
    from types import SimpleNamespace

    from fastapi.testclient import TestClient

    import quant.api as api
    import quant.scheduler as sched
    from quant.heartbeat import beat

    settings = SimpleNamespace(sec_user_agent="Test test@example.org", equity_symbols=("TST",), sec_13f_managers=())
    real_now = datetime.now(timezone.utc)
    shifted = [(a, (real_now - timedelta(hours=8)).date().isoformat(), r, (real_now - timedelta(hours=8)).strftime("%Y-%m-%dT%H:%M:%S.000Z"), fo, d)
               for a, _f, r, _acc, fo, d in FILINGS[:3]]

    class FakeClient:
        def __init__(self, *_a):
            self.inner = client(shifted)

        def ticker_map(self):
            return {"TST": "42"}

        def __getattr__(self, name):
            return getattr(self.inner, name)

    monkeypatch.setattr("quant.sec.client.SecClient", FakeClient)
    out = sched.run_insider_task(db, settings)
    assert out["ok"] and out["new_messages"] >= 1

    def broken(*_a):
        from quant.providers.base import ProviderError
        raise ProviderError("sec", "unavailable", "offline")
    monkeypatch.setattr("quant.sec.client.SecClient", broken)
    out2 = sched.run_insider_task(db, settings)
    assert not out2["ok"] and out2["new_messages"] == 0
    runs = db.execute("SELECT ok, error_summary FROM ingest_runs ORDER BY finished_at").fetchall()
    assert [r["ok"] for r in runs] == [True, False] and "Internetverbindung" in runs[1]["error_summary"]
    beat(db, "scheduler", now=real_now, started_at=real_now)

    monkeypatch.setenv("BOT_API_TOKEN", "t")
    db.autocommit = True
    api.app.dependency_overrides[api.db] = lambda: db
    try:
        body = TestClient(api.app).get("/messages/status", headers={"Authorization": "Bearer t"}).json()["data"]
        assert body["interval_minutes"] == 30
        assert body["last_success_at"] and body["last_attempt_ok"] is False
        assert body["last_attempt_at"] > body["last_success_at"]
        assert body["archive"]["messages"] >= 1 and body["scheduler_last_beat"]
    finally:
        api.app.dependency_overrides.clear()
