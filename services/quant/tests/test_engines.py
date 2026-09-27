from datetime import datetime, timedelta, timezone

import pytest

from quant.domain import Decision, FeatureSet, FeatureValue, RegimeState
from quant.paper import COSTS, check_exit, crypto_market_fill, equity_open_fill, session_open, walk_book
from quant.providers.base import Bar, OrderBook
from quant.regime import crypto_regime, equity_regime
from quant.risk import OpenPosition, PortfolioView, RiskEngine, final_decision
from quant.strategies import (CryptoMomentumFundingOI, CryptoSpotPerpDivergence, EquityBreakoutMomentum, EquityRelativeStrength,
                              EquityVolumeAnomaly, StrategyRegistry)
from tests.helpers import daily

NOW = datetime(2026, 9, 22, 21, 0, tzinfo=timezone.utc)
RISK_ON = RegimeState("equity_us", ("TRENDING_UP", "NORMAL_VOLATILITY", "RISK_ON"), "", {}, "r", NOW)
RISK_OFF = RegimeState("equity_us", ("TRENDING_DOWN", "HIGH_VOLATILITY", "RISK_OFF"), "", {}, "r", NOW)
CRYPTO = RegimeState("crypto", ("TRENDING_UP", "NORMAL_VOLATILITY", "RISK_ON"), "", {}, "r", NOW)


def fs_of(values: dict, freshness="end_of_day", zscores=None) -> FeatureSet:
    fs = FeatureSet("ins_test", NOW)
    for k, v in values.items():
        fs.add(FeatureValue(k, v, NOW, ("t",), freshness, zscore=(zscores or {}).get(k)))
    return fs


BREAKOUT = {"close": 110.0, "breakout_20d": 1.0, "donchian20_high": 108.0, "rvol_20d": 2.5, "dist_sma50_pct": 6.0,
            "dist_sma200_pct": 15.0, "atr_14": 2.0, "rel_strength_20d_pp": 8.0, "adv_usd_20d": 5e8, "atr_pct": 1.8}


# --- Regime ---------------------------------------------------------------
def test_regime_uptrend_and_insufficient_data():
    up = daily([100 * 1.002 ** i for i in range(400)])
    r = equity_regime(up, {}, up[-1].ts + timedelta(days=1))
    assert "TRENDING_UP" in r.labels and "Marktbreite nicht berechnet" in r.explanation
    short = crypto_regime(daily([100.0] * 50), None, NOW)
    assert "INSUFFICIENT_DATA" in short.labels


def test_regime_flags_crowded_leverage():
    btc = daily([100 * 1.001 ** i for i in range(400)])
    assert "LEVERAGE_ELEVATED" in crypto_regime(btc, 2.5, btc[-1].ts + timedelta(days=1)).labels


# --- Strategien -----------------------------------------------------------
def test_breakout_candidate_and_points_explain_strength():
    ev = EquityBreakoutMomentum().evaluate(fs_of(BREAKOUT), RISK_ON)
    assert ev.decision == Decision.LONG_CANDIDATE
    total = sum(e.points or 0 for e in ev.positive) + sum(e.points or 0 for e in ev.negative)
    assert abs(total - ev.strength) < 1e-6  # Erklaerung = Berechnung
    assert ev.invalidation.level < ev.reference_price < ev.exit_plan.target_price


def test_breakout_in_risk_off_is_only_watch_with_reason():
    ev = EquityBreakoutMomentum().evaluate(fs_of(BREAKOUT), RISK_OFF)
    assert ev.decision == Decision.WATCH
    assert ev.summary.startswith("Setup interessant, aber Bestätigung fehlt")
    assert "Marktregime risikoscheu oder im Abwärtstrend" in ev.reasons


def test_missing_or_stale_data_gives_no_trade():
    partial = {k: v for k, v in BREAKOUT.items() if k != "rvol_20d"}
    ev = EquityBreakoutMomentum().evaluate(fs_of(partial), RISK_ON)
    assert ev.decision == Decision.NO_TRADE and "rvol_20d" in ev.reasons[0]
    stale = EquityBreakoutMomentum().evaluate(fs_of(BREAKOUT, freshness="stale"), RISK_ON)
    assert stale.decision == Decision.NO_TRADE and "Daten zu alt" in stale.summary


def test_no_edge_is_a_valid_result():
    quiet = {**BREAKOUT, "breakout_20d": 0.0, "rvol_20d": 0.9, "rel_strength_20d_pp": -1.0}
    ev = EquityBreakoutMomentum().evaluate(fs_of(quiet), RISK_ON)
    assert ev.decision == Decision.NO_TRADE and ev.summary == "Derzeit kein ausreichender Vorteil erkennbar."


def test_relative_strength_and_volume_anomaly():
    rs = EquityRelativeStrength().evaluate(fs_of({"close": 50.0, "rel_strength_20d_pp": 5.0, "rel_strength_63d_pp": 14.0,
                                                  "dist_sma50_pct": 5.0, "atr_14": 1.0}), RISK_ON)
    assert rs.decision == Decision.LONG_CANDIDATE
    flat = EquityVolumeAnomaly().evaluate(fs_of({"close": 50.0, "rvol_20d": 4.0, "day_return_pct": 0.3, "atr_14": 1.0,
                                                 "dist_sma50_pct": 2.0}), RISK_ON)
    assert flat.decision == Decision.WATCH
    assert "Hohes Volumen ohne klare Richtung (unter 1 %)" in flat.reasons
    assert any("Auslöser unbekannt" in e.text and e.points is None for e in flat.negative)


CRYPTO_DIV = {"close": 60000.0, "spot_cvd_60m_share": 0.15, "perp_cvd_60m_share": -0.05, "perp_basis_bps": 1.0,
              "ret_60m_pct": 0.4, "realized_vol_60m_pct": 40.0, "spread_bps": 0.2, "quote_volume_24h": 1e9,
              "book_depth_10bps_quote": 5e6}


def test_crypto_divergence_candidate_and_spread_rejection():
    ev = CryptoSpotPerpDivergence().evaluate(fs_of(CRYPTO_DIV, "under_1_min"), CRYPTO)
    assert ev.decision == Decision.LONG_CANDIDATE and ev.horizon == "intraday"
    wide = CryptoSpotPerpDivergence().evaluate(fs_of({**CRYPTO_DIV, "spread_bps": 12.0}, "under_1_min"), CRYPTO)
    assert wide.decision != Decision.LONG_CANDIDATE
    eod = CryptoSpotPerpDivergence().evaluate(fs_of(CRYPTO_DIV, "end_of_day"), CRYPTO)
    assert eod.decision == Decision.NO_TRADE  # Intraday-Strategie braucht Intraday-Daten


def test_crowded_funding_blocks_momentum():
    base = {"close": 3000.0, "ret_240m_pct": 2.5, "ret_60m_pct": 0.5, "oi_change_60m_pct": 3.0, "funding_rate_8h": 0.0005,
            "realized_vol_60m_pct": 50.0, "dist_vwap_60m_pct": 0.4}
    ok = CryptoMomentumFundingOI().evaluate(fs_of(base, "under_1_min", {"funding_rate_8h": 0.5}), CRYPTO)
    assert ok.decision == Decision.LONG_CANDIDATE
    crowded = CryptoMomentumFundingOI().evaluate(fs_of(base, "under_1_min", {"funding_rate_8h": 3.0}), CRYPTO)
    assert crowded.decision == Decision.WATCH and any("überfüllt" in r for r in crowded.reasons)


def test_registry_version_changes_with_strategy_version():
    reg = StrategyRegistry()
    assert len(reg.specs()) == 5 and reg.version.startswith("registry-")
    assert {s.spec.strategy_id for s in reg.for_asset_class("crypto")} == {"crypto_spot_perp_divergence", "crypto_momentum_funding_oi"}


# --- Risk -----------------------------------------------------------------
PF = PortfolioView(equity=100_000, cash=100_000, positions=())


def test_strong_signal_can_be_rejected_by_risk():
    ev = EquityBreakoutMomentum().evaluate(fs_of(BREAKOUT), RISK_ON)
    fs = fs_of({**BREAKOUT, "adv_usd_20d": 1e6})  # zu illiquide
    risk = RiskEngine().assess(ev, fs, "equity", PF)
    assert not risk.approved and final_decision(ev, risk) == Decision.REJECTED_BY_RISK
    assert any(c.name == "liquidity_adv" and not c.passed for c in risk.checks)


def test_position_sizing_uses_risk_per_trade():
    ev = EquityBreakoutMomentum().evaluate(fs_of(BREAKOUT), RISK_ON)
    risk = RiskEngine().assess(ev, fs_of(BREAKOUT), "equity", PF)
    assert risk.approved, [c for c in risk.checks if not c.passed]
    assert risk.risk_amount <= 500 + 1e-6 and risk.position_quantity == int(risk.position_quantity)
    assert risk.position_notional <= 10_000 + 1e-6


def test_kill_switch_and_concentration():
    ev = CryptoSpotPerpDivergence().evaluate(fs_of(CRYPTO_DIV, "under_1_min"), CRYPTO)
    halted = RiskEngine().assess(ev, fs_of(CRYPTO_DIV, "under_1_min"), "crypto", PortfolioView(100_000, 100_000, (), "Tagesverlustlimit"))
    assert not halted.approved
    full = PortfolioView(100_000, 70_000, (OpenPosition("ins_eth", "crypto", 29_000),))
    conc = RiskEngine().assess(ev, fs_of(CRYPTO_DIV, "under_1_min"), "crypto", full)
    assert any(c.name == "correlated_exposure" and not c.passed for c in conc.checks)


def test_watch_is_not_touched_by_risk():
    ev = EquityBreakoutMomentum().evaluate(fs_of(BREAKOUT), RISK_OFF)
    risk = RiskEngine().assess(ev, fs_of(BREAKOUT), "equity", PF)
    assert final_decision(ev, risk) == ev.decision


# --- Paper-Fills ----------------------------------------------------------
def test_market_buy_walks_the_book_and_pays_fees():
    book = OrderBook(bids=[(99.9, 5)], asks=[(100.1, 1), (100.3, 1)], ts=NOW)
    f = crypto_market_fill("buy", 1.5, book, None, None, NOW)
    assert abs(f.price - (100.1 + 0.5 * 100.3) / 1.5) < 1e-9 and f.price > 100.0
    assert f.slippage_bps > 0 and abs(f.fee - f.price * 1.5 * 0.001) < 1e-9
    assert crypto_market_fill("buy", 50, book, None, None, NOW) is None  # Buch traegt die Groesse nicht
    assert walk_book([], 1) == (None, 0.0)


def test_equity_fill_at_next_open_with_costs_and_dst():
    bar = Bar(ts=datetime(2026, 7, 1, tzinfo=timezone.utc), open=100, high=101, low=99, close=100.5, volume=1, is_final=True)
    f = equity_open_fill("buy", 10, bar)
    assert f.price == pytest.approx(100 * 1.001) and f.filled_at == datetime(2026, 7, 1, 13, 30, tzinfo=timezone.utc)
    winter = Bar(ts=datetime(2026, 12, 1, tzinfo=timezone.utc), open=1, high=1, low=1, close=1, volume=1, is_final=True)
    assert session_open(winter).hour == 14


def test_exit_gap_and_same_bar_conflict_are_conservative():
    t = datetime(2026, 9, 1, tzinfo=timezone.utc)
    gap = [Bar(ts=t, open=90, high=95, low=89, close=94, volume=1, is_final=True)]
    ev = check_exit("long", 95, 110, None, gap, timedelta(days=1), True)
    assert ev.reason == "stop" and ev.reference_price == 90 and ev.gap
    both = [Bar(ts=t, open=100, high=111, low=94, close=105, volume=1, is_final=True)]
    assert check_exit("long", 95, 110, None, both, timedelta(days=1), True).reason == "stop"
    calm = [Bar(ts=t, open=100, high=101, low=99, close=100, volume=1, is_final=True)]
    assert check_exit("long", 95, 110, t, calm, timedelta(days=1), True).reason == "time"
    assert COSTS["crypto"].fee_bps == 10.0
