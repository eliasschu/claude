# services/quant – Bot Core (Research / Paper)

Python-Dienst für Datenpipeline, Feature Engine, Marktregime, Strategien, Risk Engine, Paper Trading und das unveränderliche Signal-Protokoll. Das Next.js-Frontend liest nur über die interne API. Es rechnet selbst keine Signale.

> **Betriebsart:** Bis zur rechtlichen Prüfung nur `research` oder `paper`. `BOT_MODE=live` wird beim Start abgewiesen. Es gibt keinen Codepfad zu echten Orders.

## Dienste

| Dienst | Befehl | Aufgabe |
|---|---|---|
| `api` | `uvicorn quant.api:app` | Lesende Bot-API, geschützt mit `BOT_API_TOKEN` |
| `bot-worker` | `python -m quant.worker` | Krypto-Zyklus im Takt `CRYPTO_CYCLE_SECONDS`, läuft dauerhaft |
| `scheduler` | `python -m quant.scheduler` | Aktien-Zyklus einmal je US-Handelstag nach 18:15 New York; Ergebnisauflösung alle 5 Minuten |
| `postgres` | – | Wahrheit: Stammdaten, Balken, Point-in-Time-Beobachtungen, Signale, Ereignisse, Paper-Konto |
| `redis` | – | Live-Feed (Pub/Sub `bot:events`), nur Beschleuniger |

Alle Dienste migrieren beim Start. Eine Advisory-Sperre verhindert, dass zwei Dienste gleichzeitig migrieren.

**Lokal auf dem Mac, ohne Server:** `./bot-lokal.sh einrichten && ./bot-lokal.sh start` (siehe `docs/lokal-mac.md`). Erkennungen gibt es nur, solange der Rechner wach und online ist.

```bash
cp services/quant/.env.example services/quant/.env   # BOT_API_TOKEN setzen
docker compose up -d                                   # postgres, redis, api, bot-worker, scheduler
curl -H "Authorization: Bearer $BOT_API_TOKEN" localhost:8000/bot/status
```

## Ablauf eines Zyklus

```
DATA → NORMALIZATION → DATA QUALITY → FEATURES → MARKET REGIME
     → STRATEGY SIGNALS → SIGNAL STRENGTH → RISK ENGINE → PAPER DECISION → AUDIT LOG
```

| Baustein | Datei |
|---|---|
| BotOrchestrator | `quant/orchestrator.py` |
| Provider-Interfaces (9) + Binance, Coinbase, Stooq | `quant/providers/` |
| Data Quality Layer | `quant/quality.py` |
| DataFreshnessService | `quant/freshness.py` (gleiche Klassen wie `src/lib/core/freshness.ts`) |
| FeatureEngine | `quant/features.py` |
| MarketRegimeEngine | `quant/regime.py` |
| StrategyRegistry + 5 Strategien | `quant/strategies.py` |
| RiskEngine | `quant/risk.py` |
| PaperPortfolio | `quant/paper.py` |
| SignalAuditService | `quant/audit.py` |
| BotEventLog | `quant/events.py` |
| ProviderHealthService + Kill Switch | `quant/health.py` |
| Ergebnisauflösung (1h…20d, MFE/MAE, Benchmark) | `quant/outcomes.py` |

## Entscheidungen

`LONG_CANDIDATE`, `SHORT_CANDIDATE`, `WATCH`, `NO_TRADE` und `REJECTED_BY_RISK`.

- Eine Strategie liefert höchstens einen Kandidaten. Erst die Risk Engine entscheidet über den Paper-Trade.
- `REJECTED_BY_RISK` vergibt nur die Risk Engine. Das Signal bleibt mit allen fehlgeschlagenen Prüfungen sichtbar.
- Die **Signalstärke ist keine Wahrscheinlichkeit.** Sie ist die Summe offengelegter Punkte, und jeder Punkt steht an genau einem Evidence-Eintrag.

## Backtest (gleicher Kern wie Paper)

Der Backtest startet den unveränderten `BotOrchestrator` mit Simulationsuhr und Replay-Providern. Jeder Lauf bekommt eine eigene Datenbank. Kosten modelliert `quant/execution.py`: `REALISTIC` ist der Standard, `IDEALIZED` dient nur dem Vergleich. Gebühren sind je Handelsplatz über `EXECUTION_CONFIG` (JSON) einstellbar.

```bash
BACKTEST_ADMIN_URL=postgresql://quant:quant@localhost:5432/postgres \
python -m quant.backtest --scope crypto --klines data/BTCUSDT-1m.csv --symbol BTCUSDT --start 2025-01-01 --end 2026-06-30
```

Der Report (`.md` und `.json`) enthält Kennzahlen je Train-, Validation- und OOS-Segment, Kosten, Forward Returns, MFE/MAE, Benchmark und Warnungen. Einzelne Trades erklärt `GET /trades/{id}/explain`. Details stehen in `docs/architektur/02-produktion-daten-backtest.md`.

## Tests

```bash
pip install -e ".[dev]"
TEST_ADMIN_DATABASE_URL=postgresql://quant:quant@localhost:5432/quant_test pytest -q
ruff check quant tests && mypy quant
```

Die Datenbanktests legen je Test eine frische Datenbank an. Die Rolle braucht dafür `CREATEDB`. Ohne erreichbare Datenbank werden diese Tests übersprungen.
