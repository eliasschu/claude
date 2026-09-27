# Phase 3: Produktionsbetrieb, Datenquellen, Backtest

Stand: 27.09.2026 · Betriebsart: **RESEARCH / PRIVATE / PAPER** · `LIVE_TRADING=true` bricht den Start ab · Code: `services/quant/`

Das Vorgehen war: wiederverwenden, prüfen, umbauen, erweitern. Es gab keinen Neuanfang. Jede Teilphase endet mit Tests, ruff und mypy.

**Gesamtergebnis der Qualitätsprüfung (Commit `83ac8aa`):**
- Python: 151 Tests grün, `ruff check` ohne Befund, `mypy quant` ohne Befund (64 Dateien).
- Next.js: 166 Tests grün, Typecheck OK. Die 7 ESLint-Befunde stammen aus der Zeit vor dieser Phase. Das Frontend blieb in dieser Phase unverändert.

---

## 1–2 Analyse und Absicherung der Fehler A–F (`968a726`)

| Fehler | Absicherung | Test |
|---|---|---|
| A Migrations-Race | Die Advisory-Sperre wird **vor** `schema_migrations` genommen | `test_step2_fixes`: parallele Migration |
| B Migrationen fehlen | Sie liegen im Paket (`quant/migrations/`). Fehlt der Ordner oder ist er leer, ist das ein **harter Fehler** | ebenda |
| C DB-Uhr | Die Defaults für `received_at`/`known_since` sind entfernt. Die Zeit kommt immer aus der Bot- oder Simulationsuhr | Schema- und Repo-Tests |
| D Aktualität | Jede Datenklasse hat eine eigene Richtlinie (`freshness.py`). Funding gilt als aktuell bis Intervall × 2 + 1 h | `test_step2_fixes` |
| E Doppelte Einstiege | Vier Ebenen: Strategie → Risk (offene, ausstehende und teilgefüllte Orders, Positionen, reservierte Exposure) → Orderstatus mit Advisory-Sperre → DB-Unique-Index und Trigger | paralleler Einstiegstest |
| F Anbieterausfall | Paralleler Abruf mit Timeouts, Circuit Breaker (nur bei `unavailable`/`rate_limited`), begrenzten Retries, Backoff mit Jitter, Coinbase als Fallback und Last-Known-Good mit Kennzeichnung `stale` | `test_faults` |

## 3 Production/Shadow Mode (`8f6e60f`)

- **CHANGED:** Die Flags `live_data` und `shadow_execution` sind neu. Shadow-Ausführungen speichern die konkreten Kostenannahmen, der Resolver rekonstruiert sie. `LIVE_TRADING=true` wird abgewiesen.
- **TESTED:** `test_shadow`.
- **RESULT:** Signale lassen sich mit Echtdaten beobachten, ohne echte Orders.

## 4 Health, Logging, Metriken, Deployment (`29812af`)

- **CHANGED:**
  - `/health/ready` liefert HEALTHY, DEGRADED oder UNHEALTHY. Fällt ein Anbieter aus und ein Ersatz funktioniert, lautet der Status DEGRADED.
  - Heartbeats je Dienst.
  - JSON-Logs, in denen Secrets geschwärzt werden.
  - Prometheus-Metriken auf `/metrics` (mit Token).
  - Docker Compose für Hetzner: Postgres ohne Port, API nur auf 127.0.0.1, Caddy als Proxy, Backup-Skript.
- **TESTED:** `test_health`, `test_logs`.

## 5–8 Krypto-WebSockets (`a98ac69`)

- **CHANGED:**
  - Neu: `quant/ws/` mit Normalizer, Bus, Client (stop-fähig, Stale-Erkennung) und Ingestor.
  - Trades werden zu `trade_flow_1s` aggregiert.
  - Das lokale Orderbuch entsteht aus Snapshot und Deltas. Die Sequenzen werden nach Binance-Spec geprüft (Spot und Futures). Bei einer Lücke oder einem gekreuzten Buch wird das Buch invalidiert und sofort neu synchronisiert, mit wachsendem Backoff.
  - Liquidationen.
  - Der SignalGate verlangt 2 Bestätigungen, hat eine Exit-Hysterese und eine Abkühlzeit.
- **TESTED:** `test_ws_*`, `test_signal_gate`.
- **LIMITATION:** Nur gegen nachgebildete Streams getestet. In dieser Umgebung gab es keinen Netzzugang zu den Börsen.

## 9–11 SEC Form 4, 13F, 13D/G (`dd0e811`)

- **CHANGED:**
  - Form-4-Klassifikation mit Fußnotenkontext: 10b5-1, Sell-to-Cover, DRIP/ESPP, Trust, Schenkung.
  - 13F-Bestände und -Änderungen.
  - Schedule 13D/G.
  - Die Acceptance Time wird konservativ als New-York-Zeit gelesen.
  - Getrennte Modi für `received_at`: `live` und `historical`.
- **TESTED:** `test_sec_form4`, `test_sec_ingest` mit Fixture.

## 12–13 FRED/ALFRED und CFTC (`a928a3b`)

- **CHANGED:**
  - FRED-Werte werden als Vintage gespeichert. Es zählt der Wert, der zum Zeitpunkt bekannt war, nicht die spätere Revision.
  - CFTC COT gilt konservativ ab Montag 15:30 New York als verfügbar. Für Shutdown-Verschiebungen gibt es Overrides.
- **TESTED:** `test_fred`, `test_cftc`.

## 14–20 Backtest (`83ac8aa`)

**CHANGED**

| Schritt | Umsetzung | Datei |
|---|---|---|
| 14 Historical Replay | Replay-Provider hinter **denselben** Provider-Interfaces. Sie liefern nur, was zur Simulationszeit veröffentlicht war: keine offenen Balken, kein künftiges Funding, Tagesbalken erst ab 18:00 New York | `backtest/replay.py`, `dataset.py` |
| 15 Gemeinsamer Strategiekern | Der Backtest startet den **unveränderten** `BotOrchestrator` mit `SimClock`, in einer eigenen Datenbank je Lauf. Signale, Audit-Log und Hash-Kette sind dieselben wie im Paper-Betrieb | `backtest/engine.py` |
| 16 Risk Engine | Läuft unverändert mit. Neu ist die Tagesverlustgrenze je Strategie | `risk.py` |
| 17 Ausführungsmodell | Modi `REALISTIC` und `IDEALIZED`. Maker/Taker-Gebühren je Handelsplatz sind über `EXECUTION_CONFIG` einstellbar. Slippage-Modelle `fixed`, `volatility` und `orderbook` (Level für Level). Dazu Teilausführung (`min_fill_ratio`) und Latenz. Ziel-Limits zahlen Maker-, Stops Taker-Gebühren | `execution.py` |
| 18 Reports | Gesamt- und annualisierte Rendite, Sharpe, Sortino, Max DD, Calmar, Trefferquote, PF, Erwartungswert, Ø Gewinn/Verlust, Payoff, Trades, Exposure, Turnover, Gebühren, Slippage, Forward Returns 1h/4h/1d/3d/7d/30d, MFE/MAE, Benchmark. Ratios erst ab 5 Trades | `backtest/report.py` |
| 19 Train/Validation/OOS | Kennzahlen je Segment, Benchmark je Segment | ebenda |
| 20 Walk-Forward | Fenster rollen, je Fenster ein Lauf, Stabilitätsübersicht. **Keine Optimierung** | `backtest/walkforward.py` |
| Erklärbarkeit | `GET /trades/{id}/explain` und `explain_trade()` liefern Signal, Gegenargumente, Eingangsmerkmale, Risk-Entscheidung, Orders, Fills, Kosten und Versionen | `backtest/explain.py` |

**Automatische Warnungen im Report:**
- weniger als 30 Trades;
- Zeitraum unter 30 Tagen (intraday) bzw. unter 365 Tagen;
- 8 oder mehr Bedingungen (Überanpassungsrisiko);
- extrem schmale Bedingungen;
- Train und OOS widersprechen sich beim Vorzeichen des Erwartungswerts;
- Sharpe-Differenz über 1;
- keine OOS-Trades.

**TESTED** (`test_backtest`, `test_execution`)
- Replay gibt nie offene Balken, künftiges Funding oder unfertiges Open Interest heraus.
- **Vergiftungstest:** Absichtlich falsche Zukunftsdaten ändern keine vergangene Entscheidung.
- Der Backtest nutzt den Live-Kern und speichert die Versionen.
- Jeder Trade ist erklärbar.
- REALISTIC ist nie besser als IDEALIZED.
- Gebühren je Handelsplatz, Volatilitäts-Slippage, Orderbuch-Teilausführung, Walk-Forward-Fenster, Krypto-Intraday mit Funding.

**RESULT**
- Die Frage, ob ein Signal nur Information nutzte, die zum Zeitpunkt verfügbar war, wird strukturell beantwortet: durch dieselben Interfaces, die Simulationsuhr, die Vergiftungstests und die Versionen im Audit-Log.
- **Die Frage nach einem Edge nach Kosten ist noch offen.** Es gab noch keinen Lauf über echte historische Daten, weil in dieser Umgebung kein Netzzugang bestand.

**Aufruf**
```bash
BACKTEST_ADMIN_URL=postgresql://quant:quant@localhost:5432/postgres \
python -m quant.backtest --scope crypto --klines data/BTCUSDT-1m.csv --daily-klines data/BTCUSDT-1d.csv \
  --symbol BTCUSDT --start 2025-01-01 --end 2026-06-30          # --idealized zum Vergleich
python -m quant.backtest --scope equity_us --daily-dir data/daily --tickers SPY,AAPL,MSFT --start 2021-01-01 --end 2026-06-30
```

## Bekannte Grenzen

- Kein Adapter wurde gegen echte Anbieter-Endpunkte getestet, nur gegen nachgebildete Antworten.
- Stooq liefert keine Survivorship-freien Universen. Aktien-Backtests über feste Ticker sind deshalb nach oben verzerrt, und der Report weist nicht eigens darauf hin.
- Für historische Orderbücher gibt es keine kostenlose Quelle. Im Krypto-Backtest ohne Buch greift die Volatilitäts-Slippage.
- Walk-Forward ist nur vorbereitet, es gibt keine Parametersuche (bewusst: keine Optimierung in dieser Phase).

## NEXT

1. Auf dem Hetzner-Server erreichbarkeit der Anbieter prüfen (Binance-Regionssperre), `docker compose --profile websockets up -d`.
2. Historische Binance-Klines (data.binance.vision) und Stooq-EOD laden und je einen REALISTIC- und IDEALIZED-Lauf fahren.
3. Shadow-Ergebnisse von mindestens 30 Tagen gegen den Backtest desselben Zeitraums abgleichen, um die Abweichung zwischen Modell und Realität zu messen.
4. Erst danach über Parameter reden. Echtes Kapital bleibt ausgeschlossen, bis die rechtliche Prüfung abgeschlossen ist.
