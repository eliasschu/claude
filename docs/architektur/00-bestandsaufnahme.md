# Bestandsaufnahme und Zielarchitektur (Phase 0)

Stand: 27.09.2026 · Branch `claude/trading-intelligence-platform-g93s2v` · Basis-Commit `748408f`

Dieses Dokument ist die Analyse vor dem Umbau zur Trading-Intelligence-Plattform. Es beschreibt, was im Code **tatsächlich** vorhanden ist, und stützt sich auf keine Absichtserklärungen aus README oder Kommentaren. Geprüft wurde mit `npm test`, `npm run typecheck`, `npm run build` und `eslint`.

---

## A. Aktuelle Architektur

| Ebene | Inhalt | Bewertung |
|---|---|---|
| Laufzeit | Next.js 16.3.4 (App Router), React 19.2, Tailwind 4, TypeScript strict | aktuell |
| Backend | nur Next-Route-Handler (`/api/news`, `/api/quote/[symbol]`, `/api/search`) und Server Components | kein eigener Dienst |
| Datenbank | **keine**. `DATABASE_URL` steht nur in `.env.example` | – |
| Auth | **keine** | – |
| Zustand | Prozessspeicher (`Map` in `core/http.ts`, `sources/sec.ts`, `services/crypto.ts`), Next-Datencache, `localStorage` (Watchlist, Favoriten) | geht bei Neustart verloren und wird nicht zwischen Instanzen geteilt |
| Hintergrundprozesse | **keine**. Alles läuft pro Anfrage oder über ISR | ein Bot braucht einen dauerhaft laufenden Prozess |
| Tests | Node-Test-Runner, 11 Dateien, 152 Tests (vor diesem Branch). Mock-Upstream über `FW_UPSTREAM_OVERRIDE` | gut |
| CI | **keine** (`.github/` fehlt) | – |

Die Schichten sind sauber getrennt:

```
src/lib/core/       Envelope Result<T> + DataMeta (observedAt/publishedAt/fetchedAt getrennt),
                    fetchSource (Timeout, Retry, Drosselung je Quelle, "last good" als stale markiert),
                    Zeitzonen, US-Geschäftstage, XML, Sanitizing
src/lib/sources/    Adapter: SEC EDGAR, Twelve Data, CoinGecko, EZB, US-Treasury, EIA, Presse-RSS
src/lib/sources/parsers/  reine Zerleger (testbar ohne Netz)
src/lib/finance/    reine Rechenlogik: DCF/Bewertung, Performance, Fundamentaldaten, Insider-Materialität,
                    Krypto-Kennzahlen, Portfolio-Parsing, Scorecard
src/lib/services/   setzt Adapter + Rechenlogik zu Ansichtsmodellen zusammen
src/config/         kuratierte Listen: Märkte, Mover-Universum, 26 13F-Fonds, Termine
src/components, src/app   Darstellung
```

## B. Was funktioniert (und bleibt)

- **Herkunfts-Envelope**: Jeder Wert reist mit `DataMeta`. Es gibt keinen stillen Rückgriff auf erfundene Werte. Fällt eine Quelle aus, wird der letzte gute Stand ausdrücklich als veraltet angezeigt.
- **SEC Form 4**: Transaktionscodes (P/S/A/M/F/G …), 10b5-1-Kennzeichen, Zusammenfassung von Teilausführungen, doppelt gemeldete Optionsausübungen werden bereinigt, Meldeverzug in US-Geschäftstagen, Cluster-Käufe, Materialität. Schenkung, Steuereinbehalt und Erbfall werden nie gelistet. Das ist eine solide Grundlage für die Insider Engine (§15/16).
- **SEC 13F**: Quartalsvergleich (neu, erhöht, reduziert, geschlossen). Die Zuordnung der CIK wird über den Firmennamen geprüft. Stimmt sie nicht, wird die Anzeige gesperrt statt falsch zugeordnet.
- **Fundamentaldaten aus XBRL**, mit US-GAAP und IFRS-Rückfall. Das DCF-Modell rechnet mit Szenarien, Sensitivität und offengelegten Annahmen.
- **Krypto**: Es gibt bewusst keinen „fairen Tokenpreis“. „Nicht belastbar bewertbar“ ist ein zulässiges Ergebnis.
- Deutsche Zahlenformate, getrennte Darstellung von Prozent und Prozentpunkten, Zeitzonen und Sommerzeit korrekt.
- Build, Typecheck und Tests laufen fehlerfrei.

## C. Was kaputt war oder ist

In diesem Branch behoben (✔) bzw. offen (○):

| | Befund | Auswirkung |
|---|---|---|
| ✔ | **13F-Werte 1000-fach zu hoch.** Seit 03.01.2023 meldet die SEC-Informationstabelle `value` in ganzen US-Dollar, der Parser multiplizierte pauschal mit 1000. | Depotwerte und Konsens-Summen um den Faktor 1000 falsch. Anteile (Balken) waren nicht betroffen. |
| ✔ | **„Echtzeit“-Etikett** für CoinGecko (laut Anbieter ~60 s, dazu 5 min Cache) und Twelve Data Gratistarif. SEC-Jahresabschlüsse trugen das Etikett **„Schlusskurs“**. | falsche Aktualitätsaussage |
| ✔ | **Erfundene „Datenqualität 35/55/90 von 100“** in jeder Herkunftszeile | Scheingenauigkeit ohne Messgrundlage |
| ✔ | Twelve Data: Als Kurszeitpunkt wurde `timestamp` verwendet, das ist aber der **Beginn der Tageskerze**, nicht der letzte Kurs. | angezeigter „Stand“ falsch |
| ✔ | Nachrichten: Als „Stand“ galt der **Abrufzeitpunkt** statt der jüngsten Veröffentlichung. | widerspricht der eigenen Regel in `core/meta.ts` |
| ✔ | Marktleiste: „Aktualisiert HH:MM“ zeigte die Renderzeit (ISR, bis 5 min alt), nicht den Datenzeitpunkt. | falsche Aktualitätsaussage |
| ✔ | Suchtreffer für Märkte verlinkten auf `/maerkte/{slug}`, eine Route, die es nicht gibt. | 404 |
| ✔ | `npm run lint` rief `next lint` auf, das in Next 16 entfernt ist. `test:watch` verwies auf das nicht installierte Vitest. | kein Lint möglich |
| ✔ | Die 404-Seite verwies auf einen „DEMO-Datensatz“, den es nicht mehr gibt. | irreführend |
| ○ | 7 Lint-Fehler `react-hooks/set-state-in-effect` (localStorage-Synchronisierung in Watchlist, Favoriten, Theme, Suche) | Umbau auf `useSyncExternalStore` nötig |
| ○ | README beschreibt den entfernten DEMO-Provider, `lib/data/provider.ts`, 43 Tests und Vitest. | Doku falsch |
| ○ | Toter Code: `lib/finance/scoring.ts` (Interest Score mit **festen Gewichten**, widerspricht §37) und `components/home/magnificent-seven.tsx` | – |
| ○ | `/portfolio` ist ein Platzhalter, obwohl die Rechenlogik in `finance/portfolio.ts` existiert. | – |

## D. Technische Schulden

1. **Keine Persistenz.** Ohne Datenbank gibt es kein Point-in-Time-Archiv, kein Audit-Log, keinen Backtest und keinen Track Record. Das ist die größte Lücke überhaupt.
2. **Ticker als Primärschlüssel** in Route (`/aktie/[symbol]`), Watchlist und Insider-Zeilen. Es gibt keinen Security Master (§70/71). Tickerwechsel, Mehrfachlistings, ISIN und WKN lassen sich nicht abbilden.
3. **Services hängen direkt an konkreten Anbietern** (`twelvedata`, `coingecko`). Provider-Interfaces (§74) fehlen, und die API-Route `/api/quote` importiert den Adapter direkt.
4. **Sequentielle Abrufe**: Die Mover-Liste ruft Ticker für Ticker ab, mit 7,6 s Drosselung je Twelve-Data-Abruf. Fundamentaldaten laden viele XBRL-Konzepte nacheinander. Seiten werden dadurch langsam.
5. **Zeitzone fest** auf `Europe/Vienna`. Für DACH ist das in Ordnung, §84 verlangt aber die Zeitzone des Nutzers.
6. **Keine CI.** Tests laufen nur, wenn jemand daran denkt.

## E. Risiken für die Datenqualität

| Risiko | Einschätzung | Maßnahme |
|---|---|---|
| **Lizenz Twelve Data Gratistarif: „nur private, nicht-öffentliche Nutzung“** | Blocker für jede öffentliche Seite (§81) | vor `SITE_PUBLIC=true` einen lizenzierten Anbieter wählen |
| Semantik von `last_quote_at` bei Twelve Data | nur aus der Dokumentation übernommen, gegen eine Live-Antwort **nicht geprüft** (Netzwerk hier gesperrt) | beim ersten Abruf mit Schlüssel verifizieren |
| XBRL-Restatements: `annualValues` nimmt je Periode den **zuletzt eingereichten** Wert | für die Anzeige richtig, für Backtests **Look-ahead** (§50) | Fakten mit `filed` point-in-time speichern |
| Corporate Actions | unklar, ob die Twelve-Data-Tagesreihen split- und dividendenbereinigt sind. Momentum und Volatilität könnten verzerrt sein | Bereinigung pro Anbieter dokumentieren und testen |
| 13F-Einheit | behoben (C). Einreichungen mit falsch gemeldeter Einheit sind bekannt | Plausibilitätsprüfung: impliziter Preis = Wert ÷ Stückzahl |
| CoinGecko | aggregierter EUR-Preis über viele Börsen, keine Orderbuch- oder Trade-Daten | für Anzeige ok, **ungeeignet** für Microstructure oder Execution |
| Index über ETF-Ersatz (SPY, QQQ, URTH, GLD, SLV) | als ETF-Kurs gekennzeichnet | für Regime-Features ok, im Feature-Katalog kennzeichnen |
| Nachrichten | nur Behörden-RSS und SEC-Meldungen. Duplikate werden über Titelähnlichkeit gebündelt | für eine News Engine (§23/24) fehlt ein lizenzierter Feed |

## F. Lücken zur Bot-Architektur

Vom Zielbild in §2 existiert **nichts** außer Teilen der Rohdaten-Schicht:

- kein Data Quality Layer als eigene Stufe (es gibt nur Stale-Erkennung pro Adapter)
- keine Feature Engine, kein Feature-Katalog und keine Versionierung
- keine Regime-, Signal-, Alpha-, Risk-, Portfolio- oder Execution-Engine
- kein Signal-Schema, kein unveränderliches Signal-Protokoll, keine Ergebnisauflösung
- kein Backtester, kein Walk-Forward, kein Experiment-Tracking
- kein Paper-Trading und keine Trennung von Research, Paper und Live
- **keine Intraday-Historie**: Relative Volume nach Tageszeit (§11) braucht Minutenbalken über mindestens 20 Handelstage je Titel
- keine Optionsdaten, Short-Daten (FINRA), Krypto-Derivate (Funding, OI, Liquidationen) oder On-Chain-Daten
- kein Scheduler bzw. Worker, der unabhängig von Seitenaufrufen läuft

## G. Wiederverwendbare Bausteine

- `core/meta.ts` (Result/DataMeta), `core/http.ts` (fetchSource) und `core/freshness.ts` (neu) bleiben die Grundlage aller TS-Adapter.
- `sources/parsers/sec.ts` + `services/insider.ts` + `finance/insider-materiality.ts` bilden den Kern der Insider Engine. Die Logik ist in reinen Funktionen testbar und lässt sich 1:1 nach Python portieren oder weiter nutzen.
- `sources/parsers/sec-13f.ts` + `services/whales.ts` + `config/whales.ts` (26 geprüfte CIKs) bilden die Grundlage der Smart Money Engine.
- `finance/performance.ts` (Renditen, Volatilität, Drawdown, Sharpe, Korrelation) wird später zur Referenzimplementierung für die Metriken in §58.
- `core/us-business-days.ts`, `core/time.ts`
- UI: `DataStamp`, `FreshnessBadge`, `Delta`, `Sparkline`, `primitives.tsx`, Watchlist-Provider

## H. Empfohlene Zielarchitektur

```
┌──────────────────────────┐        ┌────────────────────────────────────────────┐
│ apps/web  (Next.js)      │  HTTP  │ services/quant  (Python, FastAPI)          │
│  UI + Backend-for-       │◀──────▶│  ingest/*    Provider-Adapter (Interfaces)  │
│  Frontend, nur lesend    │        │  quality/    Data Quality Layer             │
│  gegenüber Bot-Daten     │        │  features/   Feature Engine (versioniert)   │
└────────────┬─────────────┘        │  regime/ signals/ risk/ portfolio/          │
             │                      │  backtest/ paper/  (deterministisch)        │
             │                      └───────────────┬────────────────────────────┘
             ▼                                      ▼
      ┌─────────────────────────────────────────────────────────────┐
      │ PostgreSQL + TimescaleDB                                     │
      │  security_master · observations (point-in-time) · bars       │
      │  signals (append-only) · signal_outcomes · bot_events        │
      │  experiments · versions                                      │
      └─────────────────────────────────────────────────────────────┘
      Redis: Cache + Pub/Sub für den Live-Feed     Parquet: Rohdaten-Archiv
```

Grundsätze:
- **Signale sind append-only.** Das erzwingt die Datenbank über einen Trigger, der UPDATE und DELETE auf `signals` verbietet, nicht die Disziplin im Code. Ergebnisse (`price_1d`, MAE, MFE, …) stehen in einer eigenen Tabelle.
- **Jede Beobachtung** trägt `event_time`, `published_time`, `received_time`, `source`, `revision`, `version` (§51).
- Next.js rechnet **keine** Signale. Es liest sie aus der Datenbank bzw. über die API.
- Kafka, ClickHouse und Deep Learning kommen erst, wenn eine Messung zeigt, dass Postgres, Timescale oder die Baselines nicht reichen (§75/76/78).

**Empfehlung zur Reihenfolge der Asset-Klassen:** Der erste echte Bot sollte bei **Krypto** starten. Börsen wie Coinbase, Kraken und Binance bieten öffentliche Websocket- und REST-Schnittstellen mit Trades, Orderbuch, Funding und Open Interest kostenlos und in Echtzeit an. Für US-Aktien ist Intraday-Handel mit Echtzeitdaten ohne kostenpflichtige Lizenz rechtlich nicht sauber darstellbar. Aktien starten deshalb mit **Swing/Position auf Tagesbasis** (SEC + lizenzierter EOD-Feed). Auch bei den Börsen-APIs ist vor der öffentlichen Anzeige abgeleiteter Daten die jeweilige Nutzungsbedingung zu prüfen.

## I. Migrationsplan

Jeder Schritt ist klein, getestet und einzeln deploybar. Der bestehende Funktionsumfang bleibt dabei erhalten.

| Phase | Schritt | Ergebnis |
|---|---|---|
| 1 | ✔ 1.1 Aktualitätsklassen (§55) + Etikettenfehler + 13F-Einheit | dieser Branch |
| 1 | 1.2 Security Master als Typen + Validierung (ISIN-Prüfziffer, WKN, FIGI, CIK), interne ID `ins_…`. Die Suche akzeptiert ISIN | reine Funktionen + Tests |
| 1 | 1.3 Provider-Interfaces in TS (`MarketDataProvider`, `FilingsProvider`, `CryptoProvider`, `MacroProvider`). Services hängen nur noch an Interfaces | Anbieter austauschbar |
| 1 | 1.4 PostgreSQL (docker-compose) + Migrationen: `instruments`, `instrument_identifiers` (valid_from/valid_to), `observations` (point-in-time) | erste Persistenz |
| 1 | 1.5 CI (GitHub Actions: typecheck, lint, test, build) + 7 Lint-Fehler beheben | grüne Pipeline |
| 2 | Python-Dienst anlegen, Signal-Schema (§36/59), append-only `signals` + `bot_events`, Versionierung (§86) | Audit-Grundlage |
| 3 | Ingest Krypto-Spot (1m-Balken, Trades) + US-Aktien EOD; Price/Volume/Momentum-Features; Regime v0 (Trend, Breite, VIX, realisierte Volatilität) | erste Features |
| 4 | Bot-Seite: Status (nur echte Zähler), Live-Feed aus `bot_events`, Signalkarten mit Evidence for/against, Invalidation, „Why no trade“ | UI |
| 5 | Insider- und Smart-Money-Engine auf vorhandener SEC-Logik; FRED/ALFRED point-in-time für Makro | – |
| 6 | Krypto-Derivate: Funding, OI, Liquidationen, Basis | – |
| 7 | Backtester (Walk-Forward, Kosten, Survivorship), Experiment-Log, Metriken §58 | – |
| 8 | Shadow Mode → Paper Trading mit Risk Engine + Kill Switch | – |
| 9 | Alerts, Watchlist serverseitig, Portfolio | – |
| 10 | Premium-Daten (Optionen/OPRA, Echtzeit-Aktien), Execution | – |

## J. Erster Implementierungsschritt (umgesetzt)

**1.1 Datenaktualität (§55)**, weil jede weitere Funktion ehrliche Zeitangaben voraussetzt und der Bestand hier nachweislich falsche Aussagen machte.

- `src/lib/core/freshness.ts`: Klassen LIVE, < 1 MIN, DELAYED 15 MIN, END OF DAY, DAILY, WEEKLY, QUARTERLY, ANNUAL, EVENT, STALE, UNKNOWN. Die Einstufung ergibt sich aus Takt der Quelle und gemessenem Alter des **Datenzeitpunkts**. LIVE wird ohne Streaming-Quelle nie vergeben. Ein Zeitstempel in der Zukunft führt zu UNKNOWN (Hinweis auf Uhrabweichung, §45).
- `FreshnessBadge` rechnet im Browser alle 15 s nach. Andernfalls würde eine zwischengespeicherte Seite ein zu junges Alter behaupten.
- Die erfundene Qualitätsnote ist entfernt.
- Außerdem: 13F-Einheit, Twelve-Data-Zeitpunkt, Nachrichten-Stand, Marktleiste, Suchlink, Lint-Skript, 404-Text (siehe C).

### Offene Entscheidungen

Diese Punkte muss der Betreiber entscheiden, bevor Phase 1.4 und Phase 2 beginnen können:

1. **Hosting**: Vercel allein reicht für einen dauerhaft laufenden Bot nicht. Nötig ist ein Server bzw. Container für Python, Postgres und Worker (z. B. Hetzner, Fly.io, Railway).
2. **Datenbudget**: ohne kostenpflichtigen Aktien-Feed nur Tagesdaten für Aktien. Krypto geht in Echtzeit kostenlos.
3. **Regulatorik**: Öffentliche Signale können als Anlageempfehlung gelten (MAR Art. 20, FMA). Vor dem öffentlichen Track Record sollte eine rechtliche Prüfung stattfinden.
