"""Bot-Meldungen: Regeln, einmalige Archivierung, getrennte Zeitpunkte, Unveraenderlichkeit, API."""

from datetime import datetime, timedelta, timezone

import httpx
import psycopg
import pytest

from quant.messages import RULES, detect_insider_messages, format_name, money
from quant.sec.client import SecClient
from quant.sec.ingest import SecIngestor


def form4(owner: str, code: str, date: str, shares: int, price: float, after: int, *, plan: int = 0, title: str = "Chief Executive Officer",
          acquired: str | None = None, doc_type: str = "4") -> str:
    ad = acquired or ("A" if code == "P" else "D")
    return f"""<ownershipDocument><documentType>{doc_type}</documentType><aff10b5One>{plan}</aff10b5One>
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
        assert one["message"]["detected_at"] and one["message"]["published_at"] and one["message"]["observations"]
        assert one["hash_verified"] is True and one["links"] == []
        assert len(c.get("/messages?kind=insider_sale", headers=h).json()["data"]) == 1
        assert len(c.get("/messages?materiality=hoch", headers=h).json()["data"]) == 1
        assert c.get("/messages?kind=unsinn", headers=h).status_code == 422
        assert c.get("/messages/00000000-0000-0000-0000-000000000000", headers=h).status_code == 404
    finally:
        api.app.dependency_overrides.clear()


def test_run_log_and_status_endpoint(db, monkeypatch):
    from types import SimpleNamespace

    from fastapi.testclient import TestClient

    import quant.api as api
    import quant.scheduler as sched
    from quant.heartbeat import beat

    settings = SimpleNamespace(sec_user_agent="Test test@example.org", insider_watchlist=("TST",), sec_13f_managers=())
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

    out3 = sched.run_insider_task(db, settings)  # Quelle weiterhin aus: kein Doppel, kein Fehlalarm
    assert out3["new_messages"] == 0


def test_repeated_runs_never_duplicate_and_concurrent_run_is_skipped(db, monkeypatch):
    from types import SimpleNamespace

    import psycopg as pg

    import quant.scheduler as sched
    from quant.jobs import archive_summary

    real_now = datetime.now(timezone.utc)
    rows = [(a, (real_now - timedelta(hours=8)).date().isoformat(), r, (real_now - timedelta(hours=8)).strftime("%Y-%m-%dT%H:%M:%S.000Z"), fo, d)
            for a, _f, r, _acc, fo, d in FILINGS[:3]]

    class FakeClient:
        def __init__(self, *_a):
            self.inner = client(rows)

        def ticker_map(self):
            return {"TST": "42"}

        def __getattr__(self, name):
            return getattr(self.inner, name)

    monkeypatch.setattr("quant.sec.client.SecClient", FakeClient)
    settings = SimpleNamespace(sec_user_agent="Test test@example.org", insider_watchlist=("TST",), sec_13f_managers=())
    first = sched.run_insider_task(db, settings)
    again = sched.run_insider_task(db, settings)
    assert first["new_messages"] == 2 and again["new_messages"] == 0
    summary = archive_summary(db)
    assert summary["messages"] == 2 and summary["duplicates"] == 0 and summary["ok_runs"] == 2

    other = pg.connect(db.info.dsn, password=db.info.password, autocommit=True)
    try:
        other.execute("SELECT pg_advisory_lock(hashtext('ingest:sec_insider'))")
        skipped = sched.run_insider_task(db, settings)
        assert skipped.get("skipped") and skipped["ok"] is False
    finally:
        other.close()
    assert archive_summary(db)["runs"] == 2, "uebersprungener Lauf wird nicht als Abruf gezaehlt"


# ---------------------------------------------------------------------------- Etappe B: Folgeereignisse und Berichtigungen
DOCS.update({
    "/g.xml": form4("NEU NORA", "P", "2026-09-23", 2_000, 52, 6_000),                                    # dritte Kaeuferin
    "/h.xml": form4("MUSTER ANNA", "P", "2026-09-17", 12_000, 50, 32_000, doc_type="4/A"),               # Berichtigung von a.xml
})
AMEND = ("0000000042-26-000008", "2026-09-24", "2026-09-17", "2026-09-24T17:00:00.000Z", "4/A", "xslF345X05/h.xml")
THIRD = ("0000000042-26-000007", "2026-09-24", "2026-09-23", "2026-09-24T16:00:00.000Z", "4", "xslF345X05/g.xml")


def links(db):
    return db.execute("""SELECT f.kind AS from_kind, f.amendment AS from_amendment, l.relation, t.kind AS to_kind
                         FROM bot_message_links l JOIN bot_messages f ON f.message_id=l.from_id JOIN bot_messages t ON t.message_id=l.to_id
                         ORDER BY l.relation""").fetchall()


def test_growing_cluster_is_a_new_linked_message_original_untouched(db):
    t1 = datetime(2026, 9, 19, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:1], t1)
    detect_insider_messages(db, t1)
    t2 = datetime(2026, 9, 23, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:2], t2)
    detect_insider_messages(db, t2)
    first_cluster = db.execute("SELECT * FROM bot_messages WHERE kind='insider_cluster'").fetchone()
    t3 = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
    ingest(db, [*FILINGS[:2], THIRD], t3)
    assert detect_insider_messages(db, t3) == 1
    clusters = db.execute("SELECT * FROM bot_messages WHERE kind='insider_cluster' ORDER BY detected_at").fetchall()
    assert len(clusters) == 2 and clusters[0] == first_cluster, "fruehere Kaufgruppe bleibt unveraendert"
    assert clusters[1]["title"].startswith("3 Insider") and clusters[1]["detected_at"] == t3
    rel = {(r["from_kind"], r["relation"], r["to_kind"]) for r in links(db)}
    assert ("insider_cluster", "erweitert", "insider_cluster") in rel
    assert ("insider_cluster", "fasst_zusammen", "insider_buy") in rel
    assert detect_insider_messages(db, t3 + timedelta(hours=1)) == 0, "keine Wiederholung"


def test_amendment_is_linked_correction_and_never_double_counted(db):
    t1 = datetime(2026, 9, 19, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:1], t1)
    detect_insider_messages(db, t1)
    original = db.execute("SELECT * FROM bot_messages").fetchone()
    t2 = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
    ingest(db, [FILINGS[0], AMEND], t2)
    assert detect_insider_messages(db, t2) == 1
    fix = db.execute("SELECT * FROM bot_messages WHERE amendment").fetchone()
    assert fix["title"].startswith("Berichtigung:") and "600,00" in fix["title"]
    assert db.execute("SELECT * FROM bot_messages WHERE message_id=%s", (original["message_id"],)).fetchone() == original
    assert [(r["from_amendment"], r["relation"]) for r in links(db)] == [(True, "berichtigt")]


def test_amendment_seen_together_with_original_replaces_it(db):
    now = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
    ingest(db, [FILINGS[0], AMEND], now)
    detect_insider_messages(db, now)
    rows = db.execute("SELECT amendment, value_usd FROM bot_messages").fetchall()
    assert [(r["amendment"], r["value_usd"]) for r in rows] == [(True, 600_000)], "ersetztes Original erzeugt keine eigene Meldung"


def test_received_at_and_hash_verification(db):
    from quant.messages import verify_hash
    now = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS, now)
    detect_insider_messages(db, now + timedelta(minutes=5))
    for r in db.execute("SELECT * FROM bot_messages").fetchall():
        assert r["received_at"] == now and r["published_at"] <= r["received_at"] <= r["detected_at"]
        assert r["materiality"] in ("hoch", "mittel") and r["rule_version"] == "insider-rules-1.2"
        assert verify_hash(r) is True
        assert verify_hash({**r, "value_usd": (r["value_usd"] or 0) + 1}) is False
    assert verify_hash({"rule_version": "unbekannt"}) is None


def test_legacy_1_0_hash_stays_verifiable():
    from quant.messages import content_hash, verify_hash
    row = {"dedup_key": "k", "kind": "insider_buy", "ticker": "TST", "issuer_cik": "42", "issuer_name": "T", "title": "t", "relevance": "r",
           "uncertainty": "u", "counter_arguments": [], "observations": [{"a": 1}], "sources": [], "selection": "s", "value_usd": 1.0,
           "traded_from": None, "traded_to": None, "published_at": datetime(2026, 9, 1, tzinfo=timezone.utc), "rule_version": "insider-rules-1.0",
           "received_at": None, "materiality": None, "amendment": False}
    row["content_hash"] = content_hash(row, "insider-rules-1.0")
    assert verify_hash(row) is True


def test_links_are_append_only(db):
    t1 = datetime(2026, 9, 19, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:1], t1)
    detect_insider_messages(db, t1)
    t2 = datetime(2026, 9, 23, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:2], t2)
    detect_insider_messages(db, t2)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("DELETE FROM bot_message_links")
    db.rollback()


def test_api_detail_links_and_coverage_gaps(db, monkeypatch):
    import uuid

    from fastapi.testclient import TestClient
    from psycopg.types.json import Jsonb

    import quant.api as api
    t1 = datetime(2026, 9, 19, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:1], t1)
    detect_insider_messages(db, t1)
    t2 = datetime(2026, 9, 23, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:2], t2)
    detect_insider_messages(db, t2)
    now = datetime.now(timezone.utc)
    for minutes_ago in (600, 570, 540, 60, 30):  # Luecke zwischen -540 und -60 Minuten
        t = now - timedelta(minutes=minutes_ago)
        db.execute("INSERT INTO ingest_runs VALUES (%s,'sec_insider',%s,%s,true,%s,NULL)", (uuid.uuid4(), t, t, Jsonb({})))
    db.commit()
    monkeypatch.setenv("BOT_API_TOKEN", "t")
    db.autocommit = True
    api.app.dependency_overrides[api.db] = lambda: db
    try:
        c = TestClient(api.app)
        h = {"Authorization": "Bearer t"}
        single = next(m for m in c.get("/messages", headers=h).json()["data"] if m["kind"] == "insider_buy")
        assert single["has_followups"] is True
        detail = c.get(f"/messages/{single['message_id']}", headers=h).json()["data"]
        assert [(lk["direction"], lk["relation"], lk["kind"]) for lk in detail["links"]] == [("spaeter", "fasst_zusammen", "insider_cluster")]
        cov = c.get("/messages/coverage?days=2", headers=h).json()["data"]
        assert cov["successful_runs"] == 5 and len(cov["gaps"]) == 1 and cov["gaps"][0]["hours"] == 8.0
    finally:
        api.app.dependency_overrides.clear()


def test_correction_of_a_member_creates_a_corrected_cluster_message(db):
    t1 = datetime(2026, 9, 19, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:1], t1)
    detect_insider_messages(db, t1)
    t2 = datetime(2026, 9, 23, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:2], t2)
    detect_insider_messages(db, t2)
    old = db.execute("SELECT * FROM bot_messages WHERE kind='insider_cluster'").fetchone()
    t3 = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
    ingest(db, [*FILINGS[:2], AMEND], t3)
    assert detect_insider_messages(db, t3) == 1
    new = db.execute("SELECT * FROM bot_messages WHERE kind='insider_cluster' AND amendment").fetchone()
    assert new["title"].startswith("Berichtigung: 2 Insider") and new["value_usd"] == 600_000 + 204_000
    assert db.execute("SELECT * FROM bot_messages WHERE message_id=%s", (old["message_id"],)).fetchone() == old
    rel = {(r["from_kind"], r["relation"], r["to_kind"]) for r in links(db)}
    assert ("insider_cluster", "berichtigt", "insider_cluster") in rel
    assert ("insider_cluster", "berichtigt", "insider_buy") in rel, "auch die fruehere Einzelmeldung gilt als berichtigt"
    assert detect_insider_messages(db, t3 + timedelta(hours=1)) == 0, "Berichtigung wird nicht wiederholt"


def test_unknown_plan_is_not_treated_as_no_plan(db):
    DOCS["/u.xml"] = form4("OHNE ANGABE", "P", "2026-09-22", 1_000, 50, 4_000).replace("<aff10b5One>0</aff10b5One>", "")
    unknown = ("0000000042-26-000009", "2026-09-23", "2026-09-22", "2026-09-23T15:00:00.000Z", "4", "xslF345X05/u.xml")
    now = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    ingest(db, [unknown], now)
    assert db.execute("SELECT plan_status FROM insider_transactions").fetchone()["plan_status"] == "unknown"
    detect_insider_messages(db, now)
    m = db.execute("SELECT * FROM bot_messages").fetchone()
    assert m["observations"][0]["plan_status"] == "unknown"
    assert "ohne Angabe zu einem Handelsplan" in m["relevance"] and "nicht sicher belegt" in m["uncertainty"]
    assert m["rule_version"] == "insider-rules-1.2"


def test_legacy_rows_without_plan_status_are_marked_uncertain(db):
    from quant.messages import load_transactions
    now = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    ingest(db, FILINGS[:1], now)
    # Zustand vor Migration 0013 nachbilden: Zeile ohne plan_status (neue Testdatenbank, nicht das Archiv)
    db.execute("ALTER TABLE insider_transactions DISABLE TRIGGER insider_transactions_append_only")
    db.execute("UPDATE insider_transactions SET plan_status = NULL")
    db.execute("ALTER TABLE insider_transactions ENABLE TRIGGER insider_transactions_append_only")
    tx = load_transactions(db, now)[0]
    assert tx.plan_status == "legacy_uncertain"
