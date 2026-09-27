# Phase 1.4 + Phase 2: Datenbank, Provider und Bot Core

Stand: 27.09.2026 · Betriebsart: **RESEARCH / PRIVATE / PAPER** · Code: `services/quant/`

## Entscheidungen des Betreibers (Umsetzung)

| Vorgabe | Umsetzung |
|---|---|
| Frontend auf Vercel | unverändert. Next.js liest den Bot nur über `src/lib/bot/client.ts`, serverseitig und mit Token |
| Bot nicht von Serverless abhängig | eigener Prozess `bot-worker`, dazu `scheduler`. Beide laufen dauerhaft, auch ohne Websitebesuch |
| Docker, später Hetzner/AWS/Railway/Fly/K8s | ein Image für drei Rollen und `docker-compose.yml`. Konfiguration nur über Umgebungsvariablen |
| PostgreSQL, vorbereitet für Timescale/ClickHouse | Zeitspalte im Primärschlüssel von `bars`/`observations`, keine Fremdschlüssel auf Zeitreihen. `create_hypertable` später ohne Schemaänderung |
| Redis | Live-Feed (Pub/Sub). Die Datenbank bleibt die Wahrheit |
| Datenbudget 0 € | Binance und Coinbase (öffentliche Marktdaten), Stooq (EOD). Weitere Quellen (SEC, FRED, CFTC, DefiLlama) sind als Provider-Interface vorbereitet |
| nur Research/Paper | `BOT_MODE=live` wird beim Start abgewiesen. Signale tragen `disclosure.published=false`, die API ist intern |

## Schritte

### STEP 1: PostgreSQL-Schema (`quant/migrations/0001_core.sql`)

**DONE:**
- Security Master mit interner ID und Kennungen samt Gültigkeit.
- `data_sources` mit Lizenzstand und Rangfolge bei Widersprüchen.
- Tabellen `bars` und `observations` (Point-in-Time mit Revisionen) sowie `bot_cycles`, `feature_snapshots`, `regime_snapshots`, `signals`, `signal_outcomes`, `bot_events`, das Paper-Konto und `provider_health`.
- Append-only-Tabellen werden per **Trigger** geschützt (UPDATE, DELETE, TRUNCATE).

**TESTED:** Append-only, Revisionen, Plausibilitäts-Constraints, idempotente und parallele Migration.

**KNOWN LIMITATIONS:** Noch keine Hypertables. Kein Partitioning. Kein Rollenkonzept in der Datenbank (App-Rolle ohne `ALTER TABLE`).

### STEP 2: Provider-Interfaces (`quant/providers/`)

**DONE:**
- Neun Interfaces: `MarketDataProvider`, `FundamentalProvider`, `InsiderProvider`, `InstitutionalProvider`, `OptionsProvider`, `MacroProvider`, `CryptoMarketProvider`, `OnChainProvider`, `NewsProvider`.
- Implementiert sind Binance (Spot und USD-M-Perps), Coinbase (Spot) und Stooq (EOD).
- Nicht angebundene Datenarten melden `NotConfigured`, statt Daten zu erfinden.

**TESTED:** Parser gegen dokumentierte Antwortformate, offener Balken ≠ final, Regionssperre (451) ohne Wiederholung.

**KNOWN LIMITATIONS:**
- **In dieser Umgebung gab es keinen Netzzugang zu den Anbietern.** Alle Adapter sind nur gegen nachgebildete Antworten getestet, nicht gegen echte.
- Binance sperrt einige Regionen, der Serverstandort muss das erlauben.
- Liquidationen gibt es nur per Websocket, sie sind noch nicht angebunden.
- Die Lizenz von Stooq für öffentliche Anzeige ist ungeklärt.

### STEP 3: Signal- und Feature-Schema (`quant/domain.py`, `quant/features.py`, `quant/quality.py`)

**DONE:**
- `FeatureValue`: Rohwert, Perzentil, z-Score, Richtung, Ausprägung, Datenstand, Quelle, Verlässlichkeit.
- `StrategyEvaluation`, `RiskAssessment`, `Evidence`, `Invalidation`, `ExitPlan`.
- Nur abgeschlossene Balken vor `as_of` fließen ein. Intraday-RVOL wird gegen dieselbe Tageszeit gerechnet.
- Der Data Quality Layer verwirft fehlerhafte Balken mit Grund und meldet das als Ereignis.

**TESTED:** Look-ahead-Schutz, RVOL nach Tageszeit, CVD, fehlende Merkmale als `unavailable`.

**KNOWN LIMITATIONS:**
- Perzentile beziehen sich nur auf die eigene, kurze Historie.
- Kein Corporate-Action-Abgleich über mehrere Quellen.

### STEP 4: Unveränderliches Signal-Audit-Log (`quant/audit.py`)

**DONE:**
- Jedes Signal wird genau einmal geschrieben, mit sha256-**Hash-Kette**.
- Die Ergebnisse (1h/1d/5d/10d/20d, MFE, MAE, Benchmark) stehen als eigene unveränderliche Zeilen in `signal_outcomes`.
- Alle geforderten Felder und Versionen sind enthalten. Dazu kommen `disclosure` (Interessenkonflikte, Veröffentlichung, Disclaimer-Version) für den späteren Launch.

**TESTED:** UPDATE, DELETE und TRUNCATE werden abgewiesen. Eine Manipulation am Trigger vorbei fällt bei `verify_chain()` auf.

**KNOWN LIMITATIONS:**
- Ein DB-Superuser kann die Kette neu schreiben.
- Für externe Beweiskraft fehlt noch ein regelmäßiger Anker nach außen, z. B. der Kopf-Hash an einen Zeitstempeldienst.

### STEP 5: BotOrchestrator (`quant/orchestrator.py`, `worker.py`, `scheduler.py`)

**DONE:**
- Fester Ablauf je Zyklus mit Ereignissen.
- Kill Switch bei Tagesverlust, Drawdown, Providerausfall, veralteten Kerndaten und abnormaler Slippage.
- Circuit Breaker je Quelle und Zyklus.
- Unveränderte Stände werden nicht jede Minute neu protokolliert. Eine offene Position erzeugt keine Schein-Ablehnungen.

**TESTED:**
- End-to-End mit Test-Providern: Nachladen, Signale, Paper-Order, Fill, Stop.
- Providerausfall führt zu `halted` und NO_TRADE.
- Scheduler: einmal je Handelstag.
- Smoke-Test der echten Prozesse gegen Postgres und Redis.

**KNOWN LIMITATIONS:**
- Der Worker lädt per REST im Minutentakt, noch nicht per Websocket.
- Kein Neustart-Backoff bei dauerhaftem Ausfall.

### STEP 6: MarketRegimeEngine (`quant/regime.py`)

**DONE:**
- Drei unabhängige Achsen: Trend, Volatilitätsperzentil und Risiko.
- Bei Aktien kommt die Marktbreite hinzu (ab 8 Werten), bei Krypto „Hebel erhöht“ (Funding-z).
- `INSUFFICIENT_DATA` statt Raten.

**TESTED:** Aufwärtstrend, zu wenig Daten, überfüllter Hebel.

**KNOWN LIMITATIONS:**
- Kein VIX, keine Kreditspreads und keine Zinskurve (FRED ist noch nicht angebunden).
- Die Marktbreite beruht auf nur 10 Werten.

### STEP 7: Strategy Engine (`quant/strategies.py`)

**DONE:** Fünf Strategien, jede mit `strategy_id`, Version, Horizont, Pflichtmerkmalen, Ein- und Ausschlussbedingungen, Invalidierung, Exit und Risikoregeln:

| Strategie | Horizont |
|---|---|
| A. Equity Breakout Momentum | 2–10 Tage |
| B. Equity Relative Strength | 10–20 Tage |
| C. Equity Volume Anomaly | 1–5 Tage |
| D. Crypto Spot/Perp Divergence | 1–6 Stunden |
| E. Crypto Momentum + Funding/OI | 4–24 Stunden |

Regimepunkte sind je Strategie unterschiedlich. Die **Punkte der Evidence ergeben exakt die Signalstärke.**

**TESTED:**
- Kandidat, WATCH mit Grund, NO_TRADE bei fehlenden oder veralteten Daten.
- Überfülltes Funding führt zu WATCH.

**KNOWN LIMITATIONS:**
- Schwellen und Punkte sind begründete Startwerte, **nicht optimiert und nicht validiert.** Ob eine Strategie einen Vorteil hat, zeigt erst der Backtest (Phase 7) bzw. das Paper-Protokoll.
- Strategie C kennt keinen Nachrichten-Auslöser. Das wird als Gegenargument ausgewiesen.

### STEP 8: Risk Engine (`quant/risk.py`)

**DONE:**
- Chance-Risiko-Verhältnis, Stop-Abstand, Positionsgröße (0,5 % Risiko je Trade, max. 10 % je Position).
- Liquidität: Tagesumsatz, Spread und Orderbuchtiefe.
- Volatilität, Duplikate (inklusive ausstehender Orders), Brutto-Exposure und Krypto-Klumpen (30 %).
- Kill Switch.
- Shorts werden abgelehnt, weil Leihe und Funding noch nicht simuliert werden.

**TESTED:** Starkes Signal wird wegen Illiquidität abgelehnt, Positionsgröße, Kill Switch, Konzentration.

**KNOWN LIMITATIONS:**
- Keine Korrelationsmatrix, sondern Gruppen-Limits.
- Kein Earnings-Kalender (wird als „nicht prüfbar“ ausgewiesen).

### STEP 9: Paper Trading (`quant/paper.py`)

**DONE:**
- Krypto-Fills laufen Level für Level durch das Orderbuch, mit 0,10 % Taker-Gebühr.
- Aktien werden zur nächsten Eröffnung um 09:30 New York gefüllt (sommerzeitkorrekt), mit Spread, Slippage und Gebühr.
- Handelsverzögerung.
- Konservative Exits: Kurslücke über den Stop führt zum Eröffnungskurs; Stop vor Ziel im selben Balken; Zeitexit.

**TESTED:** Kein Mid-Fill. Ein zu dünnes Buch führt zu keinem Fill. Kurslücke, Konflikt im selben Balken, Zeitzonen.

**KNOWN LIMITATIONS:**
- Das Orderbuch ist ein Snapshot, ohne Market Impact über die Zeit.
- Keine Teilausführungen über mehrere Zyklen.
- Keine Funding-Kosten.

### STEP 10: Bot-API (`quant/api.py`, `src/lib/bot/client.ts`)

**DONE:**
- Endpunkte: `/bot/status` (nur echte Zählungen), `/bot/events`, `/signals`, `/signals/{id}` (mit Features und Ergebnissen), `/strategies`, `/paper/portfolio`, `/paper/performance` (mit Stichprobengröße), `/providers/health`, `/audit/verify`.
- Token-Pflicht. Jede Antwort ist als intern gekennzeichnet.
- Typisierter, rein serverseitiger Next.js-Client.

**TESTED:** 401 ohne Token, Umschlag mit Hinweisen, Detailfelder, Hash-Kette, Next-Client mit Mock-Fetch.

**KNOWN LIMITATIONS:**
- Noch keine UI (bewusst, laut Vorgabe).
- Kein Rate-Limit an der API.

## Gefundene und behobene Fehler während der Umsetzung

- **Wettlauf beim Start:** Worker und Scheduler legten beide `schema_migrations` vor der Sperre an, und der Worker stürzte ab. Die Sperre kommt jetzt zuerst. Ein Test weist den Fehler ohne Fix zuverlässig nach.
- **Point-in-Time:** `received_at` kam von der Datenbankuhr statt von der Bot-Uhr. In Replays wären dadurch alle Daten „unbekannt“ gewesen. Die Ergebnisauflösung trennt jetzt Wissensstand und Zeitfenster.
- **Funding-Werte** (8-Stunden-Takt) galten für Intraday-Strategien als veraltet, sodass Strategie E nie ausgelöst hätte.
- **Doppelte Einstiege:** Die Risk Engine sah ausstehende Orders nicht. Der Unique-Index der Datenbank hat den zweiten Einstieg verhindert, jetzt prüft es auch die Risk Engine.
- **Zykluszeit bei Providerausfall:** 34 s wegen Wiederholungen bei jedem Abruf. Mit dem Circuit Breaker sind es etwa 5 s.

## Nächste Schritte (Vorschlag)

1. **Erster echter Lauf auf einem Server mit Netzzugang.** Die Adapter gegen Live-Antworten prüfen, besonders Binance-Regionen, Stooq und Twelve Data (`last_quote_at`).
2. Websocket-Ingestion für Krypto (Trades, Orderbuch-Deltas, Liquidationen) statt REST-Polling.
3. Phase 5: SEC Form 4, 13F und 13D/G in Python portieren (Logik aus `src/lib/sources` übernehmen), dazu FRED/ALFRED point-in-time und CFTC COT.
4. Phase 7: Backtester auf denselben Strategien und Risikoregeln. Point-in-Time-Replay über `received_at`, Walk-Forward und Experiment-Log.
5. Kopf-Hash der Signal-Kette regelmäßig extern verankern.
