"""
FRED/ALFRED - Makrodaten MIT Datenstaenden (Vintages).

Fuer Backtests darf nie die heute revidierte Reihe verwendet werden. ALFRED liefert
je Beobachtung alle Fassungen mit realtime_start (ab wann die Fassung galt).
Abruf: series/observations mit realtime_start=1776-07-04, realtime_end=9999-12-31.

Veroeffentlichungszeit: ALFRED kennt nur das DATUM. Fuer Reihen mit bekannter
Uhrzeit (z. B. CPI 08:30 New York) wird diese verwendet, sonst konservativ das
Tagesende (New York) - ein Wert ist damit nie frueher nutzbar als real.
Konsensschaetzungen gibt es hier nicht (lizenzpflichtig) - "Surprise" bleibt leer.
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .base import MacroRelease, NotConfiguredError, ProviderError, Sourced
from .http import HttpSource, Transport

NEW_YORK = ZoneInfo("America/New_York")
BASE = "https://api.stlouisfed.org/fred/series/observations"

# Offizielle Veroeffentlichungszeiten (New York) fuer wichtige Reihen; alle anderen: Tagesende
RELEASE_TIMES: dict[str, time] = {
    "CPIAUCSL": time(8, 30), "CPILFESL": time(8, 30),       # BLS CPI
    "PAYEMS": time(8, 30), "UNRATE": time(8, 30), "AHETPI": time(8, 30),  # BLS Employment Situation
    "PCEPI": time(8, 30), "PCEPILFE": time(8, 30), "GDP": time(8, 30), "GDPC1": time(8, 30),  # BEA
    "RSAFS": time(8, 30), "ICSA": time(8, 30),
    "INDPRO": time(9, 15),                                   # Fed G.17
}
END_OF_DAY = time(23, 59, 59)


def release_available_at(series_id: str, realtime_start: date) -> datetime:
    t = RELEASE_TIMES.get(series_id, END_OF_DAY)
    return datetime.combine(realtime_start, t, tzinfo=NEW_YORK).astimezone(timezone.utc)


def parse_vintages(raw: dict[str, Any], series_id: str) -> list[MacroRelease]:
    obs = raw.get("observations")
    if not isinstance(obs, list):
        raise ValueError("observations fehlt")
    out = []
    for o in obs:
        v = o.get("value")
        if v in (None, "", "."):  # '.' = in dieser Fassung kein Wert
            continue
        out.append(MacroRelease(series_id=series_id, period=date.fromisoformat(o["date"]), value=float(v),
                                realtime_start=date.fromisoformat(o["realtime_start"])))
    return sorted(out, key=lambda r: (r.period, r.realtime_start))


class FredProvider:
    source_id = "fred"

    def __init__(self, api_key: str | None, transport: Transport | None = None):
        if not api_key:
            raise NotConfiguredError("fred", "FRED_API_KEY fehlt (kostenlos: fred.stlouisfed.org/docs/api/api_key.html).")
        self._key = api_key
        self._http = HttpSource("fred", transport, min_interval_s=0.6)  # FRED: max. 120 Anfragen/Minute

    def releases(self, series_id: str, since: date) -> Sourced[list[MacroRelease]]:
        params = {"series_id": series_id, "api_key": self._key, "file_type": "json", "realtime_start": "1776-07-04",
                  "realtime_end": "9999-12-31", "observation_start": since.isoformat()}
        resp, fetched = self._http.get(BASE, params)
        try:
            rows = parse_vintages(resp.json(), series_id)
        except (ValueError, KeyError, TypeError) as exc:
            raise ProviderError("fred", "invalid", f"Antwort unbrauchbar: {exc}") from exc
        latest = max((release_available_at(series_id, r.realtime_start) for r in rows), default=None)
        return Sourced(rows, self.source_id, fetched, latest, "event")
