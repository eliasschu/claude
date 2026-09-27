"""Verdrahtung Schnittstelle -> Implementierung. Einziger Ort, der Anbieter kennt."""

from __future__ import annotations

from dataclasses import dataclass, field

from .base import (
    CryptoMarketProvider,
    FundamentalProvider,
    InsiderProvider,
    InstitutionalProvider,
    MacroProvider,
    MarketDataProvider,
    NewsProvider,
    NotConfiguredProvider,
    OnChainProvider,
    OptionsProvider,
)
from .binance import BinanceProvider
from .coinbase import CoinbaseProvider
from .stooq import StooqProvider


@dataclass
class Providers:
    market: MarketDataProvider
    crypto: CryptoMarketProvider
    fundamentals: FundamentalProvider
    insider: InsiderProvider
    institutional: InstitutionalProvider
    options: OptionsProvider
    macro: MacroProvider
    onchain: OnChainProvider
    news: NewsProvider
    # Ersatzquellen fuer Spot-Daten (Kurse, Quote, Orderbuch), in dieser Reihenfolge
    crypto_fallbacks: list = field(default_factory=list)


def _fred():
    import os

    from .fred import FredProvider
    key = os.environ.get("FRED_API_KEY")
    return FredProvider(key) if key else NotConfiguredProvider("fred", "FRED/ALFRED (FRED_API_KEY fehlt)")


def default_providers() -> Providers:
    return Providers(
        market=StooqProvider(),
        crypto=BinanceProvider(),
        # Die SEC-Auswertung (Form 4, 13F, XBRL) existiert bereits im Next.js-Teil
        # (src/lib/sources). Portierung in Phase 5; bis dahin ehrlich "nicht angebunden".
        fundamentals=NotConfiguredProvider("sec", "SEC-Fundamentaldaten im Bot"),
        insider=NotConfiguredProvider("sec", "SEC Form 4 im Bot"),
        institutional=NotConfiguredProvider("sec", "SEC 13F im Bot"),
        options=NotConfiguredProvider("options", "Optionsdaten (OPRA, lizenzpflichtig)"),
        macro=_fred(),
        onchain=NotConfiguredProvider("defillama", "On-Chain-Daten"),
        news=NotConfiguredProvider("news", "Nachrichtenfeed"),
        crypto_fallbacks=[CoinbaseProvider()],
    )
