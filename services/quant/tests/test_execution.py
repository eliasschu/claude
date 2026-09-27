from datetime import datetime, timedelta, timezone

import pytest

from quant.execution import IDEALIZED, REALISTIC, ExecutionModel, vol_1m_bps_from_annual_pct
from quant.paper import ExitEvent
from quant.providers.base import OrderBook

T = datetime(2026, 9, 22, tzinfo=timezone.utc)
BOOK = OrderBook(bids=[(99.9, 5)], asks=[(100.1, 1), (100.3, 1)], ts=T)


def test_idealized_vs_realistic():
    ideal = IDEALIZED.market_fill("buy", 1.5, book=BOOK, bid=None, ask=None, at=T, venue="binance", vol_1m_bps=None)
    real = REALISTIC.market_fill("buy", 1.5, book=BOOK, bid=None, ask=None, at=T, venue="binance", vol_1m_bps=None)
    assert ideal.price == pytest.approx(100.0) and ideal.fee == 0 and ideal.slippage_bps == 0
    assert real.price > ideal.price and real.fee > 0
    assert IDEALIZED.cost("crypto").delay == timedelta(0) and REALISTIC.cost("crypto").delay > timedelta(0)


def test_fees_per_venue_maker_taker_and_config():
    m = ExecutionModel.from_dict({"fees": {"binance": {"maker_bps": 2.0, "taker_bps": 5.0}}, "slippage_model": "fixed",
                                  "fixed_slippage_bps": {"crypto": 7.0}})
    assert m.cost("crypto", venue="binance").fee_bps == 5.0
    assert m.cost("crypto", venue="binance", liquidity="maker").fee_bps == 2.0
    assert m.cost("crypto", venue="coinbase").fee_bps == 60.0  # Standardtabelle bleibt fuer andere Plaetze
    target = m.exit("long", 1, ExitEvent("target", 110.0, T), "crypto", venue="binance")
    stop = m.exit("long", 1, ExitEvent("stop", 90.0, T), "crypto", venue="binance")
    assert target.fee == pytest.approx(110 * 2e-4) and target.price == 110.0     # Limit: Maker, keine Slippage
    assert stop.price < 90.0 and stop.fee == pytest.approx(stop.price * 5e-4)    # Market: Taker + Slippage


def test_volatility_slippage_grows_with_volatility():
    m = ExecutionModel(slippage_model="volatility")
    calm, wild = vol_1m_bps_from_annual_pct(20.0), vol_1m_bps_from_annual_pct(200.0)
    assert m.slippage_bps("crypto", wild) > m.slippage_bps("crypto", calm) > m.fixed_slippage_bps["crypto"]
    assert ExecutionModel(slippage_model="fixed").slippage_bps("crypto", wild) == 3.0


def test_orderbook_model_partial_fill_and_fallback():
    part = REALISTIC.market_fill("buy", 3.0, book=BOOK, bid=None, ask=None, at=T, venue="binance", vol_1m_bps=None)
    assert part.quantity == pytest.approx(2.0)  # Buch traegt 2 von 3 (>= 50 %) -> Teilausfuehrung
    assert REALISTIC.market_fill("buy", 10.0, book=BOOK, bid=None, ask=None, at=T, venue="binance", vol_1m_bps=None) is None
    no_book = REALISTIC.market_fill("buy", 1.0, book=None, bid=99.9, ask=100.1, at=T, venue="binance", vol_1m_bps=10.0)
    assert no_book.price > 100.1  # Rueckfall: Ask + volatilitaetsabhaengige Slippage
