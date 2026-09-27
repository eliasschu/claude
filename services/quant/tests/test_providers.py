from datetime import datetime, timezone

import httpx
import pytest

from quant.providers.base import CryptoMarketProvider, MarketDataProvider, NotConfiguredError, ProviderError
from quant.providers.binance import BinanceProvider, parse_funding, parse_klines
from quant.providers.coinbase import CoinbaseProvider, parse_candles, product_id
from quant.providers.registry import default_providers
from quant.providers.stooq import StooqProvider, parse_csv

NOW = datetime(2026, 9, 22, 12, 0, 30, tzinfo=timezone.utc)
T0 = int(datetime(2026, 9, 22, 11, 59, tzinfo=timezone.utc).timestamp() * 1000)
T1 = T0 + 60_000

# Aufbau laut Binance-Dokumentation (GET /api/v3/klines)
KLINES = [
    [T0, "100.0", "101.0", "99.5", "100.5", "12.0", T0 + 59_999, "1206.0", 40, "7.0", "703.5", "0"],
    [T1, "100.5", "100.9", "100.1", "100.8", "3.0", T1 + 59_999, "302.0", 11, "1.0", "100.8", "0"],
]


def fake(routes: dict[str, object], status: int = 200):
    def send(url, params, headers):
        for key, body in routes.items():
            if key in url:
                if isinstance(body, str):
                    return httpx.Response(status, text=body, headers={"date": "Tue, 22 Sep 2026 12:00:30 GMT"})
                return httpx.Response(status, json=body, headers={"date": "Tue, 22 Sep 2026 12:00:30 GMT"})
        return httpx.Response(404)
    return send


def test_klines_mark_open_bar_as_not_final():
    bars = parse_klines(KLINES, NOW)
    assert [b.is_final for b in bars] == [True, False]
    assert bars[0].taker_buy_volume == 7.0 and bars[0].trade_count == 40


def test_binance_provider_reports_last_final_bar_time_not_fetch_time():
    p = BinanceProvider(transport=fake({"/api/v3/klines": KLINES}))
    r = p.spot_bars("BTCUSDT", "1m", 2)
    assert r.observed_at == datetime(2026, 9, 22, 11, 59, tzinfo=timezone.utc)
    assert r.fetched_at == NOW
    assert isinstance(p, CryptoMarketProvider)


def test_funding_interval_is_derived_from_spacing():
    rows = parse_funding([
        {"symbol": "BTCUSDT", "fundingRate": "0.0001", "fundingTime": 1790000000000, "markPrice": "100"},
        {"symbol": "BTCUSDT", "fundingRate": "-0.0002", "fundingTime": 1790000000000 + 4 * 3600_000, "markPrice": ""},
    ])
    assert rows[1].interval_hours == 4.0 and rows[1].rate == -0.0002 and rows[1].mark_price is None


def test_region_block_is_not_retried_and_reads_as_not_configured():
    calls = []

    def send(url, params, headers):
        calls.append(url)
        return httpx.Response(451)

    with pytest.raises(ProviderError) as exc:
        BinanceProvider(transport=send).spot_quote("BTCUSDT")
    assert exc.value.reason == "not_configured" and len(calls) == 1


def test_stooq_csv_and_interface():
    csv = "Date,Open,High,Low,Close,Volume\n2026-09-18,10,11,9,10.5,1000\n2026-09-17,9,10,8.5,9.5,900\nkaputt,1,1,1,1,1\n"
    bars = parse_csv(csv)
    assert [b.close for b in bars] == [9.5, 10.5]
    p = StooqProvider(transport=fake({"stooq.com": csv}))
    assert isinstance(p, MarketDataProvider)
    r = p.bars("SPY", "1d")
    assert r.cadence == "end_of_day" and r.observed_at == bars[-1].ts
    with pytest.raises(ProviderError):
        p.bars("SPY", "1m")
    with pytest.raises(ProviderError) as exc:
        StooqProvider(transport=fake({"stooq.com": "No data"})).bars("XXXX", "1d")
    assert exc.value.reason == "not_found"


def test_coinbase_candles_and_symbols():
    assert product_id("BTCUSDT") == "BTC-USD"
    t = int(datetime(2026, 9, 22, 11, 59, tzinfo=timezone.utc).timestamp())
    bars = parse_candles([[t + 60, 1, 2, 1.5, 1.8, 5], [t, 1, 2, 1.2, 1.5, 4]], 60, NOW)
    assert [b.open for b in bars] == [1.2, 1.5] and [b.is_final for b in bars] == [True, False]
    with pytest.raises(NotConfiguredError):
        CoinbaseProvider(transport=fake({})).funding_history("BTCUSDT", 10)


def test_unconnected_data_types_say_so():
    p = default_providers()
    with pytest.raises(NotConfiguredError):
        p.options.chain("AAPL", None)
