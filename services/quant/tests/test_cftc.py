from datetime import date, datetime, timedelta, timezone

import httpx
import pytest

from quant.cot import positioning_as_of, store_cot
from quant.providers.base import ProviderError
from quant.providers.cftc import CftcProvider, cot_available_at, normalize


def tff_row(d, lev_long, lev_short, oi=1000):
    return {"report_date_as_yyyy_mm_dd": f"{d.isoformat()}T00:00:00.000", "cftc_contract_market_code": "13874A",
            "market_and_exchange_names": "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE", "open_interest_all": str(oi),
            "lev_money_positions_long": str(lev_long), "lev_money_positions_short": str(lev_short),
            "dealer_positions_long_all": "100", "dealer_positions_short_all": "90"}


def test_availability_is_conservative_and_handles_shutdowns():
    tue = date(2026, 9, 15)
    assert cot_available_at(tue) == datetime(2026, 9, 21, 19, 30, tzinfo=timezone.utc)  # Montag 15:30 NY
    assert cot_available_at(date(2019, 1, 8)).date() == date(2019, 3, 8)


def test_normalize_and_reject_incomplete():
    r = normalize("tff", tff_row(date(2026, 9, 15), 300, 500))
    assert r["categories"]["leveraged_funds"] == {"long": 300.0, "short": 500.0, "spread": None}
    with pytest.raises(ValueError):
        normalize("tff", {"cftc_contract_market_code": "x"})


def test_positioning_is_point_in_time_with_revisions(db):
    start = date(2025, 1, 7)
    rows = [normalize("tff", tff_row(start + timedelta(weeks=i), 300 + i * 10, 500)) for i in range(30)]
    assert store_cot(db, rows, received_at=datetime(2026, 9, 1, tzinfo=timezone.utc), mode="historical") == 30
    last_date = rows[-1]["report_date"]
    before_release = cot_available_at(last_date) - timedelta(hours=1)
    p = positioning_as_of(db, "13874A", "tff", "leveraged_funds", before_release)
    assert p["report_date"] == last_date - timedelta(weeks=1)  # der juengste Bericht war noch nicht veroeffentlicht
    p = positioning_as_of(db, "13874A", "tff", "leveraged_funds", cot_available_at(last_date) + timedelta(hours=1))
    assert p["net"] == (300 + 29 * 10) - 500 and p["weekly_change"] == 10 and p["zscore"] > 1.5 and p["percentile"] == 100.0
    # Revision eines Stichtags: neue Zeile, alte bleibt
    revised = normalize("tff", tff_row(last_date, 999, 500))
    assert store_cot(db, [revised], received_at=datetime(2026, 9, 2, tzinfo=timezone.utc)) == 1
    assert store_cot(db, [revised], received_at=datetime(2026, 9, 3, tzinfo=timezone.utc)) == 0
    assert db.execute("SELECT count(*) AS n FROM cot_reports WHERE report_date=%s", (last_date,)).fetchone()["n"] == 2


def test_provider_drops_bad_rows_and_reports_errors():
    good = tff_row(date(2026, 9, 15), 1, 2)
    p = CftcProvider(transport=lambda url, params, headers: httpx.Response(200, json=[good, {"broken": 1}]))
    r = p.reports("tff", ["13874A"], date(2026, 1, 1))
    assert len(r.data) == 1 and "1 Zeilen verworfen" in r.note
    with pytest.raises(ProviderError):
        CftcProvider(transport=lambda *a: httpx.Response(200, json={"error": True})).reports("tff", ["x"], date(2026, 1, 1))
