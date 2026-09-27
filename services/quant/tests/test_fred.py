from datetime import date, datetime, timedelta, timezone

import httpx
import pytest

from quant.macro import macro_as_of, store_vintages
from quant.providers.base import NotConfiguredError, ProviderError
from quant.providers.fred import FredProvider, parse_vintages, release_available_at

# ALFRED-Format: CPI Januar 2026 erst 3,1 (Erstveroeffentlichung 11.02.), spaeter revidiert auf 3,0 (13.03.)
ALFRED = {"observations": [
    {"realtime_start": "2026-02-11", "realtime_end": "2026-03-12", "date": "2026-01-01", "value": "3.1"},
    {"realtime_start": "2026-03-13", "realtime_end": "9999-12-31", "date": "2026-01-01", "value": "3.0"},
    {"realtime_start": "2026-03-13", "realtime_end": "9999-12-31", "date": "2026-02-01", "value": "2.9"},
    {"realtime_start": "2026-02-11", "realtime_end": "9999-12-31", "date": "2025-12-01", "value": "."},
]}


def test_release_time_known_or_conservative_end_of_day():
    assert release_available_at("CPIAUCSL", date(2026, 2, 11)) == datetime(2026, 2, 11, 13, 30, tzinfo=timezone.utc)
    assert release_available_at("UNKNOWNSERIES", date(2026, 2, 11)).hour == 4  # 23:59 New York = 04:59 UTC Folgetag


def test_backtest_before_revision_sees_only_initial_release(db):
    rows = parse_vintages(ALFRED, "CPIAUCSL")
    assert len(rows) == 3  # '.' verworfen
    store_vintages(db, rows, received_at=datetime(2026, 9, 1, tzinfo=timezone.utc), mode="historical")
    db.commit()
    jan = lambda as_of: {r["observation_period"]: (r["value"], r["revision_number"]) for r in macro_as_of(db, "CPIAUCSL", as_of)}
    assert jan(datetime(2026, 2, 11, 13, 0, tzinfo=timezone.utc)) == {}                       # 08:00 NY: noch nicht veroeffentlicht
    assert jan(datetime(2026, 2, 11, 13, 40, tzinfo=timezone.utc)) == {date(2026, 1, 1): (3.1, 0)}  # nach 08:30 + Latenz
    assert jan(datetime(2026, 3, 1, tzinfo=timezone.utc)) == {date(2026, 1, 1): (3.1, 0)}      # vor der Revision: nur X
    assert jan(datetime(2026, 3, 14, tzinfo=timezone.utc)) == {date(2026, 1, 1): (3.0, 1), date(2026, 2, 1): (2.9, 0)}


def test_live_mode_knows_nothing_before_fetch(db):
    rows = parse_vintages(ALFRED, "CPIAUCSL")
    fetched = datetime(2026, 9, 1, tzinfo=timezone.utc)
    store_vintages(db, rows, received_at=fetched)
    assert macro_as_of(db, "CPIAUCSL", fetched - timedelta(seconds=1)) == []
    # erneuter Abruf: keine Doppelten, keine Aenderung bestehender Fassungen
    assert store_vintages(db, rows, received_at=fetched + timedelta(days=1)) == 0


def test_fred_provider_errors():
    with pytest.raises(NotConfiguredError):
        FredProvider(None)
    timeout = FredProvider("k", transport=lambda *a: (_ for _ in ()).throw(httpx.ConnectTimeout("t")))
    with pytest.raises(ProviderError) as exc:
        timeout.releases("CPIAUCSL", date(2026, 1, 1))
    assert exc.value.reason == "unavailable"
    bad = FredProvider("k", transport=lambda *a: httpx.Response(200, json={"error_message": "Bad Request"}))
    with pytest.raises(ProviderError) as exc:
        bad.releases("CPIAUCSL", date(2026, 1, 1))
    assert exc.value.reason == "invalid"
    ok = FredProvider("k", transport=lambda url, params, headers: httpx.Response(200, json=ALFRED) if params["realtime_start"] == "1776-07-04" else None)
    assert len(ok.releases("CPIAUCSL", date(2025, 1, 1)).data) == 3
