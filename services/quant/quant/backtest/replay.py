"""
Historical Replay Adapter: implementiert DIESELBEN Provider-Schnittstellen wie Binance/Stooq,
liefert aber nur, was zur Simulationszeit `clock()` tatsaechlich verfuegbar war:

  * Balken erst nach ihrem Ende (ts + Laenge <= jetzt); Tageskurse US erst ab 18:00 New York
  * Funding erst ab Abrechnungszeitpunkt, Open Interest erst nach Ende des 5-Minuten-Intervalls
  * Premium-Index: letzter Wert <= jetzt
  * Quote/Orderbuch: ohne aufgezeichnetes Buch MODELLIERT aus dem letzten Schlusskurs (+/- halber Spread),
    ausdruecklich gekennzeichnet; kein Orderbuch -> Ausfuehrung ueber Bid/Ask + Slippage-Modell
Anfragen nach Daten, die es im Datensatz nicht gibt, melden ehrlich "nicht angebunden".
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from ..providers.base import Bar, NotConfiguredError, NotConfiguredProvider, ProviderError, Quote, Sourced
from ..providers.registry import Providers
from .dataset import TF_LEN, HistoricalDataset

NEW_YORK = ZoneInfo("America/New_York")
EQUITY_EOD_AVAILABLE = time(18, 0)
Clock = Callable[[], datetime]


class ReplayCrypto:
    source_id = "binance"

    def __init__(self, ds: HistoricalDataset, clock: Clock, modeled_half_spread_bps: float = 1.0):
        self.ds, self.clock, self.half_spread = ds, clock, modeled_half_spread_bps

    def _series(self, book: dict, symbol: str, tf: str):
        s = book.get(symbol, {}).get(tf)
        if s is None:
            raise NotConfiguredError(self.source_id, f"Replay: keine {tf}-Daten fuer {symbol}")
        return s

    def _bars(self, book: dict, symbol: str, tf: str, limit: int, start: datetime | None) -> Sourced[list[Bar]]:
        now = self.clock()
        s = self._series(book, symbol, tf)
        length = TF_LEN[tf]
        end_excl = now - length + timedelta(microseconds=1)  # nur Balken mit ts + Laenge <= jetzt (abgeschlossen)
        if start is not None:
            bars = s.between(start, end_excl)[:limit]
        else:
            bars = s.between(end_excl - length * (limit + 1), end_excl)[-limit:]
        return Sourced(bars, self.source_id, now, bars[-1].ts if bars else None, "intraday")

    def spot_bars(self, symbol, timeframe, limit, start=None):
        return self._bars(self.ds.spot, symbol, timeframe, limit, start)

    def perp_bars(self, symbol, timeframe, limit, start=None):
        return self._bars(self.ds.perp, symbol, timeframe, limit, start)

    def _last_close(self, symbol: str) -> Bar | None:
        s = self._series(self.ds.spot, symbol, "1m")
        bars = s.between(self.clock() - timedelta(minutes=10), self.clock() - TF_LEN["1m"] + timedelta(microseconds=1))
        return bars[-1] if bars else None

    def spot_quote(self, symbol):
        b = self._last_close(symbol)
        if b is None:
            raise ProviderError(self.source_id, "unavailable", "Replay: kein Kurs in den letzten 10 Minuten")
        h = b.close * self.half_spread / 1e4
        at = b.ts + TF_LEN["1m"]
        return Sourced(Quote(b.close - h, b.close + h, None, None, at), self.source_id, self.clock(), at, "intraday",
                       note="modelliert aus Schlusskurs (Replay ohne Orderbuch)")

    def spot_order_book(self, symbol, depth):
        raise NotConfiguredError(self.source_id, "Replay: kein aufgezeichnetes Orderbuch")

    def premium_index(self, symbol):
        rows = [p for p in self.ds.premium.get(symbol, []) if p.ts <= self.clock()]
        if not rows:
            raise NotConfiguredError(self.source_id, "Replay: kein Premium-Index")
        return Sourced(rows[-1], self.source_id, self.clock(), rows[-1].ts, "intraday")

    def funding_history(self, symbol, limit):
        rows = [f for f in self.ds.funding.get(symbol, []) if f.ts <= self.clock()]  # erst ab Abrechnung bekannt
        if not rows:
            raise NotConfiguredError(self.source_id, "Replay: keine Funding-Daten")
        return Sourced(rows[-limit:], self.source_id, self.clock(), rows[-1].ts, "event")

    def open_interest_history(self, symbol, period, limit):
        rows = [p for p in self.ds.open_interest.get(symbol, []) if p.ts + timedelta(minutes=5) <= self.clock()]
        if not rows:
            raise NotConfiguredError(self.source_id, "Replay: kein Open Interest")
        return Sourced(rows[-limit:], self.source_id, self.clock(), rows[-1].ts, "intraday")


class ReplayEquity:
    source_id = "stooq"

    def __init__(self, ds: HistoricalDataset, clock: Clock):
        self.ds, self.clock = ds, clock

    def bars(self, symbol: str, timeframe: str, start: date | None = None) -> Sourced[list[Bar]]:
        if timeframe != "1d":
            raise ProviderError(self.source_id, "invalid", "nur Tageskurse")
        s = self.ds.equity_daily.get(symbol)
        if s is None:
            raise ProviderError(self.source_id, "not_found", f"Replay: keine Tageskurse fuer {symbol}")
        now = self.clock()
        ny_today = now.astimezone(NEW_YORK)
        # Tageskerze D ist ab 18:00 New York am Tag D bekannt
        last_known = ny_today.date() if ny_today.time() >= EQUITY_EOD_AVAILABLE else ny_today.date() - timedelta(days=1)
        lo = datetime.combine(start, time(0), tzinfo=timezone.utc) if start else s.bars[0].ts if s.bars else now
        hi = datetime.combine(last_known + timedelta(days=1), time(0), tzinfo=timezone.utc)
        bars = s.between(lo, hi)
        if not bars:
            raise ProviderError(self.source_id, "not_found", f"Replay: noch keine Tageskurse fuer {symbol}")
        return Sourced(bars, self.source_id, now, bars[-1].ts, "end_of_day")


def replay_providers(ds: HistoricalDataset, clock: Clock) -> Providers:
    nc = NotConfiguredProvider
    return Providers(market=ReplayEquity(ds, clock), crypto=ReplayCrypto(ds, clock),
                     fundamentals=nc("sec", "Replay"), insider=nc("sec", "Replay"), institutional=nc("sec", "Replay"),
                     options=nc("options", "Replay"), macro=nc("fred", "Replay"), onchain=nc("defillama", "Replay"),
                     news=nc("news", "Replay"), crypto_fallbacks=[])
