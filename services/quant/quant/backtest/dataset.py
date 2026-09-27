"""
Historischer Datensatz fuer den Replay. Quellen:
  * eigene Aufzeichnung (Live-Datenbank: bars/observations) - exakt das, was der Bot gesehen haette
  * Binance-Kline-CSV (data.binance.vision, Spalten wie REST /klines)
  * Tageskurse-CSV (Date,Open,High,Low,Close,Volume)
Alle Reihen werden nach Zeit sortiert und fuer schnelle Zeitabfragen indiziert.
"""

from __future__ import annotations

import bisect
import csv
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from ..providers.base import Bar, FundingRate, OpenInterestPoint, PremiumIndex

TF_LEN = {"1m": timedelta(minutes=1), "5m": timedelta(minutes=5), "15m": timedelta(minutes=15), "1h": timedelta(hours=1),
          "4h": timedelta(hours=4), "1d": timedelta(days=1)}


@dataclass
class Series:
    """Zeitlich sortierte Balken mit Index auf ts."""
    bars: list[Bar]
    _ts: list[datetime] = field(default_factory=list, repr=False)

    def __post_init__(self) -> None:
        self.bars = sorted(self.bars, key=lambda b: b.ts)
        self._ts = [b.ts for b in self.bars]

    def between(self, start: datetime, end: datetime) -> list[Bar]:
        return self.bars[bisect.bisect_left(self._ts, start):bisect.bisect_left(self._ts, end)]


@dataclass
class HistoricalDataset:
    spot: dict[str, dict[str, Series]] = field(default_factory=dict)        # symbol -> timeframe -> Series
    perp: dict[str, dict[str, Series]] = field(default_factory=dict)
    funding: dict[str, list[FundingRate]] = field(default_factory=dict)
    open_interest: dict[str, list[OpenInterestPoint]] = field(default_factory=dict)
    premium: dict[str, list[PremiumIndex]] = field(default_factory=dict)
    equity_daily: dict[str, Series] = field(default_factory=dict)
    # Herkunft je Reihe (fuer Report und Audit)
    provenance: dict[str, str] = field(default_factory=dict)

    def add_spot(self, symbol: str, tf: str, bars: list[Bar], origin: str) -> None:
        self.spot.setdefault(symbol, {})[tf] = Series(bars)
        self.provenance[f"spot:{symbol}:{tf}"] = origin

    def add_perp(self, symbol: str, tf: str, bars: list[Bar], origin: str) -> None:
        self.perp.setdefault(symbol, {})[tf] = Series(bars)
        self.provenance[f"perp:{symbol}:{tf}"] = origin

    def add_equity(self, ticker: str, bars: list[Bar], origin: str) -> None:
        self.equity_daily[ticker] = Series(bars)
        self.provenance[f"equity:{ticker}:1d"] = origin

    def span(self) -> tuple[datetime | None, datetime | None]:
        firsts, lasts = [], []
        for by_tf in self.spot.values():
            for s in by_tf.values():
                if s.bars:
                    firsts.append(s.bars[0].ts)
                    lasts.append(s.bars[-1].ts)
        for s in self.equity_daily.values():
            if s.bars:
                firsts.append(s.bars[0].ts)
                lasts.append(s.bars[-1].ts)
        return (min(firsts) if firsts else None, max(lasts) if lasts else None)


def read_binance_klines_csv(path: str | Path, tf: str) -> list[Bar]:
    """data.binance.vision-Format: openTime,open,high,low,close,volume,closeTime,quoteVolume,trades,takerBuyBase,takerBuyQuote,ignore."""
    out = []
    with open(path, newline="") as fh:
        for row in csv.reader(fh):
            if not row or not row[0].strip().isdigit():
                continue  # Kopfzeile
            ot = int(row[0])
            ot = ot // 1000 if ot > 10**14 else ot  # neuere Dateien in Mikrosekunden
            out.append(Bar(ts=datetime.fromtimestamp(ot / 1000, tz=timezone.utc), open=float(row[1]), high=float(row[2]),
                           low=float(row[3]), close=float(row[4]), volume=float(row[5]), quote_volume=float(row[7]),
                           trade_count=int(row[8]), taker_buy_volume=float(row[9]), is_final=True))
    return out


def read_daily_csv(path: str | Path) -> list[Bar]:
    out = []
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            d = date.fromisoformat(row["Date"])
            out.append(Bar(ts=datetime.combine(d, time(0), tzinfo=timezone.utc), open=float(row["Open"]), high=float(row["High"]),
                           low=float(row["Low"]), close=float(row["Close"]), volume=float(row.get("Volume") or 0), is_final=True))
    return out


def from_database(conn, *, crypto_symbols: list[str], equity_tickers: list[str], start: datetime, end: datetime) -> HistoricalDataset:
    """
    Replay der EIGENEN Aufzeichnung. Die Balken werden mit ihren Zeitstempeln uebernommen; der Replay-Adapter
    gibt sie erst frei, wenn sie zur Simulationszeit abgeschlossen waren.
    """
    from ..repo import load_bars, resolve
    ds = HistoricalDataset()
    for sym in crypto_symbols:
        spot = resolve(conn, "exchange_symbol", sym, "binance")
        perp = resolve(conn, "exchange_symbol", f"{sym}:PERP", "binance")
        if spot:
            ds.add_spot(sym, "1m", load_bars(conn, spot, "1m", start, end, known_at=end), "db")
            ds.add_spot(sym, "1d", load_bars(conn, spot, "1d", start - timedelta(days=420), end, known_at=end), "db")
        if perp:
            ds.add_perp(sym, "1m", load_bars(conn, perp, "1m", start, end, known_at=end), "db")
            rows = conn.execute("""SELECT DISTINCT ON (event_time) event_time, value, value_json FROM observations
                                   WHERE series_key='funding_rate' AND instrument_id=%s ORDER BY event_time, revision DESC""", (perp,)).fetchall()
            ds.funding[sym] = [FundingRate(r["event_time"], r["value"], (r["value_json"] or {}).get("interval_hours", 8.0)) for r in rows]
            rows = conn.execute("""SELECT DISTINCT ON (event_time) event_time, value, value_json FROM observations
                                   WHERE series_key='open_interest' AND instrument_id=%s ORDER BY event_time, revision DESC""", (perp,)).fetchall()
            ds.open_interest[sym] = [OpenInterestPoint(r["event_time"], r["value"], (r["value_json"] or {}).get("notional")) for r in rows]
    for t in equity_tickers:
        iid = resolve(conn, "ticker", t, "US")
        if iid:
            ds.add_equity(t, load_bars(conn, iid, "1d", start - timedelta(days=800), end, known_at=end), "db")
    return ds
