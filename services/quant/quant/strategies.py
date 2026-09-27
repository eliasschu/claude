"""
StrategyRegistry + fuenf regelbasierte Strategien (§38, Phase 2).

Jede Strategie legt offen: required_features, entry_conditions,
rejection_conditions, invalidation_logic, exit_logic, risk_rules.

Signalstaerke = Summe der offengelegten Punkte (auf 0..100 begrenzt).
Jeder Punktbeitrag steht als `points` an genau einem Evidence-Eintrag - die
Erklaerung ist damit die Berechnung selbst, keine nachtraegliche Deutung (§79).
Die Punkte fuer das Marktregime unterscheiden sich je Strategie (§9, §37).

Entscheidungsregel (fuer alle gleich):
  * Pflichtmerkmale fehlen oder sind fuer den Horizont zu alt -> NO_TRADE
  * alle Einstiegsbedingungen erfuellt, keine Ausschlussbedingung, Staerke >= 60 -> *_CANDIDATE
  * Setup teilweise vorhanden oder Ausschlussbedingung greift -> WATCH
  * sonst -> NO_TRADE ("Derzeit kein ausreichender Vorteil erkennbar.")
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Callable

from .domain import Decision, Evidence, ExitPlan, FeatureSet, Horizon, Invalidation, RegimeState, StrategyEvaluation
from .freshness import ACCEPTABLE

CANDIDATE_MIN_STRENGTH = 60.0
WATCH_MIN_STRENGTH = 40.0


@dataclass(frozen=True)
class StrategySpec:
    strategy_id: str
    version: str
    name: str
    asset_class: str
    time_horizon: Horizon
    holding: str
    required_features: tuple[str, ...]
    entry_conditions: tuple[str, ...]
    rejection_conditions: tuple[str, ...]
    invalidation_logic: str
    exit_logic: str
    risk_rules: tuple[str, ...]
    hypothesis: str

    def as_dict(self) -> dict:
        return {k: (list(v) if isinstance(v, tuple) else v) for k, v in self.__dict__.items()}


@dataclass
class _Score:
    positive: list[Evidence] = field(default_factory=list)
    negative: list[Evidence] = field(default_factory=list)

    def plus(self, key: str, text: str, points: float, *features: str) -> None:
        if points > 0:
            self.positive.append(Evidence(key, text, features, round(points, 2)))

    def minus(self, key: str, text: str, points: float, *features: str) -> None:
        self.negative.append(Evidence(key, text, features, -round(points, 2) if points else None))

    @property
    def total(self) -> float:
        s = sum(e.points or 0 for e in self.positive) + sum(e.points or 0 for e in self.negative)
        return max(0.0, min(100.0, s))


def _fmt(x: float, d: int = 1) -> str:
    return f"{x:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


class Strategy:
    spec: StrategySpec

    def evaluate(self, fs: FeatureSet, regime: RegimeState) -> StrategyEvaluation:
        missing = [f for f in self.spec.required_features if not fs.has(f)]
        if missing:
            reasons = tuple(f"{m}: {fs.unavailable.get(m) or fs.unavailable.get('*') or 'nicht verfügbar'}" for m in missing)
            return self._result(fs, Decision.NO_TRADE, "none", 0.0, "Daten unvollständig - keine Bewertung.", _Score(), None, None, None, reasons)
        stale = [f for f in self.spec.required_features if fs.values[f].freshness not in ACCEPTABLE[self.spec.time_horizon]]
        if stale:
            reasons = tuple(f"{f}: Datenstand '{fs.values[f].freshness}' passt nicht zum Horizont {self.spec.time_horizon}" for f in stale)
            return self._result(fs, Decision.NO_TRADE, "none", 0.0, "Daten zu alt für diese Strategie.", _Score(), None, None, None, reasons)
        return self._evaluate(fs, regime)

    def _evaluate(self, fs: FeatureSet, regime: RegimeState) -> StrategyEvaluation:  # pragma: no cover - abstrakt
        raise NotImplementedError

    def _decide(self, fs: FeatureSet, direction: str, entry_met: list[bool], rejections: list[str], score: _Score,
                entry: float, stop: float, target: float, summary: str) -> StrategyEvaluation:
        strength = score.total
        n_met = sum(entry_met)
        long = direction == "long"
        up = (target / entry - 1) * 100 if long else (1 - target / entry) * 100
        down = (1 - stop / entry) * 100 if long else (stop / entry - 1) * 100
        inval = Invalidation("close_below" if long else "close_above", round(stop, 8), self.spec.invalidation_logic,
                             "1d" if self.spec.asset_class == "equity" else "1m")
        exit_plan = ExitPlan(round(stop, 8), round(target, 8), _MAX_HOLD[self.spec.strategy_id], self.spec.exit_logic)
        if all(entry_met) and not rejections and strength >= CANDIDATE_MIN_STRENGTH:
            decision = Decision.LONG_CANDIDATE if long else Decision.SHORT_CANDIDATE
            reasons: tuple[str, ...] = ()
        elif (n_met >= max(1, math.ceil(len(entry_met) / 2)) or rejections) and strength >= WATCH_MIN_STRENGTH:
            decision = Decision.WATCH
            open_items = [c for c, ok in zip(self.spec.entry_conditions, entry_met) if not ok]
            reasons = tuple(rejections) + tuple(f"Bestätigung fehlt: {c}" for c in open_items) + (
                () if strength >= CANDIDATE_MIN_STRENGTH else (f"Signalstärke {_fmt(strength)} unter {CANDIDATE_MIN_STRENGTH:.0f}",))
            summary = "Setup interessant, aber Bestätigung fehlt. " + summary
        else:
            return self._result(fs, Decision.NO_TRADE, "none", strength, "Derzeit kein ausreichender Vorteil erkennbar.", score,
                                None, None, entry, tuple(rejections))
        return StrategyEvaluation(
            strategy_id=self.spec.strategy_id, strategy_version=self.spec.version, instrument_id=fs.instrument_id,
            horizon=self.spec.time_horizon, direction=direction, decision=decision, strength=round(strength, 2),  # type: ignore[arg-type]
            summary=summary, positive=tuple(score.positive), negative=tuple(score.negative), invalidation=inval,
            exit_plan=exit_plan, reference_price=entry, upside_to_target_pct=round(up, 4), downside_to_stop_pct=round(down, 4),
            reasons=reasons,
        )

    def _result(self, fs: FeatureSet, decision: Decision, direction: str, strength: float, summary: str, score: _Score,
                inval: Invalidation | None, exit_plan: ExitPlan | None, price: float | None, reasons: tuple[str, ...]) -> StrategyEvaluation:
        return StrategyEvaluation(
            strategy_id=self.spec.strategy_id, strategy_version=self.spec.version, instrument_id=fs.instrument_id,
            horizon=self.spec.time_horizon, direction=direction, decision=decision, strength=round(strength, 2),  # type: ignore[arg-type]
            summary=summary, positive=tuple(score.positive), negative=tuple(score.negative), invalidation=inval,
            exit_plan=exit_plan, reference_price=price if price is not None else (fs.values["close"].raw if "close" in fs.values else None),
            upside_to_target_pct=None, downside_to_stop_pct=None, reasons=reasons,
        )


_MAX_HOLD: dict[str, timedelta] = {
    "equity_breakout_momentum": timedelta(days=14),
    "equity_relative_strength": timedelta(days=28),
    "equity_volume_anomaly": timedelta(days=7),
    "crypto_spot_perp_divergence": timedelta(hours=6),
    "crypto_momentum_funding_oi": timedelta(hours=24),
}


def _has(regime: RegimeState, *labels: str) -> bool:
    return any(l in regime.labels for l in labels)


# ---------------------------------------------------------------------------
# A. Equity Breakout Momentum
# ---------------------------------------------------------------------------
class EquityBreakoutMomentum(Strategy):
    spec = StrategySpec(
        strategy_id="equity_breakout_momentum", version="1.0.0", name="Aktien: Ausbruch mit Momentum", asset_class="equity",
        time_horizon="swing", holding="2–10 Handelstage",
        required_features=("close", "breakout_20d", "donchian20_high", "rvol_20d", "dist_sma50_pct", "dist_sma200_pct", "atr_14"),
        entry_conditions=("Tagesschluss über dem 20-Tage-Hoch", "Tagesvolumen mindestens 1,5-mal so hoch wie im 20-Tage-Schnitt",
                          "Kurs über 50- und 200-Tage-Schnitt"),
        rejection_conditions=("Marktregime risikoscheu oder im Abwärtstrend", "Kurs mehr als 2 ATR über dem Ausbruchsniveau (überdehnt)"),
        invalidation_logic="Die Ausbruchs-These ist falsch, wenn ein Tagesschluss wieder unter das alte 20-Tage-Hoch minus 0,5 ATR fällt.",
        exit_logic="Stop: altes 20-Tage-Hoch minus 0,5 ATR. Ziel: Einstieg plus 3 ATR. Spätestens nach 10 Handelstagen schließen.",
        risk_rules=("Mindest-Chance-Risiko-Verhältnis laut Risk Engine", "Positionsgröße über Risiko je Trade und ATR"),
        hypothesis="Ausbrüche über ein 20-Tage-Hoch mit ungewöhnlich hohem Volumen setzen sich in Aufwärtstrends häufiger fort.",
    )

    def _evaluate(self, fs: FeatureSet, regime: RegimeState) -> StrategyEvaluation:
        close, high20, rvol, atr = fs.raw("close"), fs.raw("donchian20_high"), fs.raw("rvol_20d"), fs.raw("atr_14")
        d50, d200 = fs.raw("dist_sma50_pct"), fs.raw("dist_sma200_pct")
        s = _Score()
        breakout = fs.raw("breakout_20d") == 1.0
        if breakout:
            s.plus("breakout", f"Schlusskurs {_fmt(close, 2)} über dem 20-Tage-Hoch {_fmt(high20, 2)} (Donchian-Ausbruch)", 25, "breakout_20d")
        s.plus("volume", f"Tagesvolumen {_fmt(rvol)}-mal so hoch wie im Schnitt der 20 Vortage (Relative Volume)", min(20, (rvol - 1) * 10), "rvol_20d")
        if d50 > 0 and d200 > 0:
            s.plus("trend", "Kurs über 50- und 200-Tage-Schnitt", 15, "dist_sma50_pct", "dist_sma200_pct")
        if fs.has("rel_strength_20d_pp"):
            rs = fs.raw("rel_strength_20d_pp")
            if rs > 0:
                s.plus("rel_strength", f"{_fmt(rs)} Prozentpunkte stärker als die Benchmark über 20 Tage", min(15, rs), "rel_strength_20d_pp")
            else:
                s.minus("rel_weakness", f"{_fmt(abs(rs))} Prozentpunkte schwächer als die Benchmark über 20 Tage", min(10, -rs), "rel_strength_20d_pp")
        rejections: list[str] = []
        if _has(regime, "TRENDING_UP") and _has(regime, "RISK_ON"):
            s.plus("regime", "Marktregime unterstützt Ausbrüche (Aufwärtstrend, risikofreudig)", 10)
        if _has(regime, "RISK_OFF", "TRENDING_DOWN"):
            s.minus("regime", "Marktregime risikoscheu - Ausbrüche scheitern dort häufiger", 10)
            rejections.append("Marktregime risikoscheu oder im Abwärtstrend")
        if _has(regime, "HIGH_VOLATILITY"):
            s.minus("volatility", "Hohe Marktschwankung erhöht das Risiko von Fehlausbrüchen", 5)
        ext_atr = (close - high20) / atr if atr > 0 else 0
        if ext_atr > 2:
            s.minus("extended", f"Kurs bereits {_fmt(ext_atr)} ATR über dem Ausbruchsniveau (überdehnt)", min(15, (ext_atr - 1) * 5), "atr_14")
            rejections.append("Kurs mehr als 2 ATR über dem Ausbruchsniveau (überdehnt)")
        stop = high20 - 0.5 * atr
        stop = min(stop, close - 0.5 * atr)  # Stop immer unter dem Einstieg
        entry_met = [breakout, rvol >= 1.5, d50 > 0 and d200 > 0]
        return self._decide(fs, "long", entry_met, rejections, s, close, stop, close + 3 * atr,
                            "Ausbruch über das 20-Tage-Hoch mit erhöhtem Volumen.")


# ---------------------------------------------------------------------------
# B. Equity Relative Strength
# ---------------------------------------------------------------------------
class EquityRelativeStrength(Strategy):
    spec = StrategySpec(
        strategy_id="equity_relative_strength", version="1.0.0", name="Aktien: Relative Stärke", asset_class="equity",
        time_horizon="swing", holding="10–20 Handelstage",
        required_features=("close", "rel_strength_20d_pp", "rel_strength_63d_pp", "dist_sma50_pct", "atr_14"),
        entry_conditions=("Mindestens 5 Prozentpunkte stärker als die Benchmark über 3 Monate",
                          "Mindestens 2 Prozentpunkte stärker über 20 Tage", "Kurs über dem 50-Tage-Schnitt"),
        rejection_conditions=("Marktregime risikoscheu", "Kurs mehr als 15 % über dem 50-Tage-Schnitt (überdehnt)"),
        invalidation_logic="Die These ist falsch, wenn die relative Stärke über 20 Tage negativ wird oder der Kurs 2 ATR unter den Einstieg fällt.",
        exit_logic="Stop: Einstieg minus 2 ATR. Ziel: Einstieg plus 4 ATR. Spätestens nach 20 Handelstagen schließen.",
        risk_rules=("Mindest-Chance-Risiko-Verhältnis laut Risk Engine", "Sektor- und Positionskonzentration begrenzt"),
        hypothesis="Aktien mit anhaltender Überrendite gegenüber dem Markt behalten diese mittelfristig häufiger (Momentum-Effekt).",
    )

    def _evaluate(self, fs: FeatureSet, regime: RegimeState) -> StrategyEvaluation:
        close, rs20, rs63, d50, atr = (fs.raw(k) for k in ("close", "rel_strength_20d_pp", "rel_strength_63d_pp", "dist_sma50_pct", "atr_14"))
        s = _Score()
        s.plus("rs63", f"Über 3 Monate {_fmt(rs63)} Prozentpunkte stärker als die Benchmark", min(30, rs63 * 2), "rel_strength_63d_pp")
        s.plus("rs20", f"Über 20 Tage {_fmt(rs20)} Prozentpunkte stärker als die Benchmark", min(20, rs20 * 3), "rel_strength_20d_pp")
        if d50 > 0:
            s.plus("trend", "Kurs über dem 50-Tage-Schnitt", 10, "dist_sma50_pct")
        rejections: list[str] = []
        if _has(regime, "RISK_ON"):
            s.plus("regime", "Risikofreudiges Umfeld begünstigt Momentum-Führer", 10)
        if _has(regime, "BROAD_MARKET"):
            s.plus("breadth", "Breite Marktbeteiligung", 5)
        if _has(regime, "RISK_OFF"):
            s.minus("regime", "Risikoscheues Umfeld - Momentum-Führer fallen dort oft stärker", 15)
            rejections.append("Marktregime risikoscheu")
        if d50 > 15:
            s.minus("extended", f"Kurs {_fmt(d50)} % über dem 50-Tage-Schnitt (überdehnt)", 10, "dist_sma50_pct")
            rejections.append("Kurs mehr als 15 % über dem 50-Tage-Schnitt (überdehnt)")
        entry_met = [rs63 >= 5, rs20 >= 2, d50 > 0]
        return self._decide(fs, "long", entry_met, rejections, s, close, close - 2 * atr, close + 4 * atr,
                            "Anhaltende Überrendite gegenüber der Benchmark.")


# ---------------------------------------------------------------------------
# C. Equity Volume Anomaly
# ---------------------------------------------------------------------------
class EquityVolumeAnomaly(Strategy):
    spec = StrategySpec(
        strategy_id="equity_volume_anomaly", version="1.0.0", name="Aktien: Volumen-Anomalie", asset_class="equity",
        time_horizon="swing", holding="1–5 Handelstage",
        required_features=("close", "rvol_20d", "day_return_pct", "atr_14", "dist_sma50_pct"),
        entry_conditions=("Tagesvolumen mindestens 2,5-mal so hoch wie im 20-Tage-Schnitt",
                          "Tagesbewegung mindestens 2 % in eine Richtung", "Bewegung in Richtung des 50-Tage-Trends"),
        rejection_conditions=("Hohes Volumen ohne klare Richtung (unter 1 %)",),
        invalidation_logic="Die These ist falsch, wenn der Kurs 1 ATR gegen die Richtung des Volumentags schließt.",
        exit_logic="Stop: Einstieg minus 1 ATR (Short: plus). Ziel: 2 ATR. Spätestens nach 5 Handelstagen schließen.",
        risk_rules=("Nur ausreichend liquide Werte", "Kein Auslöser bekannt - Ereignisrisiko ausdrücklich ausgewiesen"),
        hypothesis="Stark erhöhtes Volumen bei deutlicher Kursbewegung zeigt neue Information; die Richtung hält kurzfristig häufiger an.",
    )

    def _evaluate(self, fs: FeatureSet, regime: RegimeState) -> StrategyEvaluation:
        close, rvol, ret, atr, d50 = (fs.raw(k) for k in ("close", "rvol_20d", "day_return_pct", "atr_14", "dist_sma50_pct"))
        direction = "long" if ret >= 0 else "short"
        sign = 1 if direction == "long" else -1
        s = _Score()
        s.plus("volume", f"Tagesvolumen {_fmt(rvol)}-mal so hoch wie im Schnitt der 20 Vortage", min(35, (rvol - 1) * 12), "rvol_20d")
        s.plus("move", f"Tagesbewegung {_fmt(ret, 2)} %", min(20, abs(ret) * 4), "day_return_pct")
        aligned = (d50 > 0) == (direction == "long")
        if aligned:
            s.plus("trend", "Bewegung in Richtung des 50-Tage-Trends", 10, "dist_sma50_pct")
        else:
            s.minus("counter_trend", "Bewegung gegen den 50-Tage-Trend", 10, "dist_sma50_pct")
        s.minus("catalyst", "Auslöser unbekannt: kein Nachrichtenfeed angebunden - Ereignisrisiko nicht beurteilbar", 0)
        rejections: list[str] = []
        if abs(ret) < 1:
            rejections.append("Hohes Volumen ohne klare Richtung (unter 1 %)")
        if direction == "long" and _has(regime, "RISK_ON"):
            s.plus("regime", "Risikofreudiges Umfeld", 5)
        if direction == "short" and _has(regime, "RISK_OFF"):
            s.plus("regime", "Risikoscheues Umfeld", 5)
        entry_met = [rvol >= 2.5, abs(ret) >= 2, aligned]
        return self._decide(fs, direction, entry_met, rejections, s, close, close - sign * atr, close + sign * 2 * atr,
                            "Ungewöhnlich hohes Volumen mit deutlicher Kursbewegung.")


# ---------------------------------------------------------------------------
# Krypto-Hilfen
# ---------------------------------------------------------------------------
def _hourly_sigma(fs: FeatureSet) -> float | None:
    """Einstuendige Standardabweichung (Anteil) aus der annualisierten Minuten-Volatilitaet."""
    if not fs.has("realized_vol_60m_pct"):
        return None
    return fs.raw("realized_vol_60m_pct") / 100 / math.sqrt(8760)


def _crypto_levels(fs: FeatureSet, direction: str, hours: float, floor_pct: float, k: float) -> tuple[float, float, float]:
    close = fs.raw("close")
    sig = _hourly_sigma(fs) or 0.0
    dist = max(floor_pct / 100, k * sig * math.sqrt(hours)) * close
    sign = 1 if direction == "long" else -1
    return close, close - sign * dist, close + sign * 2 * dist


# ---------------------------------------------------------------------------
# D. Crypto Spot/Perp Divergence
# ---------------------------------------------------------------------------
class CryptoSpotPerpDivergence(Strategy):
    spec = StrategySpec(
        strategy_id="crypto_spot_perp_divergence", version="1.0.0", name="Krypto: Spot/Perp-Divergenz", asset_class="crypto",
        time_horizon="intraday", holding="1–6 Stunden",
        required_features=("close", "spot_cvd_60m_share", "perp_cvd_60m_share", "perp_basis_bps", "ret_60m_pct", "realized_vol_60m_pct", "spread_bps"),
        entry_conditions=("Spot-Käufer dominieren (CVD-Anteil ≥ 8 %) bzw. Spot-Verkäufer (≤ −8 %)",
                          "Perpetual-Fluss neutral oder entgegengesetzt", "Basis nicht überhitzt (Long ≤ 5 bps, Short ≥ 5 bps)",
                          "Preis bestätigt die Spot-Richtung (60 Minuten)"),
        rejection_conditions=("Spread über 5 bps", "Hebel am Derivatemarkt extrem (LEVERAGE_ELEVATED) gegen die Richtung"),
        invalidation_logic="Die These ist falsch, wenn der Spot-Fluss dreht oder der Preis die Stop-Marke (volatilitätsbasiert) erreicht.",
        exit_logic="Stop: max(0,4 %, 1,5 × Stunden-Sigma × √2). Ziel: doppelter Stop-Abstand. Spätestens nach 6 Stunden schließen.",
        risk_rules=("Spread und Orderbuchtiefe müssen die Positionsgröße tragen", "Kein Hebel im Paper-Trading"),
        hypothesis="Von Spot-Käufen getragene Bewegungen sind stabiler als hebelgetriebene; eine Divergenz zeigt, wer den Preis bewegt.",
    )

    def _evaluate(self, fs: FeatureSet, regime: RegimeState) -> StrategyEvaluation:
        spot, perp, basis, r60, spread = (fs.raw(k) for k in ("spot_cvd_60m_share", "perp_cvd_60m_share", "perp_basis_bps", "ret_60m_pct", "spread_bps"))
        direction = "long" if spot >= 0 else "short"
        sign = 1 if direction == "long" else -1
        s = _Score()
        div = (spot - perp) * sign
        s.plus("divergence", f"Spot-Fluss {_fmt(spot * 100)} %, Perpetual-Fluss {_fmt(perp * 100)} % (Cumulative Volume Delta, 60 Min.)",
               min(40, div * 200), "spot_cvd_60m_share", "perp_cvd_60m_share")
        basis_ok = basis <= 5 if direction == "long" else basis >= 5
        if basis_ok:
            s.plus("basis", f"Basis {_fmt(basis)} bps - Bewegung nicht vom Terminmarkt überhitzt", 15, "perp_basis_bps")
        price_ok = r60 * sign >= 0
        if price_ok:
            s.plus("price", f"Preis bestätigt: {_fmt(r60, 2)} % in 60 Minuten", 10, "ret_60m_pct")
        rejections: list[str] = []
        opposing = "RISK_OFF" if direction == "long" else "RISK_ON"
        if not _has(regime, opposing):
            s.plus("regime", "Marktregime steht der Richtung nicht entgegen", 10)
        if spread > 5:
            s.minus("spread", f"Spread {_fmt(spread)} bps - Ausführung teuer", 10, "spread_bps")
            rejections.append("Spread über 5 bps")
        if _has(regime, "LEVERAGE_ELEVATED"):
            s.minus("leverage", "Hebel am Derivatemarkt erhöht - Liquidationskaskaden möglich", 5)
        entry_met = [spot * sign >= 0.08, perp * sign <= 0, basis_ok, price_ok]
        entry, stop, target = _crypto_levels(fs, direction, 2, 0.4, 1.5)
        return self._decide(fs, direction, entry_met, rejections, s, entry, stop, target, "Spot- und Perpetual-Fluss laufen auseinander.")


# ---------------------------------------------------------------------------
# E. Crypto Momentum + Funding/OI
# ---------------------------------------------------------------------------
class CryptoMomentumFundingOI(Strategy):
    spec = StrategySpec(
        strategy_id="crypto_momentum_funding_oi", version="1.0.0", name="Krypto: Momentum mit Funding und Open Interest",
        asset_class="crypto", time_horizon="intraday", holding="4–24 Stunden",
        required_features=("close", "ret_240m_pct", "ret_60m_pct", "oi_change_60m_pct", "funding_rate_8h", "realized_vol_60m_pct", "dist_vwap_60m_pct"),
        entry_conditions=("Momentum 4 Stunden ≥ 1 % in eine Richtung", "Letzte Stunde bestätigt (≥ 0,2 %)",
                          "Open Interest steigt ≥ 1 % (neue Positionen)", "Funding nicht überfüllt in Trade-Richtung (|z| ≤ 1,5)"),
        rejection_conditions=("Funding extrem in Trade-Richtung (z > 2): Positionierung überfüllt", "Kurs mehr als 1,5 % vom 60-Min-VWAP entfernt"),
        invalidation_logic="Die These ist falsch, wenn der Preis die Stop-Marke erreicht oder das Open Interest bei fallendem Momentum abgebaut wird.",
        exit_logic="Stop: max(0,6 %, 1,2 × Stunden-Sigma × √4). Ziel: doppelter Stop-Abstand. Spätestens nach 24 Stunden schließen.",
        risk_rules=("Kein Hebel im Paper-Trading", "Korrelation zu bestehenden Krypto-Positionen begrenzt"),
        hypothesis="Trendbewegungen mit neuem Kapital (steigendes OI) ohne überfüllte Positionierung setzen sich kurzfristig häufiger fort.",
    )

    def _evaluate(self, fs: FeatureSet, regime: RegimeState) -> StrategyEvaluation:
        r240, r60, oi, vwap_d = (fs.raw(k) for k in ("ret_240m_pct", "ret_60m_pct", "oi_change_60m_pct", "dist_vwap_60m_pct"))
        fz = fs.values["funding_rate_8h"].zscore
        direction = "long" if r240 >= 0 else "short"
        sign = 1 if direction == "long" else -1
        s = _Score()
        s.plus("momentum", f"{_fmt(r240, 2)} % in 4 Stunden", min(30, abs(r240) * 10), "ret_240m_pct")
        confirm = r60 * sign >= 0.2
        if confirm:
            s.plus("confirm", f"Letzte Stunde bestätigt: {_fmt(r60, 2)} %", 10, "ret_60m_pct")
        oi_up = oi >= 1
        if oi_up:
            s.plus("oi", f"Open Interest +{_fmt(oi)} % in 60 Minuten: neue Positionen", min(20, oi * 4), "oi_change_60m_pct")
        elif oi < 0:
            s.minus("oi", f"Open Interest {_fmt(oi)} %: Bewegung eher durch Schließen von Positionen", 5, "oi_change_60m_pct")
        rejections: list[str] = []
        crowd = None if fz is None else fz * sign
        funding_ok = crowd is not None and crowd <= 1.5
        if funding_ok:
            s.plus("funding", f"Funding nicht überfüllt in Trade-Richtung (z = {_fmt(fz, 2)})", 15, "funding_rate_8h")
        elif crowd is None:
            s.minus("funding", "Funding-Historie zu kurz für eine Einordnung", 0, "funding_rate_8h")
        elif crowd > 2:
            s.minus("funding", f"Funding extrem in Trade-Richtung (z = {_fmt(fz, 2)}): Positionierung überfüllt", 15, "funding_rate_8h")
            rejections.append("Funding extrem in Trade-Richtung: Positionierung überfüllt")
        if fs.has("rvol_tod_60m") and fs.raw("rvol_tod_60m") > 1:
            rv = fs.raw("rvol_tod_60m")
            s.plus("rvol", f"Volumen {_fmt(rv)}-mal so hoch wie zu dieser Tageszeit üblich", min(10, (rv - 1) * 10), "rvol_tod_60m")
        if (direction == "long" and _has(regime, "TRENDING_UP")) or (direction == "short" and _has(regime, "TRENDING_DOWN")):
            s.plus("regime", "Übergeordneter Trend (Tagesbasis) in Trade-Richtung", 10)
        if _has(regime, "HIGH_VOLATILITY"):
            s.minus("volatility", "Hohe Schwankung - Stops werden häufiger ausgelöst", 5)
        if abs(vwap_d) > 1.5:
            s.minus("extended", f"Kurs {_fmt(vwap_d, 2)} % vom 60-Minuten-VWAP entfernt (überdehnt)", 10, "dist_vwap_60m_pct")
            rejections.append("Kurs mehr als 1,5 % vom 60-Min-VWAP entfernt")
        entry_met = [abs(r240) >= 1, confirm, oi_up, funding_ok]
        entry, stop, target = _crypto_levels(fs, direction, 4, 0.6, 1.2)
        return self._decide(fs, direction, entry_met, rejections, s, entry, stop, target,
                            "Trend mit neuem Kapital und nicht überfüllter Positionierung.")


class StrategyRegistry:
    def __init__(self, strategies: list[Strategy] | None = None):
        self._strategies = strategies or [EquityBreakoutMomentum(), EquityRelativeStrength(), EquityVolumeAnomaly(),
                                          CryptoSpotPerpDivergence(), CryptoMomentumFundingOI()]
        ids = [s.spec.strategy_id for s in self._strategies]
        if len(ids) != len(set(ids)):
            raise ValueError("Doppelte strategy_id")

    @property
    def version(self) -> str:
        blob = ";".join(f"{s.spec.strategy_id}@{s.spec.version}" for s in sorted(self._strategies, key=lambda s: s.spec.strategy_id))
        return "registry-" + hashlib.sha256(blob.encode()).hexdigest()[:12]

    def for_asset_class(self, asset_class: str) -> list[Strategy]:
        return [s for s in self._strategies if s.spec.asset_class == asset_class]

    def specs(self) -> list[StrategySpec]:
        return [s.spec for s in self._strategies]

    def get(self, strategy_id: str) -> Strategy:
        for s in self._strategies:
            if s.spec.strategy_id == strategy_id:
                return s
        raise KeyError(strategy_id)


SignalEngine = Callable[[FeatureSet, RegimeState], list[StrategyEvaluation]]


def run_signal_engine(registry: StrategyRegistry, asset_class: str, fs: FeatureSet, regime: RegimeState) -> list[StrategyEvaluation]:
    """SignalEngine: alle Strategien der Assetklasse auf einen Merkmalssatz anwenden."""
    return [s.evaluate(fs, regime) for s in registry.for_asset_class(asset_class)]
