from datetime import timedelta

from quant.features import (CryptoInputs, EquityInputs, crypto_features, cvd, equity_features, final_bars, percentile_rank,
                            rvol_time_of_day)
from quant.providers.base import Bar
from tests.helpers import T0, daily, minutes


def test_open_and_future_bars_never_enter_features():
    bars = daily([100 + i for i in range(10)])
    as_of = bars[5].ts + timedelta(days=1)
    kept = final_bars(bars, as_of, timedelta(days=1))
    assert kept[-1].ts == bars[5].ts
    open_bar = Bar(ts=bars[6].ts, open=1, high=1, low=1, close=1, volume=1, is_final=False)
    assert open_bar not in final_bars([*bars[:6], open_bar], as_of + timedelta(days=5), timedelta(days=1))


def test_equity_breakout_and_relative_strength():
    closes = [100.0] * 80 + [100 + i * 0.5 for i in range(1, 21)] + [115.0]
    vols = [1_000_000] * (len(closes) - 1) + [3_000_000]
    bench = daily([100.0 + i * 0.05 for i in range(len(closes))])
    bars = daily(closes, vols)
    fs = equity_features(EquityInputs("ins_x", bars, bench, "stooq", bars[-1].ts + timedelta(days=1)))
    assert fs.raw("breakout_20d") == 1.0
    assert abs(fs.raw("rvol_20d") - 3.0) < 1e-9
    assert fs.raw("rel_strength_20d_pp") > 10
    assert fs.values["close"].freshness == "end_of_day"


def test_equity_with_short_history_is_unavailable_not_guessed():
    fs = equity_features(EquityInputs("ins_x", daily([100.0] * 30), daily([100.0] * 30), "stooq", T0 + timedelta(days=40)))
    assert fs.values == {} and "*" in fs.unavailable


def test_rvol_compares_same_time_of_day():
    # 6 Tage Minutenbalken; zwischen 10:00 und 11:00 normalerweise 10, heute 30
    bars = []
    for d in range(6):
        for m in range(24 * 60):
            ts = T0 + timedelta(days=d, minutes=m)
            v = 30.0 if d == 5 and 600 <= m < 660 else 10.0
            bars.append(Bar(ts=ts, open=1, high=1, low=1, close=1, volume=v, is_final=True))
    cut = [b for b in bars if b.ts < T0 + timedelta(days=5, minutes=660)]
    rv, days = rvol_time_of_day(cut, timedelta(minutes=60))
    assert days == 5 and abs(rv - 3.0) < 1e-9


def test_cvd_and_percentile():
    assert cvd(minutes([1.0] * 3, buy_share=0.75)) == 3 * (2 * 7.5 - 10)
    assert percentile_rank(10, list(range(20))) == 52.5


def test_crypto_features_mark_missing_derivatives_as_unavailable():
    spot = minutes([100 + (i % 7) * 0.01 for i in range(600)], buy_share=0.6)
    as_of = spot[-1].ts + timedelta(minutes=1, seconds=5)
    fs = crypto_features(CryptoInputs("ins_btc", spot, [], None, None, None, None, [], [], "binance", as_of))
    assert fs.raw("spot_cvd_60m_share") > 0.19
    assert "funding_rate_8h" in fs.unavailable and "perp_basis_bps" in fs.unavailable and "spread_bps" in fs.unavailable
    assert fs.values["close"].freshness == "under_1_min"


def test_quality_layer_rejects_broken_bars_with_reason():
    from datetime import datetime, timezone
    from quant.quality import validate_bars
    now = datetime(2026, 9, 22, tzinfo=timezone.utc)
    good = daily([100.0, 101.0, 102.0])
    broken = [
        Bar(ts=good[0].ts + timedelta(hours=1), open=-1, high=1, low=-2, close=1, volume=1, is_final=True),
        Bar(ts=good[1].ts, open=101, high=101, low=101, close=101, volume=1, is_final=True),  # Duplikat
        Bar(ts=now + timedelta(days=3), open=1, high=1, low=1, close=1, volume=1, is_final=True),
        Bar(ts=good[2].ts + timedelta(hours=1), open=300, high=300, low=300, close=300, volume=1, is_final=True),
    ]
    ok, bad = validate_bars([*good, *broken], now)
    assert [b.close for b in ok] == [100.0, 101.0, 102.0]
    assert {r.reason.split(" ")[0] for r in bad} >= {"Preis", "Doppelter", "Zeitstempel", "Sprung"}
