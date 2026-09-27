"""
Tageskurse (EOD) fuer US-Aktien und ETFs ueber Stooq-CSV.

Kostenlose Quelle fuer den privaten Research-Betrieb. Die Lizenz fuer eine
oeffentliche Anzeige ist ungeklaert (siehe data_sources). Werte sind
Tagesschlusskurse - niemals als Echtzeit darstellen. Laut Anbieter split- und
dividendenbereinigt; das wird als adjustment='split_dividend' gespeichert.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, time, timezone

from .base import Bar, ProviderError, Sourced, Timeframe
from .http import HttpSource, Transport

BASE = "https://stooq.com/q/d/l/"
ADJUSTMENT = "split_dividend"


def parse_csv(text: str) -> list[Bar]:
    if not text.strip() or text.strip().lower().startswith("no data"):
        return []
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "Close" not in reader.fieldnames:
        raise ValueError("Stooq-CSV ohne erwartete Spalten")
    bars: list[Bar] = []
    for row in reader:
        try:
            d = date.fromisoformat(row["Date"])
            o, h, l, c = (float(row[k]) for k in ("Open", "High", "Low", "Close"))
            v = float(row.get("Volume") or 0)
        except (ValueError, KeyError):
            continue
        # Tageskerze: Balkenbeginn = Kalendertag 00:00 UTC (Konvention fuer 1d)
        bars.append(Bar(ts=datetime.combine(d, time(0), tzinfo=timezone.utc), open=o, high=h, low=l, close=c, volume=v, is_final=True))
    return sorted(bars, key=lambda b: b.ts)


def stooq_symbol(ticker: str) -> str:
    return f"{ticker.lower().replace('.', '-')}.us"


class StooqProvider:
    source_id = "stooq"

    def __init__(self, transport: Transport | None = None):
        self._http = HttpSource(self.source_id, transport, min_interval_s=1.0)

    def bars(self, symbol: str, timeframe: Timeframe, start: date | None = None) -> Sourced[list[Bar]]:
        if timeframe != "1d":
            raise ProviderError(self.source_id, "invalid", "Stooq liefert im MVP nur Tageskerzen")
        params = {"s": stooq_symbol(symbol), "i": "d"}
        if start:
            params["d1"] = start.strftime("%Y%m%d")
        resp, fetched = self._http.get(BASE, params)
        try:
            bars = parse_csv(resp.text)
        except ValueError as exc:
            raise ProviderError(self.source_id, "invalid", str(exc)) from exc
        if not bars:
            raise ProviderError(self.source_id, "not_found", f"Keine Tageskurse fuer {symbol}")
        # Ob die letzte Zeile schon der finale Schluss ist, entscheidet der Aufrufer ueber die Boersenzeit.
        return Sourced(bars, self.source_id, fetched, bars[-1].ts, "end_of_day")
