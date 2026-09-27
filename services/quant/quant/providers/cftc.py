"""
CFTC Commitments of Traders (COT) ueber die Socrata-API (publicreporting.cftc.gov).

Berichte (Futures only):
  legacy        6dca-aqww   Commercial / Non-Commercial / Nonreportable
  disaggregated 72hh-3qpy   Producer-Merchant / Swap Dealer / Managed Money / Other Reportable
  tff           gpe5-46if   Dealer / Asset Manager / Leveraged Funds / Other Reportable (Finanz-Futures)
Datensatz-IDs und Feldnamen laut CFTC-Dokumentation; vor dem Produktivbetrieb live pruefen.

Zeitlogik: Stichtag ist Dienstag, die Veroeffentlichung erfolgt regulaer Freitag 15:30 New York,
bei Feiertagen spaeter, bei Regierungsstillstaenden teils Wochen spaeter. Fuer historische Daten
nehmen wir daher KONSERVATIV den folgenden Montag 15:30 New York (+6 Tage) und fuer bekannte
Stillstaende feste spaete Termine. Im Live-Betrieb zaehlt ohnehin der tatsaechliche Abrufzeitpunkt.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .base import ProviderError, Sourced
from .http import HttpSource, Transport

NEW_YORK = ZoneInfo("America/New_York")
BASE = "https://publicreporting.cftc.gov/resource"
DATASETS = {"legacy": "6dca-aqww", "disaggregated": "72hh-3qpy", "tff": "gpe5-46if"}

# Kategorie -> (Long-, Short-, Spread-Feldkandidaten). Mehrere Kandidaten, weil die Feldnamen je Bericht leicht abweichen.
CATEGORIES: dict[str, dict[str, tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]]] = {
    "legacy": {
        "commercial": (("comm_positions_long_all",), ("comm_positions_short_all",), ()),
        "non_commercial": (("noncomm_positions_long_all",), ("noncomm_positions_short_all",),
                           ("noncomm_postions_spread_all", "noncomm_positions_spread_all")),
        "nonreportable": (("nonrept_positions_long_all",), ("nonrept_positions_short_all",), ()),
    },
    "disaggregated": {
        "producer_merchant": (("prod_merc_positions_long", "prod_merc_positions_long_all"), ("prod_merc_positions_short", "prod_merc_positions_short_all"), ()),
        "swap_dealers": (("swap_positions_long_all",), ("swap__positions_short_all", "swap_positions_short_all"), ("swap__positions_spread_all", "swap_positions_spread_all")),
        "managed_money": (("m_money_positions_long_all",), ("m_money_positions_short_all",), ("m_money_positions_spread",)),
        "other_reportable": (("other_rept_positions_long", "other_rept_positions_long_all"), ("other_rept_positions_short", "other_rept_positions_short_all"), ()),
    },
    "tff": {
        "dealers": (("dealer_positions_long_all",), ("dealer_positions_short_all",), ("dealer_positions_spread_all",)),
        "asset_managers": (("asset_mgr_positions_long", "asset_mgr_positions_long_all"), ("asset_mgr_positions_short", "asset_mgr_positions_short_all"), ("asset_mgr_positions_spread",)),
        "leveraged_funds": (("lev_money_positions_long", "lev_money_positions_long_all"), ("lev_money_positions_short", "lev_money_positions_short_all"), ("lev_money_positions_spread",)),
        "other_reportable": (("other_rept_positions_long", "other_rept_positions_long_all"), ("other_rept_positions_short", "other_rept_positions_short_all"), ()),
    },
}

# Bekannte Stillstaende: Berichte mit Stichtag im Zeitraum wurden erst deutlich spaeter veroeffentlicht.
# Konservativ auf das Ende der Nachholphase gesetzt (Nachholtermine ungefaehr - lieber zu spaet als zu frueh).
SHUTDOWN_OVERRIDES = [
    (date(2013, 10, 1), date(2013, 10, 29), date(2013, 11, 8)),
    (date(2018, 12, 18), date(2019, 2, 5), date(2019, 3, 8)),
]


def cot_available_at(report_date: date) -> datetime:
    for start, end, released in SHUTDOWN_OVERRIDES:
        if start <= report_date <= end:
            return datetime.combine(released, time(15, 30), tzinfo=NEW_YORK).astimezone(timezone.utc)
    return datetime.combine(report_date + timedelta(days=6), time(15, 30), tzinfo=NEW_YORK).astimezone(timezone.utc)


def _pick(row: dict, names: tuple[str, ...]) -> float | None:
    for n in names:
        if row.get(n) not in (None, ""):
            try:
                return float(row[n])
            except (TypeError, ValueError):
                return None
    return None


def normalize(report_type: str, row: dict[str, Any]) -> dict:
    rd = row.get("report_date_as_yyyy_mm_dd")
    code = row.get("cftc_contract_market_code")
    name = row.get("market_and_exchange_names")
    if not rd or not code or not name:
        raise ValueError("Pflichtfeld fehlt (Stichtag/Kontrakt/Markt)")
    cats = {}
    for cat, (long_names, short_names, sp) in CATEGORIES[report_type].items():
        long_, short = _pick(row, long_names), _pick(row, short_names)
        if long_ is None and short is None:
            continue
        cats[cat] = {"long": long_, "short": short, "spread": _pick(row, sp) if sp else None}
    if not cats:
        raise ValueError("keine Positionskategorien im Datensatz")
    return {"report_type": report_type, "contract_code": str(code).strip(), "market_name": name.strip(),
            "report_date": date.fromisoformat(rd[:10]), "open_interest": _pick(row, ("open_interest_all",)), "categories": cats, "raw": row}


class CftcProvider:
    source_id = "cftc"

    def __init__(self, transport: Transport | None = None, app_token: str | None = None):
        self._http = HttpSource("cftc", transport, min_interval_s=0.5)
        self._headers = {"X-App-Token": app_token} if app_token else None

    def reports(self, report_type: str, contract_codes: list[str], since: date) -> Sourced[list[dict]]:
        codes = ",".join(f"'{c}'" for c in contract_codes)
        params = {"$where": f"cftc_contract_market_code in ({codes}) AND report_date_as_yyyy_mm_dd >= '{since.isoformat()}T00:00:00'",
                  "$order": "report_date_as_yyyy_mm_dd", "$limit": 50000}
        resp, fetched = self._http.get(f"{BASE}/{DATASETS[report_type]}.json", params, self._headers)
        try:
            raw = resp.json()
            if not isinstance(raw, list):
                raise ValueError("Liste erwartet")
        except ValueError as exc:
            raise ProviderError("cftc", "invalid", f"Antwort unbrauchbar: {exc}") from exc
        rows, bad = [], 0
        for r in raw:
            try:
                rows.append(normalize(report_type, r))
            except (ValueError, TypeError):
                bad += 1
        return Sourced(rows, self.source_id, fetched, None, "weekly", note=f"{bad} Zeilen verworfen" if bad else None)
