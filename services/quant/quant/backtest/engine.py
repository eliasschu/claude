"""
Backtest-Engine: spielt einen historischen Datensatz ueber die Simulationsuhr ab und laesst
den UNVERAENDERTEN BotOrchestrator darauf laufen - dieselben Features, Strategien, Signal Gate,
Risk Engine, Positionsgroessen, Ausfuehrungsmodell und Audit-Protokolle wie live.

Jeder Lauf bekommt eine eigene Datenbank (gleiches Schema). Damit ist jeder Backtest-Trade
spaeter genauso erklaerbar wie ein Live-Paper-Trade (siehe explain.py).
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Jsonb

from .. import BOT_VERSION
from ..db import connect, migrate
from ..domain import FEATURE_VERSION
from ..execution import REALISTIC, ExecutionModel
from ..orchestrator import BotOrchestrator
from ..outcomes import resolve_outcomes
from ..repo import resolve
from ..risk import RISK_VERSION, RiskEngine
from ..shadow import resolve_shadows
from ..strategies import StrategyRegistry
from .dataset import HistoricalDataset
from .replay import replay_providers

NEW_YORK = ZoneInfo("America/New_York")
EQUITY_RUN_AT = time(18, 15)


class SimClock:
    def __init__(self, t: datetime):
        self.t = t

    def __call__(self) -> datetime:
        return self.t


@dataclass
class BacktestConfig:
    scope: str                                  # crypto | equity_us
    start: datetime
    end: datetime
    crypto_symbols: tuple[str, ...] = ("BTCUSDT",)
    equity_symbols: tuple[str, ...] = ()
    step: timedelta = timedelta(minutes=5)      # Krypto-Auswertungstakt (live: 1 min)
    execution: ExecutionModel = field(default_factory=lambda: REALISTIC)
    starting_cash: float = 100_000.0
    history_window: timedelta = timedelta(days=7)
    splits: tuple[float, float, float] = (0.6, 0.2, 0.2)  # Train / Validation / Out-of-Sample (zeitlich)
    benchmark: str | None = None                 # Standard: BTCUSDT (Krypto) bzw. SPY (Aktien)

    def describe(self) -> dict:
        d = asdict(self)
        d["execution"] = self.execution.describe()
        for k in ("start", "end"):
            d[k] = getattr(self, k).isoformat()
        d["step"] = self.step.total_seconds()
        d["history_window"] = self.history_window.total_seconds()
        d["benchmark"] = self.benchmark_symbol
        return d

    @property
    def benchmark_symbol(self) -> str:
        return self.benchmark or ("BTCUSDT" if self.scope == "crypto" else "SPY")


@dataclass
class BacktestResult:
    run_id: uuid.UUID
    database: str
    dsn: str
    report: dict


def _create_database(admin_url: str, name: str) -> str:
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f'CREATE DATABASE "{name}"')
    return admin_url.rsplit("/", 1)[0] + f"/{name}"


def equity_run_times(start: datetime, end: datetime) -> list[datetime]:
    """Ein Aktien-Zyklus je US-Wochentag um 18:15 New York (nach EOD-Verfuegbarkeit, wie der Live-Scheduler)."""
    out = []
    d = start.astimezone(NEW_YORK).date()
    while True:
        t = datetime.combine(d, EQUITY_RUN_AT, tzinfo=NEW_YORK).astimezone(timezone.utc)
        if t > end:
            break
        if t >= start and d.weekday() < 5:
            out.append(t)
        d += timedelta(days=1)
    return out


class Backtest:
    def __init__(self, dataset: HistoricalDataset, config: BacktestConfig, *, registry: StrategyRegistry | None = None,
                 risk: RiskEngine | None = None):
        self.ds, self.cfg = dataset, config
        self.registry = registry or StrategyRegistry()
        self.risk = risk or RiskEngine()

    def run(self, admin_url: str, *, keep_database: bool = True) -> BacktestResult:
        from .report import build_report

        run_id = uuid.uuid4()
        name = f"bt_{self.cfg.start:%Y%m%d}_{run_id.hex[:10]}"
        dsn = _create_database(admin_url, name)
        conn = connect(dsn)
        try:
            migrate(conn)
            conn.execute(
                """INSERT INTO backtest_runs (run_id, created_at, status, config, dataset, bot_version, registry_version, feature_version,
                                              risk_version) VALUES (%s, now(), 'running', %s, %s, %s, %s, %s, %s)""",
                (run_id, Jsonb(self.cfg.describe()), Jsonb({"provenance": self.ds.provenance}), BOT_VERSION, self.registry.version,
                 FEATURE_VERSION, RISK_VERSION))
            conn.commit()
            clock = SimClock(self.cfg.start)
            bot = BotOrchestrator(conn, replay_providers(self.ds, clock), mode="backtest", account_id="backtest",
                                  starting_cash=self.cfg.starting_cash, crypto_symbols=self.cfg.crypto_symbols,
                                  equity_symbols=self.cfg.equity_symbols, registry=self.registry, risk=self.risk, clock=clock,
                                  execution=self.cfg.execution, history_window=self.cfg.history_window,
                                  benchmark_crypto=self.cfg.crypto_symbols[0] if self.cfg.crypto_symbols else "BTCUSDT")
            times = self._times()
            for t in times:
                clock.t = t
                if self.cfg.scope == "crypto":
                    bot.run_crypto_cycle()
                else:
                    bot.run_equity_cycle()
            clock.t = self.cfg.end
            bench = {"crypto": resolve(conn, "exchange_symbol", self.cfg.benchmark_symbol, "binance"),
                     "equity": resolve(conn, "ticker", self.cfg.benchmark_symbol, "US")}
            resolve_outcomes(conn, self.cfg.end, bench)
            resolve_shadows(conn, self.cfg.end)
            conn.commit()
            report = build_report(conn, self.cfg, cycles=len(times))
            conn.execute("UPDATE backtest_runs SET status='completed', finished_at=now(), report=%s WHERE run_id=%s",
                         (Jsonb(report, dumps=_dumps), run_id))
            conn.commit()
            return BacktestResult(run_id, name, dsn, report)
        except Exception as exc:
            conn.rollback()
            conn.execute("UPDATE backtest_runs SET status='failed', finished_at=now(), error=%s WHERE run_id=%s", (str(exc)[:1000], run_id))
            conn.commit()
            raise
        finally:
            conn.close()
            if not keep_database:
                with psycopg.connect(admin_url, autocommit=True) as admin:
                    admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')

    def _times(self) -> list[datetime]:
        if self.cfg.scope == "equity_us":
            return equity_run_times(self.cfg.start, self.cfg.end)
        out, t = [], self.cfg.start
        while t <= self.cfg.end:
            out.append(t)
            t += self.cfg.step
        return out


def _dumps(obj) -> str:
    import json
    return json.dumps(obj, default=str)
