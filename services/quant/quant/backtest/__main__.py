"""
Kommandozeile:
  python -m quant.backtest --scope equity_us --daily-dir data/daily --tickers SPY,AAPL,MSFT --start 2024-01-01 --end 2026-06-30
  python -m quant.backtest --scope crypto --klines data/BTCUSDT-1m.csv --symbol BTCUSDT --start ... --end ... [--idealized]
  python -m quant.backtest --scope crypto --from-db --symbol BTCUSDT --start ... --end ...   (Replay der eigenen Aufzeichnung)
BACKTEST_ADMIN_URL: Postgres-Verbindung mit CREATEDB-Recht (je Lauf eine eigene Datenbank).
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from ..execution import IDEALIZED, REALISTIC
from .dataset import HistoricalDataset, from_database, read_binance_klines_csv, read_daily_csv
from .engine import Backtest, BacktestConfig
from .report import render_markdown


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", choices=["crypto", "equity_us"], required=True)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--symbol", default="BTCUSDT")
    ap.add_argument("--klines")
    ap.add_argument("--daily-klines", help="1d-Klines fuer das Krypto-Regime")
    ap.add_argument("--daily-dir")
    ap.add_argument("--tickers", default="SPY")
    ap.add_argument("--from-db", action="store_true")
    ap.add_argument("--idealized", action="store_true")
    ap.add_argument("--out", default="backtest-report")
    a = ap.parse_args()
    start = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(a.end).replace(tzinfo=timezone.utc)
    tickers = [t.strip().upper() for t in a.tickers.split(",") if t.strip()]
    if a.from_db:
        from ..config import load_settings
        from ..db import connect
        with connect(load_settings().database_url) as c:
            ds = from_database(c, crypto_symbols=[a.symbol], equity_tickers=tickers, start=start, end=end)
    else:
        ds = HistoricalDataset()
        if a.klines:
            ds.add_spot(a.symbol, "1m", read_binance_klines_csv(a.klines, "1m"), f"file:{a.klines}")
        if a.daily_klines:
            ds.add_spot(a.symbol, "1d", read_binance_klines_csv(a.daily_klines, "1d"), f"file:{a.daily_klines}")
        if a.daily_dir:
            for t in tickers:
                ds.add_equity(t, read_daily_csv(Path(a.daily_dir) / f"{t}.csv"), f"file:{a.daily_dir}/{t}.csv")
    cfg = BacktestConfig(scope=a.scope, start=start, end=end, crypto_symbols=(a.symbol,), equity_symbols=tuple(t for t in tickers if t != "SPY"),
                         execution=IDEALIZED if a.idealized else REALISTIC)
    res = Backtest(ds, cfg).run(os.environ["BACKTEST_ADMIN_URL"])
    Path(f"{a.out}.json").write_text(json.dumps(res.report, indent=2, default=str))
    Path(f"{a.out}.md").write_text(render_markdown(res.report))
    print(f"Report: {a.out}.md / {a.out}.json - Datenbank des Laufs: {res.database}")


if __name__ == "__main__":
    main()
