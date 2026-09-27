"""
BotOrchestrator: fuehrt einen Bot-Zyklus in fester Reihenfolge aus.

    DATA -> NORMALIZATION -> DATA QUALITY -> FEATURES -> MARKET REGIME
         -> STRATEGY SIGNALS -> SIGNAL STRENGTH -> RISK ENGINE -> PAPER DECISION -> AUDIT LOG

Jeder Schritt schreibt nachvollziehbare Ereignisse (bot_events). Ein Fehler
bei einem Instrument stoppt nie den ganzen Zyklus; ein Ausfall von Kerndaten
aktiviert den Kill Switch (keine neuen Orders, Exits laufen weiter).
"""

from __future__ import annotations

import threading
import time as _time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from typing import Callable
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Jsonb

from . import BOT_VERSION
from .audit import SignalAuditService, SignalContext
from .domain import Decision, FeatureSet, RegimeState, StrategyEvaluation
from .events import BotEventLog
from .metrics import METRICS, Metrics
from .features import CryptoInputs, EquityInputs, crypto_features, equity_close_time, equity_features
from .freshness import assess
from .health import KillSwitchLimits, ProviderHealthService, kill_switch_reason
from .paper import COSTS, DuplicateEntryError, PaperPortfolio, check_exit, crypto_market_fill, equity_open_fill, exit_fill, session_open
from .providers.base import Bar, FundingRate, OpenInterestPoint, OrderBook, PremiumIndex, ProviderError, Quote
from .providers.registry import Providers
from .quality import validate_bars
from .regime import crypto_regime, equity_regime
from .repo import load_bars, observations_as_of, record_observation, upsert_bars
from .risk import RiskEngine, final_decision
from .strategies import StrategyRegistry, run_signal_engine
from .universe import ETFS, crypto_instrument, equity_instrument, parse_pair

NEW_YORK = ZoneInfo("America/New_York")
CRYPTO_BACKFILL = timedelta(days=7)
# Ein Kandidat wird nicht jede Minute neu protokolliert, sondern bei Aenderung oder nach Ablauf dieser Frist.
REPEAT_AFTER = {"intraday": timedelta(hours=1), "swing": timedelta(days=1), "position": timedelta(days=5)}
STRENGTH_CHANGE = 10.0
# Teilausfuehrung: mindestens die Haelfte muss das Buch tragen; der Rest bleibt 5 Minuten aktiv
MIN_FILL_RATIO = 0.5
PARTIAL_TIME_IN_FORCE = timedelta(minutes=5)

Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class CycleReport:
    cycle_id: uuid.UUID
    scope: str
    counts: dict[str, int] = field(default_factory=dict)
    kill_switch: str | None = None
    errors: list[str] = field(default_factory=list)
    # Circuit Breaker: Quelle ist in diesem Zyklus ausgefallen -> keine weiteren Abrufe
    down_sources: set[str] = field(default_factory=set)
    fallbacks: set[str] = field(default_factory=set)
    calls: list = field(default_factory=list)

    def bump(self, key: str, n: int = 1) -> None:
        self.counts[key] = self.counts.get(key, 0) + n


@dataclass
class _CryptoLive:
    quote: Quote | None = None
    quote_at: datetime | None = None
    book: OrderBook | None = None
    premium: PremiumIndex | None = None
    sources: set[str] = field(default_factory=set)


@dataclass
class _Bundle:
    spot_pages: list = field(default_factory=list)
    perp: object | None = None
    daily: object | None = None
    quote: object | None = None
    book: object | None = None
    premium: object | None = None
    funding: object | None = None
    oi: object | None = None


@dataclass(frozen=True)
class _Call:
    source_id: str
    what: str
    instrument_id: str | None
    result: object | None
    latency_ms: float
    error: ProviderError | None


class BotOrchestrator:
    def __init__(self, conn: psycopg.Connection, providers: Providers, *, mode: str, account_id: str, starting_cash: float,
                 crypto_symbols: tuple[str, ...], equity_symbols: tuple[str, ...], registry: StrategyRegistry | None = None,
                 risk: RiskEngine | None = None, events: BotEventLog | None = None, clock: Clock = utc_now,
                 kill_limits: KillSwitchLimits = KillSwitchLimits(), benchmark_equity: str = "SPY", benchmark_crypto: str = "BTCUSDT"):
        if mode not in ("research", "paper"):
            raise ValueError("Nur research oder paper - Live-Handel ist gesperrt")
        self.conn = conn
        self.p = providers
        self.mode = mode
        self.registry = registry or StrategyRegistry()
        self.risk = risk or RiskEngine()
        self.events = events or BotEventLog(conn)
        self.health = ProviderHealthService(conn)
        self.audit = SignalAuditService(conn)
        self.clock = clock
        self.kill_limits = kill_limits
        self.crypto_symbols = tuple(s for s in crypto_symbols if s)
        self.equity_symbols = tuple(s for s in equity_symbols if s)
        self.benchmark_equity = benchmark_equity
        self.benchmark_crypto = benchmark_crypto
        self.portfolio = PaperPortfolio(conn, account_id, "USD", starting_cash)
        self.starting_cash = starting_cash
        self.metrics: Metrics = METRICS
        self._rep_lock = threading.Lock()
        self._lkg: dict[tuple[str, str], object] = {}
        conn.commit()

    # ------------------------------------------------------------------ Zyklus
    def _run(self, scope: str, body, universe: int) -> CycleReport | None:
        """
        Ein Zyklus je Scope gleichzeitig - auch bei mehreren Worker-Instanzen. Die Sperre ist
        sitzungsgebunden (pg_try_advisory_lock) und faellt beim Verbindungsabbruch automatisch.
        Wer sie nicht bekommt, ueberspringt den Takt statt doppelte Signale zu erzeugen.
        """
        key = f"cycle:{self.mode}:{scope}"
        got = self.conn.execute("SELECT pg_try_advisory_lock(hashtext(%s)) AS ok", (key,)).fetchone()["ok"]
        self.conn.commit()
        if not got:
            return None
        try:
            rep = self._start(scope)
            try:
                body(rep)
                self._finish(rep, "halted" if rep.kill_switch else "completed", universe)
            except Exception as exc:  # Zyklus scheitert sichtbar, der Worker laeuft weiter
                self.conn.rollback()
                self._finish(rep, "failed", universe, error=f"{exc.__class__.__name__}: {exc}")
                raise
            return rep
        finally:
            if not self.conn.closed and not self.conn.broken:
                self.conn.rollback()
                self.conn.execute("SELECT pg_advisory_unlock(hashtext(%s))", (key,))
                self.conn.commit()

    def _start(self, scope: str) -> CycleReport:
        cid = uuid.uuid4()
        self.conn.execute(
            "INSERT INTO bot_cycles (cycle_id, scope, mode, started_at, status, bot_version) VALUES (%s,%s,%s,%s,'running',%s)",
            (cid, scope, self.mode, self.clock(), BOT_VERSION),
        )
        self.conn.commit()
        return CycleReport(cid, scope)

    def _finish(self, rep: CycleReport, status: str, universe: int, error: str | None = None) -> None:
        self.conn.execute(
            "UPDATE bot_cycles SET finished_at=%s, status=%s, universe_size=%s, counts=%s, error=%s WHERE cycle_id=%s",
            (self.clock(), status, universe, Jsonb(rep.counts), error, rep.cycle_id),
        )
        self.events.emit("cycle_finished", f"Zyklus {rep.scope} beendet ({status}): {rep.counts}", cycle_id=rep.cycle_id,
                         severity="info" if status == "completed" else "warning", payload={"counts": rep.counts, "kill_switch": rep.kill_switch})
        self.conn.commit()

    def _fetch(self, rep: CycleReport, provider, what: str, fn, instrument_id: str | None = None):
        """
        Thread-sicherer Abruf OHNE Datenbankzugriff. Circuit Breaker: Ist die Quelle in diesem Zyklus
        schon ausgefallen, wird nicht erneut gefragt. Das Ergebnis wird spaeter seriell protokolliert.
        """
        source_id = provider.source_id
        with self._rep_lock:
            if source_id in rep.down_sources:
                rep.bump("provider_calls_skipped")
                return None
        started = _time.monotonic()
        try:
            try:
                result = fn()
            except (ValueError, KeyError, TypeError, IndexError) as exc:
                # Kaputte Antwort / fehlendes Feld: wie ein Ausfall behandeln, nie den Zyklus abbrechen
                raise ProviderError(source_id, "invalid", f"Antwort unbrauchbar ({exc.__class__.__name__})") from exc
        except ProviderError as exc:
            with self._rep_lock:
                if exc.reason in ("unavailable", "rate_limited", "not_configured"):
                    rep.down_sources.add(source_id)
                rep.errors.append(f"{source_id}:{what}")
                rep.calls.append(_Call(source_id, what, instrument_id, None, (_time.monotonic() - started) * 1000, exc))
            self.metrics.inc("provider_failures_total", provider=source_id, reason=exc.reason)
            return None
        latency = (_time.monotonic() - started) * 1000
        with self._rep_lock:
            rep.calls.append(_Call(source_id, what, instrument_id, result, latency, None))
        self.metrics.inc("provider_requests_total", provider=source_id)
        self.metrics.observe("provider_latency_ms", latency, provider=source_id)
        return result

    def _flush_calls(self, rep: CycleReport) -> None:
        """Health-Messungen und Fehlerereignisse der Abrufe seriell in die Datenbank schreiben."""
        calls, rep.calls = rep.calls, []
        for c in calls:
            if c.error is not None:
                status = "not_configured" if c.error.reason == "not_configured" else "down"
                self.health.record(c.source_id, status, checked_at=self.clock(), message=f"{c.what}: {c.error}")
                self.events.emit("provider_error", f"{c.source_id}: {c.what} fehlgeschlagen - {c.error}", severity="warning",
                                 cycle_id=rep.cycle_id, instrument_id=c.instrument_id, payload={"reason": c.error.reason})
            else:
                self.health.record(c.source_id, "ok", checked_at=self.clock(), latency_ms=c.latency_ms,
                                   last_data_at=c.result.observed_at, source_time=c.result.fetched_at)

    def _provider_call(self, rep: CycleReport, source_id: str, what: str, fn, instrument_id: str | None = None):
        """Serieller Abruf mit sofortigem Protokoll (Aktien-EOD, wenige Abrufe)."""
        provider = type("P", (), {"source_id": source_id})()
        result = self._fetch(rep, provider, what, fn, instrument_id)
        self._flush_calls(rep)
        return result

    def _store_bars(self, rep: CycleReport, instrument_id: str, source_id: str, timeframe: str, bars: list[Bar],
                    adjustment: str = "raw") -> int:
        """NORMALIZATION + DATA QUALITY vor jeder Speicherung."""
        good, bad = validate_bars(bars, self.clock())
        if bad:
            rep.bump("bars_rejected", len(bad))
            self.events.emit("data_quality", f"{len(bad)} Balken verworfen ({timeframe}): {bad[0].reason}", severity="warning",
                             cycle_id=rep.cycle_id, instrument_id=instrument_id,
                             payload={"rejected": [{"ts": r.ts.isoformat() if r.ts else None, "reason": r.reason} for r in bad[:20]]})
        # received_at = Bot-Uhr: so bleibt "was wusste der Bot wann" auch in Replays/Backtests konsistent
        n = upsert_bars(self.conn, instrument_id, source_id, timeframe, good, adjustment, received_at=self.clock())
        rep.bump("bars_stored", n)
        return n

    # ------------------------------------------------------------ Krypto
    def run_crypto_cycle(self) -> CycleReport | None:
        return self._run("crypto", self._crypto_cycle, len(self.crypto_symbols))

    def _crypto_ids(self, symbol: str) -> tuple[str, str]:
        pair = parse_pair(symbol)
        return crypto_instrument(self.conn, pair, "binance", "crypto_spot"), crypto_instrument(self.conn, pair, "binance", "crypto_perp")

    def _with_fallback(self, rep: CycleReport, what: str, call, instrument_id: str):
        """Erst Primaerquelle, dann Ersatzquellen (z. B. Coinbase, wenn Binance regional gesperrt oder gestoert ist)."""
        for provider in (self.p.crypto, *self.p.crypto_fallbacks):
            r = self._fetch(rep, provider, what, lambda p=provider: call(p), instrument_id)
            if r is not None:
                if provider is not self.p.crypto:
                    with self._rep_lock:
                        rep.fallbacks.add(f"{what}:{provider.source_id}")
                return r
        return None

    def _fetch_crypto(self, rep: CycleReport, symbol: str, spot_id: str, perp_id: str, last_spot_ts: datetime | None) -> _Bundle:
        """Alle Abrufe fuer ein Paar - ohne Datenbank, damit mehrere Paare parallel laufen koennen."""
        now = self.clock()
        crypto = self.p.crypto
        bundle = _Bundle()
        # Spot 1m: fehlende Historie seitenweise nachladen (max. 7 Tage)
        start = (last_spot_ts + timedelta(minutes=1)) if last_spot_ts else now - CRYPTO_BACKFILL
        for _ in range(12):
            r = self._with_fallback(rep, "spot_bars", lambda p, s=start: p.spot_bars(symbol, "1m", 1000, s), spot_id)
            if r is None or not r.data:
                break
            bundle.spot_pages.append(r)
            final = [b for b in r.data if b.is_final]
            if len(r.data) < 1000 or not final:
                break
            start = final[-1].ts + timedelta(minutes=1)
        bundle.perp = self._fetch(rep, crypto, "perp_bars", lambda: crypto.perp_bars(symbol, "1m", 240), perp_id)
        if symbol == self.benchmark_crypto:
            bundle.daily = self._with_fallback(rep, "spot_bars_1d", lambda p: p.spot_bars(symbol, "1d", 400), spot_id)
        bundle.quote = self._with_fallback(rep, "spot_quote", lambda p: p.spot_quote(symbol), spot_id)
        bundle.book = self._with_fallback(rep, "order_book", lambda p: p.spot_order_book(symbol, 100), spot_id)
        bundle.premium = self._fetch(rep, crypto, "premium_index", lambda: crypto.premium_index(symbol), perp_id)
        bundle.funding = self._fetch(rep, crypto, "funding_history", lambda: crypto.funding_history(symbol, 100), perp_id)
        bundle.oi = self._fetch(rep, crypto, "open_interest", lambda: crypto.open_interest_history(symbol, "5m", 30), perp_id)
        return bundle

    def _store_crypto(self, rep: CycleReport, symbol: str, spot_id: str, perp_id: str, bundle: _Bundle) -> _CryptoLive:
        now = self.clock()
        for page in bundle.spot_pages:
            self._store_bars(rep, spot_id, page.source_id, "1m", page.data)
        if bundle.perp:
            self._store_bars(rep, perp_id, bundle.perp.source_id, "1m", bundle.perp.data)
        if bundle.daily:
            self._store_bars(rep, spot_id, bundle.daily.source_id, "1d", bundle.daily.data)
        live = _CryptoLive(sources={p.source_id for p in bundle.spot_pages})
        q = bundle.quote or self._last_known_good(rep, symbol, "quote", spot_id)
        if q:
            self._lkg[(symbol, "quote")] = q
            live.quote, live.quote_at = q.data, q.observed_at
            live.sources.add(q.source_id)
            if bundle.quote:
                record_observation(self.conn, "spot_top_of_book", q.source_id, q.observed_at or now, q.data.mid, instrument_id=spot_id,
                                   value_json={"bid": q.data.bid, "ask": q.data.ask}, received_at=now)
        b = bundle.book or self._last_known_good(rep, symbol, "book", spot_id)
        if b:
            self._lkg[(symbol, "book")] = b
            live.book = b.data
        pi = bundle.premium
        if pi:
            live.premium = pi.data
            record_observation(self.conn, "perp_premium", pi.source_id, pi.data.ts, pi.data.mark_price, instrument_id=perp_id,
                               value_json={"index": pi.data.index_price, "last_funding_rate": pi.data.last_funding_rate}, received_at=now)
        if bundle.funding:
            for f in bundle.funding.data:
                record_observation(self.conn, "funding_rate", bundle.funding.source_id, f.ts, f.rate, instrument_id=perp_id,
                                   value_json={"interval_hours": f.interval_hours}, received_at=now, available_at=f.ts)
        if bundle.oi:
            for p in bundle.oi.data:
                # Der 5-Minuten-Wert ist erst nach Ende des Intervalls bekannt
                record_observation(self.conn, "open_interest", bundle.oi.source_id, p.ts, p.contracts, instrument_id=perp_id,
                                   value_json={"notional": p.notional}, received_at=now, available_at=p.ts + timedelta(minutes=5))
        self.conn.commit()
        return live

    def _last_known_good(self, rep: CycleReport, symbol: str, kind: str, instrument_id: str):
        """
        Letzter guter Stand, wenn alle Quellen ausfallen. Er behaelt seinen ALTEN Datenzeitpunkt - die
        Freshness-Regel der Datenklasse stuft ihn damit automatisch als veraltet ein, sobald er zu alt ist.
        """
        cached = self._lkg.get((symbol, kind))
        if cached is not None:
            rep.bump("last_known_good_used")
            self.events.emit("last_known_good", f"{symbol}: {kind} aus letztem guten Stand vom {cached.observed_at:%H:%M:%S} UTC",
                             severity="warning", cycle_id=rep.cycle_id, instrument_id=instrument_id)
        return cached

    def _crypto_features(self, spot_id: str, perp_id: str, live: _CryptoLive, as_of: datetime) -> FeatureSet:
        primary = self.p.crypto.source_id
        spot = load_bars(self.conn, spot_id, "1m", as_of - CRYPTO_BACKFILL, as_of, prefer_source=primary)
        perp = load_bars(self.conn, perp_id, "1m", as_of - timedelta(hours=4), as_of, prefer_source=primary)
        funding = [FundingRate(r["event_time"], r["value"], (r["value_json"] or {}).get("interval_hours", 8.0))
                   for r in observations_as_of(self.conn, "funding_rate", perp_id, as_of - timedelta(days=30), as_of)]
        oi = [OpenInterestPoint(r["event_time"], r["value"], (r["value_json"] or {}).get("notional"))
              for r in observations_as_of(self.conn, "open_interest", perp_id, as_of - timedelta(hours=3), as_of)]
        return crypto_features(CryptoInputs(spot_id, spot, perp, live.quote, live.quote_at, live.book, live.premium,
                                            funding, oi, "+".join(sorted(live.sources | {primary})), as_of))

    def _crypto_cycle(self, rep: CycleReport) -> None:
        self.events.emit("cycle_started", f"Krypto-Zyklus gestartet ({len(self.crypto_symbols)} Paare)", cycle_id=rep.cycle_id)
        ids = {sym: self._crypto_ids(sym) for sym in self.crypto_symbols}
        last_ts = {sym: self.conn.execute("SELECT max(ts) AS t FROM bars WHERE instrument_id=%s AND timeframe='1m'",
                                          (spot,)).fetchone()["t"] for sym, (spot, _perp) in ids.items()}
        self.conn.commit()
        # Abrufe je Paar parallel (I/O-gebunden); Datenbankschreiben danach seriell
        with ThreadPoolExecutor(max_workers=max(1, min(8, len(ids)))) as pool:
            futures = {sym: pool.submit(self._fetch_crypto, rep, sym, spot, perp, last_ts[sym]) for sym, (spot, perp) in ids.items()}
            bundles = {sym: f.result() for sym, f in futures.items()}
        self._flush_calls(rep)
        if rep.fallbacks:
            self.events.emit("provider_fallback", "Ersatzquelle verwendet: " + ", ".join(sorted(rep.fallbacks)), severity="warning",
                             cycle_id=rep.cycle_id)
        ingested: dict[str, tuple[str, str, _CryptoLive]] = {}
        for sym, (spot, perp) in ids.items():
            ingested[sym] = (spot, perp, self._store_crypto(rep, sym, spot, perp, bundles[sym]))
        as_of = self.clock()
        feats = {sym: self._crypto_features(s, p, live, as_of) for sym, (s, p, live) in ingested.items()}

        # Regime: BTC-Tagesbalken + BTC-Funding
        btc = ingested.get(self.benchmark_crypto)
        btc_daily = load_bars(self.conn, btc[0], "1d", as_of - timedelta(days=420), as_of) if btc else []
        btc_fs = feats.get(self.benchmark_crypto)
        fz = btc_fs.values["funding_rate_8h"].zscore if btc_fs and "funding_rate_8h" in btc_fs.values else None
        regime = crypto_regime(btc_daily, fz, as_of)
        self._store_regime(rep, regime)

        # Datenqualitaet / Kill Switch
        marks = {spot_id: feats[sym].values["close"].raw for sym, (spot_id, _p, _l) in ingested.items() if "close" in feats[sym].values}
        stale_core = []
        if not btc_fs or "close" not in btc_fs.values or btc_fs.values["close"].freshness in ("stale", "unknown"):
            stale_core.append(f"{self.benchmark_crypto} Spot")
        # Primaerquelle aus, Ersatzquelle liefert: DEGRADED, kein Kill Switch. Veraltete Kerndaten greifen trotzdem.
        replaced = any(f.startswith(("spot_quote:", "spot_bars:")) for f in rep.fallbacks)
        rep.kill_switch = self._kill_switch(rep, marks, stale_core, self.p.crypto.source_id, ignore_down=replaced)

        # Exits und ausstehende Orders zuerst (sie laufen auch bei aktivem Kill Switch)
        self._process_crypto_orders(rep, {s: live for s, _p, live in ingested.values()}, as_of)
        self._process_exits(rep, "crypto", as_of)

        for sym, fs in feats.items():
            spot_id = ingested[sym][0]
            snap = self._store_features(rep, fs)
            for ev in run_signal_engine(self.registry, "crypto", fs, regime):
                self._decide(rep, ev, fs, "crypto", regime, snap, price_basis="ask" if ev.direction == "long" else "bid",
                             marks=marks, instrument_id=spot_id)
        self.conn.commit()

    # ------------------------------------------------------------- Aktien
    def run_equity_cycle(self) -> CycleReport | None:
        return self._run("equity_us", self._equity_cycle, len(self.equity_symbols))

    def _final_equity_bars(self, bars: list[Bar], now: datetime) -> list[Bar]:
        """Heutiger Tagesbalken gilt erst ab 18:00 New York als endgueltig (EOD-Daten kommen verzoegert)."""
        ny = now.astimezone(NEW_YORK)
        cutoff_day = ny.date() if ny.time() >= time(18, 0) else ny.date() - timedelta(days=1)
        return [b for b in bars if b.ts.date() <= cutoff_day]

    def _equity_cycle(self, rep: CycleReport) -> None:
        self.events.emit("cycle_started", f"Aktien-Zyklus gestartet ({len(self.equity_symbols)} Werte, Tagesbasis)", cycle_id=rep.cycle_id)
        now = self.clock()
        ids: dict[str, str] = {}
        src = self.p.market.source_id
        tickers = list(dict.fromkeys([self.benchmark_equity, *self.equity_symbols]))
        for t in tickers:
            iid = equity_instrument(self.conn, t, is_etf=t in ETFS)
            ids[t] = iid
            last = self.conn.execute("SELECT max(ts) AS t FROM bars WHERE instrument_id=%s AND timeframe='1d'", (iid,)).fetchone()["t"]
            start = (last - timedelta(days=10)).date() if last else (now - timedelta(days=800)).date()
            r = self._provider_call(rep, src, "daily_bars", lambda t=t, s=start: self.p.market.bars(t, "1d", s), iid)
            if r:
                # Bereinigte Reihe (Splits/Dividenden) - wird bei Aenderung ersetzt
                self._store_bars(rep, iid, src, "1d", self._final_equity_bars(r.data, now), adjustment="split_dividend")
        self.conn.commit()
        as_of = self.clock()
        since = as_of - timedelta(days=800)
        daily = {t: load_bars(self.conn, iid, "1d", since, as_of - timedelta(days=0)) for t, iid in ids.items()}
        # Balken mit ts + 1 Tag <= as_of gelten als abgeschlossen (Features pruefen das erneut)
        bench = daily.get(self.benchmark_equity, [])
        regime = equity_regime(bench, {t: b for t, b in daily.items() if t != self.benchmark_equity}, as_of)
        self._store_regime(rep, regime)

        feats = {t: equity_features(EquityInputs(ids[t], daily[t], bench, src, as_of)) for t in self.equity_symbols}
        marks = {ids[t]: fs.values["close"].raw for t, fs in feats.items() if "close" in fs.values}
        bench_fresh = assess("candle_1d_equity", equity_close_time(bench[-1]), as_of) if bench else None
        stale = [] if bench_fresh and bench_fresh.usable else [f"{self.benchmark_equity} Tageskurse"]
        rep.kill_switch = self._kill_switch(rep, marks, stale, src)

        self._process_equity_orders(rep, ids, as_of)
        self._process_exits(rep, "equity", as_of)
        for t, fs in feats.items():
            snap = self._store_features(rep, fs)
            for ev in run_signal_engine(self.registry, "equity", fs, regime):
                self._decide(rep, ev, fs, "equity", regime, snap, price_basis="close", marks=marks, instrument_id=ids[t])
        self.conn.commit()

    # -------------------------------------------------------- gemeinsame Teile
    def _store_regime(self, rep: CycleReport, regime: RegimeState) -> None:
        self.conn.execute(
            """INSERT INTO regime_snapshots (regime_snapshot_id, cycle_id, scope, as_of, regime_version, labels, features, explanation)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            (uuid.uuid4(), rep.cycle_id, regime.scope, regime.as_of, regime.version, list(regime.labels), Jsonb(regime.features),
             regime.explanation),
        )
        self.events.emit("regime", f"Marktregime {regime.scope}: {', '.join(regime.labels)}", cycle_id=rep.cycle_id,
                         payload=regime.as_dict())

    def _store_features(self, rep: CycleReport, fs: FeatureSet) -> uuid.UUID:
        sid = uuid.uuid4()
        self.conn.execute(
            """INSERT INTO feature_snapshots (feature_snapshot_id, cycle_id, instrument_id, as_of, feature_version, features)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (sid, rep.cycle_id, fs.instrument_id, fs.as_of, fs.version, Jsonb(fs.as_dict())),
        )
        return sid

    def _kill_switch(self, rep: CycleReport, marks: dict[str, float], stale_core: list[str], source_id: str,
                     ignore_down: bool = False) -> str | None:
        view = self.portfolio.view(marks)
        midnight = self.clock().replace(hour=0, minute=0, second=0, microsecond=0)
        unrealized = sum(
            ((marks.get(p["instrument_id"], p["entry_price"]) - p["entry_price"]) * p["quantity"] * (1 if p["side"] == "long" else -1))
            for p in self.portfolio.open_positions()
        )
        day_pnl = self.portfolio.realized_pnl_since(midnight) + unrealized
        down = [r["source_id"] for r in self.health.latest()
                if not ignore_down and r["source_id"] == source_id and r["status"] == "down"
                and r["checked_at"] >= self.clock() - timedelta(minutes=5)]
        slippage = [r["slippage_bps"] for r in self.conn.execute(
            """SELECT f.slippage_bps FROM paper_fills f JOIN paper_orders o USING (order_id)
               WHERE o.account_id=%s AND f.filled_at >= %s""", (self.portfolio.account_id, self.clock() - timedelta(hours=1))).fetchall()]
        reason = kill_switch_reason(equity=view.equity, starting_cash=self.starting_cash, day_start_equity=view.equity - day_pnl,
                                    core_data_stale=stale_core, providers_down=down, recent_slippage_bps=slippage, limits=self.kill_limits)
        if reason:
            self.events.emit("kill_switch", f"Kill Switch aktiv: {reason}. Keine neuen Orders.", severity="critical", cycle_id=rep.cycle_id)
        return reason

    def _holding(self, instrument_id: str, strategy_id: str) -> bool:
        return self.conn.execute(
            """SELECT 1 FROM paper_positions p JOIN signals s USING (signal_id)
                 WHERE p.account_id=%s AND p.instrument_id=%s AND p.closed_at IS NULL AND s.strategy_id=%s
               UNION ALL
               SELECT 1 FROM paper_orders o JOIN signals s USING (signal_id)
                 WHERE o.account_id=%s AND o.instrument_id=%s AND o.status='pending' AND s.strategy_id=%s LIMIT 1""",
            (self.portfolio.account_id, instrument_id, strategy_id, self.portfolio.account_id, instrument_id, strategy_id),
        ).fetchone() is not None

    def _last_signal(self, instrument_id: str, strategy_id: str) -> dict | None:
        return self.conn.execute(
            """SELECT decision, signal_strength, created_at FROM signals WHERE instrument_id=%s AND strategy_id=%s
               ORDER BY seq DESC LIMIT 1""", (instrument_id, strategy_id)).fetchone()

    def _should_record(self, prev: dict | None, decision: Decision, strength: float, horizon: str, now: datetime) -> bool:
        if prev is None:
            return True  # erster Stand je Strategie/Instrument wird immer festgehalten, auch NO_TRADE
        if prev["decision"] != decision.value:
            return True
        if decision == Decision.NO_TRADE:
            return False
        if abs(float(prev["signal_strength"]) - strength) >= STRENGTH_CHANGE:
            return True
        return now - prev["created_at"] >= REPEAT_AFTER[horizon]

    def _decide(self, rep: CycleReport, ev: StrategyEvaluation, fs: FeatureSet, asset_class: str, regime: RegimeState,
                snapshot_id: uuid.UUID, *, price_basis: str, marks: dict[str, float], instrument_id: str) -> None:
        now = self.clock()
        if ev.decision in (Decision.LONG_CANDIDATE, Decision.SHORT_CANDIDATE) and self._holding(instrument_id, ev.strategy_id):
            # Setup derselben Strategie besteht fort, Position/Order existiert bereits: kein neues Signal, keine Schein-Ablehnung.
            # Kandidaten ANDERER Strategien laufen weiter durch die Risk Engine (dort: "bereits offene Position").
            rep.bump("holding")
            return
        view = self.portfolio.view(marks, rep.kill_switch)
        risk = self.risk.assess(ev, fs, asset_class, view)
        decision = final_decision(ev, risk)
        rep.bump(decision.value)
        if not self._should_record(self._last_signal(instrument_id, ev.strategy_id), decision, ev.strength, ev.horizon, now):
            return
        sources = sorted({s for v in fs.values.values() for s in v.source_ids})
        ctx = SignalContext(
            cycle_id=rep.cycle_id, mode=self.mode, created_at=now, regime=regime,
            data_sources=[{"source_id": s} for s in sources],
            data_freshness={k: {"class": v.freshness, "as_of": v.as_of.isoformat()} for k, v in fs.values.items()} | {
                "_unavailable": fs.unavailable},
            feature_snapshot_id=snapshot_id, strategy_registry_version=self.registry.version, price_basis=price_basis,
        )
        signal_id = self.audit.record(ev, decision, risk, ctx)
        rep.bump("signals_recorded")
        text = {
            Decision.LONG_CANDIDATE: f"Long-Kandidat ({ev.strategy_id}), Signalstärke {ev.strength:.0f}",
            Decision.SHORT_CANDIDATE: f"Short-Kandidat ({ev.strategy_id}), Signalstärke {ev.strength:.0f}",
            Decision.WATCH: f"Beobachten ({ev.strategy_id}): {'; '.join(ev.reasons[:2])}",
            Decision.NO_TRADE: f"Kein Trade ({ev.strategy_id}): {ev.summary}",
            Decision.REJECTED_BY_RISK: f"Von Risk Engine abgelehnt ({ev.strategy_id}): " + "; ".join(c.detail for c in risk.failed[:2]),
        }[decision]
        self.events.emit("signal", text, cycle_id=rep.cycle_id, instrument_id=instrument_id, signal_id=signal_id,
                         severity="notice" if decision in (Decision.LONG_CANDIDATE, Decision.SHORT_CANDIDATE) else "info",
                         payload={"decision": decision.value, "strength": ev.strength, "strategy_id": ev.strategy_id})
        if self.mode == "paper" and risk.approved and decision in (Decision.LONG_CANDIDATE, Decision.SHORT_CANDIDATE) and ev.exit_plan:
            cost = COSTS["crypto" if asset_class == "crypto" else "equity"]
            try:
                order_id = self.portfolio.place_entry(
                    signal_id=signal_id, instrument_id=instrument_id, side="buy" if ev.direction == "long" else "sell",
                    quantity=risk.position_quantity or 0, requested_at=now, delay=cost.delay, stop=ev.exit_plan.stop_price,
                    target=ev.exit_plan.target_price, time_exit_at=now + ev.exit_plan.max_holding, reason=ev.summary,
                )
            except DuplicateEntryError as exc:
                rep.bump("duplicate_entry_blocked")
                self.events.emit("duplicate_entry_blocked", str(exc), severity="warning", cycle_id=rep.cycle_id,
                                 instrument_id=instrument_id, signal_id=signal_id)
                return
            rep.bump("paper_orders")
            self.events.emit("paper_order", f"Paper-Order angelegt: {risk.position_quantity:.6g} Einheiten, ausführbar ab {now + cost.delay:%H:%M:%S} UTC",
                             cycle_id=rep.cycle_id, instrument_id=instrument_id, signal_id=signal_id, payload={"order_id": str(order_id)})

    def _process_crypto_orders(self, rep: CycleReport, live_by_instrument: dict[str, _CryptoLive], now: datetime) -> None:
        for o in self.portfolio.pending_orders():
            live = live_by_instrument.get(o["instrument_id"])
            if live is None or o["eligible_at"] > now:
                continue
            q = live.quote
            remaining = o["quantity"] - o["filled_quantity"]
            if o["status"] == "partially_filled" and now - o["eligible_at"] > PARTIAL_TIME_IN_FORCE:
                self.portfolio.reject(o["order_id"], "Restmenge verfallen (Time in Force)")
                rep.bump("paper_partial_expired")
                continue
            fill = crypto_market_fill(o["side"], remaining, live.book, q.bid if q else None, q.ask if q else None, now,
                                      min_fill_ratio=MIN_FILL_RATIO)
            if fill is None:
                self.portfolio.reject(o["order_id"], "Kein Kurs oder Orderbuch trägt die Größe nicht")
                rep.bump("paper_rejected")
                self.events.emit("paper_reject", "Paper-Order verworfen: keine ausreichende Liquidität", cycle_id=rep.cycle_id,
                                 instrument_id=o["instrument_id"], severity="warning")
                continue
            if o["side"] == "buy" and fill.price * fill.quantity + fill.fee > self.portfolio.cash():
                self.portfolio.reject(o["order_id"], "Nicht genug Paper-Kapital")
                continue
            self.portfolio.fill_entry(o, fill)
            rep.bump("paper_fills")
            self.events.emit("paper_fill", f"Paper-Fill {fill.quantity:.6g} @ {fill.price:.6g} (Slippage {fill.slippage_bps:.1f} bps, Gebühr {fill.fee:.2f})",
                             cycle_id=rep.cycle_id, instrument_id=o["instrument_id"], signal_id=o["signal_id"])

    def _process_equity_orders(self, rep: CycleReport, ids: dict[str, str], now: datetime) -> None:
        known = set(ids.values())
        for o in self.portfolio.pending_orders():
            if o["instrument_id"] not in known:
                continue
            bars = load_bars(self.conn, o["instrument_id"], "1d", o["eligible_at"] - timedelta(days=1), now)
            nxt = next((b for b in bars if session_open(b) >= o["eligible_at"]), None)
            if nxt is None:
                continue  # naechste Eroeffnung noch nicht vorhanden (Wochenende, Feiertag, Daten fehlen)
            fill = equity_open_fill(o["side"], o["quantity"] - o["filled_quantity"], nxt)
            if o["side"] == "buy" and fill.price * fill.quantity + fill.fee > self.portfolio.cash():
                self.portfolio.reject(o["order_id"], "Nicht genug Paper-Kapital")
                continue
            self.portfolio.fill_entry(o, fill)
            rep.bump("paper_fills")
            self.events.emit("paper_fill", f"Paper-Fill zur Eröffnung {fill.quantity:.0f} @ {fill.price:.4g}", cycle_id=rep.cycle_id,
                             instrument_id=o["instrument_id"], signal_id=o["signal_id"])

    def _process_exits(self, rep: CycleReport, group: str, now: datetime) -> None:
        tf, length = ("1m", timedelta(minutes=1)) if group == "crypto" else ("1d", timedelta(days=1))
        for p in self.portfolio.open_positions():
            if p["asset_class"].startswith("crypto") != (group == "crypto"):
                continue
            since = p["opened_at"] if group == "crypto" else p["opened_at"].replace(hour=0, minute=0, second=0, microsecond=0)
            bars = [b for b in load_bars(self.conn, p["instrument_id"], tf, since, now) if b.ts + length <= now]
            if group == "crypto":
                bars = [b for b in bars if b.ts >= p["opened_at"]]
            ev = check_exit(p["side"], p["stop_price"], p["target_price"], p["time_exit_at"], bars, length, group == "equity")
            if ev is None:
                continue
            fill = exit_fill(p["side"], p["quantity"], ev, COSTS[group])
            pnl = self.portfolio.close_position(p, fill, ev.reason)
            rep.bump("paper_exits")
            self.events.emit("paper_exit", f"Paper-Position geschlossen ({ev.reason}{', Kurslücke' if ev.gap else ''}): Ergebnis {pnl:,.2f}",
                             cycle_id=rep.cycle_id, instrument_id=p["instrument_id"], signal_id=p["signal_id"],
                             severity="notice", payload={"reason": ev.reason, "pnl": pnl, "gap": ev.gap})
