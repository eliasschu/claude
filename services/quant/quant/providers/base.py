"""
Provider-Schnittstellen (§74). Bot, Feature Engine und API sprechen nur mit
diesen Protokollen - nie mit einem konkreten Anbieter. Ein professioneller
Feed ersetzt spaeter eine Implementierung, ohne dass Bot oder UI sich aendern.

Jede Antwort reist als `Sourced[T]` mit Quelle und den getrennten Zeitpunkten
(Datenzeitpunkt vs. Abrufzeitpunkt).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Generic, Literal, Protocol, TypeVar, runtime_checkable

T = TypeVar("T")

Timeframe = Literal["1m", "5m", "15m", "1h", "4h", "1d", "1w"]


class ProviderError(Exception):
    """Fehler einer Quelle mit maschinenlesbarem Grund."""

    def __init__(self, source_id: str, reason: str, message: str):
        super().__init__(message)
        self.source_id = source_id
        self.reason = reason  # not_configured | unavailable | rate_limited | not_found | invalid


class NotConfiguredError(ProviderError):
    def __init__(self, source_id: str, message: str):
        super().__init__(source_id, "not_configured", message)


@dataclass(frozen=True)
class Sourced(Generic[T]):
    data: T
    source_id: str
    fetched_at: datetime
    # Zeitpunkt des juengsten enthaltenen Werts laut Quelle (nicht der Abruf)
    observed_at: datetime | None
    cadence: str  # stream | intraday | end_of_day | daily | weekly | quarterly | annual | event
    note: str | None = None


# ---------------------------------------------------------------------------
# Marktdaten
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Bar:
    ts: datetime  # Beginn des Balkens, UTC
    open: float
    high: float
    low: float
    close: float
    volume: float
    is_final: bool
    quote_volume: float | None = None
    trade_count: int | None = None
    taker_buy_volume: float | None = None


@dataclass(frozen=True)
class Quote:
    bid: float
    ask: float
    bid_size: float | None
    ask_size: float | None
    ts: datetime | None

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2

    @property
    def spread_bps(self) -> float:
        return (self.ask - self.bid) / self.mid * 10_000


@dataclass(frozen=True)
class OrderBook:
    bids: Sequence[tuple[float, float]]  # (Preis, Menge), bester zuerst
    asks: Sequence[tuple[float, float]]
    ts: datetime | None


@dataclass(frozen=True)
class Trade:
    ts: datetime
    price: float
    size: float
    # Seite des Aggressors: 'buy' = Kaeufer hat die Ask genommen
    aggressor: Literal["buy", "sell"] | None


@dataclass(frozen=True)
class FundingRate:
    ts: datetime
    rate: float  # je Funding-Intervall, als Dezimalzahl
    interval_hours: float
    mark_price: float | None = None


@dataclass(frozen=True)
class OpenInterestPoint:
    ts: datetime
    contracts: float
    notional: float | None


@dataclass(frozen=True)
class PremiumIndex:
    ts: datetime
    mark_price: float
    index_price: float
    last_funding_rate: float
    next_funding_time: datetime | None


@runtime_checkable
class MarketDataProvider(Protocol):
    """Aktien/ETF-Kurse. Im MVP nur Tageskerzen (EOD) - keine Schein-Echtzeit."""

    source_id: str

    def bars(self, symbol: str, timeframe: Timeframe, start: date | None = None) -> Sourced[list[Bar]]: ...


@runtime_checkable
class CryptoMarketProvider(Protocol):
    source_id: str

    def spot_bars(self, symbol: str, timeframe: Timeframe, limit: int, start: datetime | None = None) -> Sourced[list[Bar]]: ...
    def spot_quote(self, symbol: str) -> Sourced[Quote]: ...
    def spot_order_book(self, symbol: str, depth: int) -> Sourced[OrderBook]: ...
    def perp_bars(self, symbol: str, timeframe: Timeframe, limit: int, start: datetime | None = None) -> Sourced[list[Bar]]: ...
    def premium_index(self, symbol: str) -> Sourced[PremiumIndex]: ...
    def funding_history(self, symbol: str, limit: int) -> Sourced[list[FundingRate]]: ...
    def open_interest_history(self, symbol: str, period: str, limit: int) -> Sourced[list[OpenInterestPoint]]: ...


# ---------------------------------------------------------------------------
# Filings, Fundamentaldaten, Makro, Nachrichten, Optionen, On-Chain
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class InsiderTransaction:
    accession: str
    issuer_cik: int
    owner_name: str
    roles: tuple[str, ...]
    transaction_date: date | None
    filing_date: date
    code: str  # P, S, A, M, F, G, ...
    shares: float | None
    price: float | None
    acquired: bool | None
    shares_after: float | None
    plan_10b5_1: bool | None


@dataclass(frozen=True)
class InstitutionalHolding:
    manager_cik: int
    cusip: str
    issuer_name: str
    value_usd: float
    shares: float | None
    report_date: date
    filing_date: date


@dataclass(frozen=True)
class FundamentalFact:
    cik: int
    concept: str
    period_start: date | None
    period_end: date
    value: float
    unit: str
    form: str
    filed: date  # Point-in-Time: ab diesem Tag bekannt


@dataclass(frozen=True)
class MacroRelease:
    series_id: str
    period: date
    value: float
    # Veroeffentlichungsdatum dieser Fassung (Vintage) - Pflicht fuer Backtests (§27)
    realtime_start: date
    consensus: float | None = None
    previous: float | None = None


@dataclass(frozen=True)
class NewsItem:
    id: str
    title: str
    url: str
    published_at: datetime | None
    source_name: str
    kind: Literal["official", "company", "news", "opinion", "rumor"]
    instrument_ids: tuple[str, ...] = field(default_factory=tuple)


@runtime_checkable
class FundamentalProvider(Protocol):
    source_id: str

    def facts(self, cik: int, concepts: Sequence[str]) -> Sourced[list[FundamentalFact]]: ...


@runtime_checkable
class InsiderProvider(Protocol):
    source_id: str

    def transactions(self, cik: int, since: date) -> Sourced[list[InsiderTransaction]]: ...


@runtime_checkable
class InstitutionalProvider(Protocol):
    source_id: str

    def holdings(self, manager_cik: int) -> Sourced[list[InstitutionalHolding]]: ...


@runtime_checkable
class MacroProvider(Protocol):
    source_id: str

    def releases(self, series_id: str, since: date) -> Sourced[list[MacroRelease]]: ...


@runtime_checkable
class NewsProvider(Protocol):
    source_id: str

    def latest(self, limit: int) -> Sourced[list[NewsItem]]: ...


@runtime_checkable
class OptionsProvider(Protocol):
    """Im MVP ohne Implementierung (OPRA ist lizenzpflichtig)."""

    source_id: str

    def chain(self, underlying: str, as_of: date) -> Sourced[list[dict]]: ...


@runtime_checkable
class OnChainProvider(Protocol):
    source_id: str

    def metric(self, asset: str, metric: str, since: date) -> Sourced[list[tuple[datetime, float]]]: ...


class NotConfiguredProvider:
    """Platzhalter: sagt ehrlich, dass eine Datenart (noch) nicht angebunden ist."""

    def __init__(self, source_id: str, what: str):
        self.source_id = source_id
        self._what = what

    def __getattr__(self, name: str):
        def _fail(*_args, **_kwargs):
            raise NotConfiguredError(self.source_id, f"{self._what} ist nicht angebunden.")

        return _fail
