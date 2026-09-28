"""Konfiguration ausschliesslich aus Umgebungsvariablen (12-Factor, Docker-tauglich)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


@dataclass(frozen=True)
class Settings:
    database_url: str
    redis_url: str | None
    # Rechtlicher Entwicklungsmodus: nur 'research' oder 'paper'. 'live' ist gesperrt.
    mode: str
    crypto_cycle_seconds: int
    paper_account_id: str
    paper_starting_cash: float
    sec_user_agent: str | None
    crypto_symbols: tuple[str, ...] = field(default_factory=tuple)
    equity_symbols: tuple[str, ...] = field(default_factory=tuple)
    # Safe Production Test Mode: echte Marktdaten, echte Zyklen, KEINE echten Orders
    live_data: bool = True
    live_trading: bool = False
    # Shadow: jede Handelsidee (auch abgelehnte) mit geplanter Order und hypothetischer Ausfuehrung protokollieren
    shadow_execution: bool = True
    fred_api_key: str | None = None
    sec_13f_managers: tuple[str, ...] = field(default_factory=tuple)
    # Unternehmen, deren SEC-Insidermeldungen der Bot beobachtet. Muss mit der Website uebereinstimmen
    # (src/config/movers.ts, STOCK_MOVER_UNIVERSE) - ein Test prueft das.
    insider_watchlist: tuple[str, ...] = field(default_factory=tuple)


ALLOWED_MODES = ("research", "paper")
DEFAULT_INSIDER_WATCHLIST = "AAPL,MSFT,NVDA,GOOGL,AMZN,META,TSLA,JPM"
# Welche Ereignisarten der Bot je Unternehmen der Beobachtungsliste tatsaechlich ueberwacht.
MONITORED_EVENT_TYPES = ("sec_form4_insider",)
_TRUE = {"1", "true", "yes", "on"}


def _flag(name: str, default: bool) -> bool:
    raw = _env(name)
    return default if raw is None else raw.lower() in _TRUE


def load_settings() -> Settings:
    mode = _env("BOT_MODE", "paper")
    if mode not in ALLOWED_MODES:
        raise RuntimeError(
            f"BOT_MODE={mode!r} ist nicht erlaubt. Bis zur rechtlichen Pruefung laeuft das System nur als research oder paper."
        )
    if _flag("LIVE_TRADING", False):
        raise RuntimeError(
            "LIVE_TRADING=true ist gesperrt. Es gibt keinen Codepfad zu echten Orders; der Betrieb bleibt "
            "Research/Paper/Shadow bis zur rechtlichen Pruefung."
        )
    return Settings(
        database_url=_env_str("DATABASE_URL", "postgresql://quant:quant@localhost:5432/quant"),
        redis_url=_env("REDIS_URL"),
        mode=mode,
        crypto_cycle_seconds=int(_env_str("CRYPTO_CYCLE_SECONDS", "60")),
        paper_account_id=_env_str("PAPER_ACCOUNT_ID", "paper-main"),
        paper_starting_cash=float(_env_str("PAPER_STARTING_CASH", "100000")),
        sec_user_agent=_env("SEC_EDGAR_USER_AGENT"),
        crypto_symbols=tuple((_env("CRYPTO_SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT") or "").split(",")),
        equity_symbols=tuple((_env("EQUITY_SYMBOLS", "SPY,QQQ,AAPL,MSFT,NVDA,AMZN,META,GOOGL,TSLA,AMD") or "").split(",")),
        live_data=_flag("LIVE_DATA", True),
        live_trading=False,
        shadow_execution=_flag("SHADOW_EXECUTION", True),
        fred_api_key=_env("FRED_API_KEY"),
        # Standard: Berkshire, Bridgewater, Renaissance, Pershing Square, Appaloosa (CIKs wie in src/config/whales.ts)
        sec_13f_managers=tuple((_env("SEC_13F_MANAGERS", "1067983,1350694,1037389,1336528,1006438") or "").split(",")),
        insider_watchlist=tuple(t.strip().upper() for t in (_env("INSIDER_WATCHLIST", DEFAULT_INSIDER_WATCHLIST) or "").split(",") if t.strip()),
    )
