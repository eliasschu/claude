"""Verdrahtung Schnittstelle -> Implementierung. Einziger Ort, der Anbieter kennt."""

from __future__ import annotations

from dataclasses import dataclass

from .base import (
    CryptoMarketProvider, FundamentalProvider, InsiderProvider, InstitutionalProvider, MacroProvider,
    MarketDataProvider, NewsProvider, NotConfiguredProvider, OnChainProvider, OptionsProvider,
)
from .binance import BinanceProvider
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
        macro=NotConfiguredProvider("fred", "FRED/ALFRED"),
        onchain=NotConfiguredProvider("defillama", "On-Chain-Daten"),
        news=NotConfiguredProvider("news", "Nachrichtenfeed"),
    )
