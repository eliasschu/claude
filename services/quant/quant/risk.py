"""
RiskEngine (§42-45): eigener Baustein, nicht Teil der Signalstaerke.
Ein starkes Signal kann hier abgelehnt werden - es bleibt dann sichtbar als
REJECTED_BY_RISK mit allen fehlgeschlagenen Pruefungen.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .domain import Decision, FeatureSet, RiskAssessment, RiskCheck, StrategyEvaluation

RISK_VERSION = "risk-0.1.0"


@dataclass(frozen=True)
class RiskLimits:
    min_risk_reward: float = 1.8
    risk_per_trade_pct: float = 0.5          # vom Paper-Kapital
    max_position_pct: float = 10.0
    max_open_positions: int = 10
    max_crypto_exposure_pct: float = 30.0     # korrelierte Gruppe
    max_gross_exposure_pct: float = 100.0     # kein Hebel
    max_stop_pct: dict = field(default_factory=lambda: {"equity": 12.0, "crypto": 5.0})
    min_adv_usd_equity: float = 20_000_000
    max_share_of_adv_pct: float = 1.0
    min_quote_volume_24h_crypto: float = 50_000_000
    max_spread_bps_crypto: float = 5.0
    min_depth_multiple_crypto: float = 5.0
    max_atr_pct_equity: float = 8.0
    max_realized_vol_crypto_pct: float = 150.0
    allow_shorts: bool = False  # Short-Simulation ohne Leihe/Funding-Kosten waere unrealistisch


@dataclass(frozen=True)
class OpenPosition:
    instrument_id: str
    asset_class: str
    notional: float


@dataclass(frozen=True)
class PortfolioView:
    equity: float
    cash: float
    positions: tuple[OpenPosition, ...]
    kill_switch_reason: str | None = None


class RiskEngine:
    def __init__(self, limits: RiskLimits | None = None):
        self.limits = limits or RiskLimits()

    def assess(self, ev: StrategyEvaluation, fs: FeatureSet, asset_class: str, pf: PortfolioView) -> RiskAssessment:
        L = self.limits
        if ev.decision not in (Decision.LONG_CANDIDATE, Decision.SHORT_CANDIDATE):
            return RiskAssessment(False, (RiskCheck("candidate", False, "Keine Handelsidee - Risk Engine nicht angewandt."),),
                                  None, None, None, None, RISK_VERSION)
        checks: list[RiskCheck] = []

        def check(name: str, passed: bool, detail: str) -> None:
            checks.append(RiskCheck(name, passed, detail))

        check("kill_switch", pf.kill_switch_reason is None, pf.kill_switch_reason or "nicht aktiv")
        check("short_allowed", ev.direction == "long" or L.allow_shorts,
              "Long" if ev.direction == "long" else "Short-Simulation ohne Leihe/Funding-Kosten ist noch nicht realistisch - abgelehnt.")

        entry = ev.reference_price or 0.0
        stop = ev.exit_plan.stop_price if ev.exit_plan else None
        up, down = ev.upside_to_target_pct, ev.downside_to_stop_pct
        rr = up / down if up is not None and down and down > 0 else None
        check("risk_reward", rr is not None and rr >= L.min_risk_reward,
              f"Chance-Risiko {rr:.2f} (Minimum {L.min_risk_reward})" if rr is not None else "nicht berechenbar")
        max_stop = L.max_stop_pct[asset_class]
        check("stop_distance", down is not None and 0 < down <= max_stop,
              f"Stop-Abstand {down:.2f} % (erlaubt bis {max_stop} %)" if down is not None else "kein Stop")

        # Positionsgroesse: Risiko je Trade / Stop-Abstand, begrenzt durch Positions- und Kassenlimit
        qty = notional = risk_amount = None
        if entry > 0 and stop is not None and abs(entry - stop) > 0:
            risk_amount = pf.equity * L.risk_per_trade_pct / 100
            qty = risk_amount / abs(entry - stop)
            qty = min(qty, pf.equity * L.max_position_pct / 100 / entry, max(pf.cash, 0) / entry)
            if asset_class == "equity":
                qty = math.floor(qty)
            notional = qty * entry
            risk_amount = qty * abs(entry - stop)
        check("position_size", bool(qty and qty > 0), f"{qty:.6g} Einheiten, {notional:,.0f} Nominal" if qty else "Positionsgröße 0")

        # Liquiditaet
        if asset_class == "equity":
            adv = fs.values["adv_usd_20d"].raw if fs.has("adv_usd_20d") else None
            check("liquidity_adv", adv is not None and adv >= L.min_adv_usd_equity,
                  f"Durchschnittlicher Tagesumsatz {adv:,.0f} USD" if adv else "Tagesumsatz unbekannt")
            if adv and notional:
                share = notional / adv * 100
                check("share_of_adv", share <= L.max_share_of_adv_pct, f"Position = {share:.3f} % des Tagesumsatzes")
            atr_pct = fs.values["atr_pct"].raw if fs.has("atr_pct") else None
            check("volatility", atr_pct is not None and atr_pct <= L.max_atr_pct_equity,
                  f"ATR {atr_pct:.2f} % des Kurses" if atr_pct is not None else "ATR unbekannt")
            check("event_risk", True, "Nicht prüfbar: kein Termin-/Earnings-Kalender angebunden.")
            check("gap_risk", True, "Tagesbasis: Übernacht-Lücken können den Stop überspringen; im Paper-Fill berücksichtigt.")
        else:
            qv = fs.values["quote_volume_24h"].raw if fs.has("quote_volume_24h") else None
            check("liquidity_volume", qv is not None and qv >= L.min_quote_volume_24h_crypto,
                  f"24-h-Umsatz {qv:,.0f}" if qv else "24-h-Umsatz unbekannt")
            spread = fs.values["spread_bps"].raw if fs.has("spread_bps") else None
            check("spread", spread is not None and spread <= L.max_spread_bps_crypto,
                  f"Spread {spread:.2f} bps" if spread is not None else "Spread unbekannt")
            depth = fs.values["book_depth_10bps_quote"].raw if fs.has("book_depth_10bps_quote") else None
            check("book_depth", depth is not None and notional is not None and depth >= L.min_depth_multiple_crypto * notional,
                  f"Orderbuchtiefe ±10 bps {depth:,.0f} vs. Position {notional or 0:,.0f}" if depth is not None else "Orderbuch unbekannt")
            rv = fs.values["realized_vol_60m_pct"].raw if fs.has("realized_vol_60m_pct") else None
            check("volatility", rv is not None and rv <= L.max_realized_vol_crypto_pct,
                  f"Realisierte Volatilität {rv:.0f} % p. a." if rv is not None else "Volatilität unbekannt")

        # Portfolio
        open_ids = {p.instrument_id for p in pf.positions}
        check("no_duplicate", ev.instrument_id not in open_ids, "bereits offene Position oder ausstehende Order" if ev.instrument_id in open_ids else "keine offene Position")
        check("max_positions", len(pf.positions) < L.max_open_positions, f"{len(pf.positions)} von {L.max_open_positions} Positionen offen")
        gross = sum(p.notional for p in pf.positions) + (notional or 0)
        check("gross_exposure", gross <= pf.equity * L.max_gross_exposure_pct / 100 + 1e-9,
              f"Brutto-Exposure danach {gross / pf.equity * 100:.1f} % (max. {L.max_gross_exposure_pct} %)")
        if asset_class == "crypto":
            crypto = sum(p.notional for p in pf.positions if p.asset_class == "crypto") + (notional or 0)
            check("correlated_exposure", crypto <= pf.equity * L.max_crypto_exposure_pct / 100 + 1e-9,
                  f"Krypto-Exposure danach {crypto / pf.equity * 100:.1f} % (max. {L.max_crypto_exposure_pct} %)")

        approved = all(c.passed for c in checks)
        return RiskAssessment(approved, tuple(checks), round(rr, 4) if rr else None, qty if approved else None,
                              notional if approved else None, risk_amount if approved else None, RISK_VERSION)


def final_decision(ev: StrategyEvaluation, risk: RiskAssessment) -> Decision:
    if ev.decision in (Decision.LONG_CANDIDATE, Decision.SHORT_CANDIDATE) and not risk.approved:
        return Decision.REJECTED_BY_RISK
    return ev.decision
