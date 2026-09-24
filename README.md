# Finanzwelt-App – MVP

Deutschsprachige Finanzplattform für Privatanleger. Sie verbindet die Informationsdichte eines Terminals mit einer ruhigen, verständlichen Oberfläche. Jeder angezeigte Wert trägt Quelle, Datenstand, Zeitzone, Kursart und Datenqualität mit sich.

> **DEMO-Modus:** Ohne angebundenen Datenanbieter läuft die App mit synthetisch erzeugten Beispieldaten. Kurse, Kennzahlen, Nachrichten, Analystendaten und Offenlegungen haben **keinen Bezug zum realen Markt**. Das kennzeichnet die App an jeder Stelle mit „DEMO“.

## Schnellstart

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
cp .env.example .env.local   # optional, ohne Anpassung läuft der DEMO-Modus
npm run dev                  # http://localhost:3000
```

Weitere Befehle:

| Befehl | Zweck |
|---|---|
| `npm test` | 43 automatisierte Tests für Bewertung, Renditen, Benchmarks, Scores und Suche |
| `npm run typecheck` | TypeScript-Prüfung |
| `npm run build && npm start` | Produktions-Build und Start |

## Funktionen

- **Startseite** mit intelligenter Suche nach Name, Ticker, ISIN, WKN oder Frage („Ist Nvidia fair bewertet?“)
- **Marktleiste** mit 17 Werten: DAX, S&P 500, Nasdaq 100, Dow Jones, Euro Stoxx 50, MSCI World, FTSE All-World, Nikkei, Bitcoin, Ethereum, EUR/USD, Gold, Silber, Brent, WTI, US-Rendite 10 J., VIX
- **Thema des Tages**, größte Bewegungen, anstehende Termine
- **Magnificent Seven** mit Kurzbewertung aus demselben Modell wie die Detailseite
- **Zehn Aktien mit der höchsten Aufmerksamkeit** (Interest Score) mit aufklappbarer Herleitung
- **Nachrichten** zu Finanzen und Geopolitik: Kennzeichnung als Fakt, Analystenmeinung, Gerücht oder Modellinterpretation, Themencluster mehrerer Quellen und Abfrage alle 150 Sekunden. Der Feed erfindet keine Meldung, nur weil das Intervall abgelaufen ist.
- **Aktien-Detailseite** (`/aktie/[symbol]`):
  - Kurschart von 1 Monat bis Maximum
  - Modellbewertung mit Bear-, Base- und Bull-Szenario, sechs Verfahren mit Gewicht und Annahme, Endwert-Anteil, Sensitivitätstabelle und Konfidenz
  - Analystenkursziele, Potenzial und Buy/Hold/Sell-Verteilung, klar getrennt vom eigenen Modell
  - Vergleich mit S&P 500, MSCI World und FTSE All-World. Kurs- und Gesamtrendite, Über- und Unterperformance in **Prozentpunkten**, annualisierte Rendite, Volatilität, maximaler Rückgang, Sharpe Ratio und Korrelation.
  - Scorecard mit acht Dimensionen, sichtbarer Methode und sichtbarem Gewicht
  - Fundamentaldaten, Segmente, Regionen, Chancen, Risiken und Katalysatoren
- **Politiker- und Investorentracker** mit Handelsdatum, Veröffentlichungsdatum, Meldeverzug und Hinweis zu 13F-Meldungen
- **Watchlist**, lokal im Browser gespeichert
- **Hell- und Dunkelmodus**, ohne Aufblitzen beim Laden
- **Risikohinweis** in der Fußzeile jeder Seite
- Lade-, Leer-, Fehler- und 404-Zustände

## Architektur

Datenbeschaffung, Berechnung und Darstellung sind strikt getrennt:

```
src/
├── lib/
│   ├── data/                 ← DATENBESCHAFFUNG
│   │   ├── types.ts          Datenmodell; jeder Wert reist als Envelope { data, meta }
│   │   ├── provider.ts       Schnittstelle MarketDataProvider + Auswahl über DATA_PROVIDER
│   │   └── demo/             DEMO-Provider, deterministischer Generator, Platzhalterinhalte
│   ├── finance/              ← BERECHNUNG (reine Funktionen, ohne Datenzugriff)
│   │   ├── valuation.ts      DCF, KGV, EV/EBITDA, PEG, FCF-Rendite, Aggregation, Sensitivität
│   │   ├── performance.ts    Renditen, CAGR, Volatilität, Drawdown, Sharpe, Korrelation, Benchmarks
│   │   ├── scoring.ts        Interest Score und Scorecard mit offengelegten Gewichten
│   │   └── format.ts         Einheitliche Formatierung (Prozent ≠ Prozentpunkte)
│   ├── services/
│   │   └── stock-analysis.ts Verbindet Provider und Berechnung zu Ansichtsmodellen
│   └── search/intents.ts     Regelbasierte Erkennung von Suchfragen
├── components/               ← DARSTELLUNG (rechnet nicht selbst)
├── app/                      Seiten und API-Route /api/news
└── tests/                    Vitest
```

**Anbieter wechseln:** Eine neue Datei implementiert `MarketDataProvider`, und in `getProvider()` kommt ein Eintrag hinzu. Seiten, Komponenten und Berechnungen bleiben unverändert. Die Einträge `eodhd`, `fmp` und `twelvedata` sind bereits vorgesehen. Solange sie nicht implementiert sind, werfen sie einen eindeutigen `ProviderNotConfiguredError`. Die Oberfläche zeigt dann einen Fehlerzustand und niemals versehentlich Demo-Zahlen.

## Methodik in Kürze

- **Fairer Wert:** gewichtet aus DCF (35 %), historischem KGV (20 %), historischem EV/EBITDA (15 %), Branchen-KGV (10 %), PEG (10 %) und FCF-Rendite (10 %). Verfahren ohne Daten fallen heraus und werden ausgewiesen.
- **Fair-Value-Abweichung** = (fairer Wert ÷ Kurs − 1) × 100. Die Einordnung lautet: ab +15 % attraktiv, −10 % bis +15 % ungefähr fair, bis −30 % ambitioniert, darunter sehr hoch bewertet. Unter 25 Punkten Konfidenz gilt eine Aktie als „nicht zuverlässig bewertbar“.
- **Interest Score:**
  - Volumen 15 %
  - Momentum 15 %
  - Analystenrevisionen 12 %
  - Gewinnrevisionen 12 %
  - Bewertung 12 %
  - Nachrichten 12 %
  - Insider und Institutionen 8 %
  - Termine 8 %
  - Volatilität 3 %
  - Datenqualität 3 %

  Der Score ist eine Aufmerksamkeitskennzahl und keine Empfehlung.
- **Benchmark-Vergleich:** Die Gesamtrendite enthält reinvestierte Dividenden. Annualisiert wird erst ab einem Jahr. Die Sharpe Ratio rechnet mit 3,0 % risikolosem Zins und wird ab 30 Beobachtungen angezeigt.

Die vollständige Beschreibung steht in der App unter `/datenquellen`.

## Benötigte Datenquellen für den Livebetrieb

| Bereich | Mögliche Quelle | Variable |
|---|---|---|
| Kurse, Indizes, Devisen, Krypto | EODHD, Twelve Data | `EODHD_API_KEY`, `TWELVEDATA_API_KEY` |
| Fundamentaldaten, Analystenkonsens | Financial Modeling Prep | `FMP_API_KEY` |
| Nachrichten | lizenzierter Nachrichten-Feed | `NEWS_API_KEY` |
| Insider (Form 4), Institutionen (13F) | SEC EDGAR (frei) | `SEC_EDGAR_USER_AGENT` |
| Politiker-Offenlegungen | Congressional Financial Disclosures | `DISCLOSURE_API_*` |
| Historien, Konten, Portfolios | PostgreSQL, optional Redis | `DATABASE_URL`, `REDIS_URL` |

Lizenzbedingungen prüfen: Sie legen fest, ob Kurse als Echtzeit oder verzögert angezeigt werden dürfen und ob Nachrichtenüberschriften weitergegeben werden dürfen.

## Bewusste Entscheidungen

- **Keine realen Personen im Tracker:** Im DEMO-Modus tragen alle Halter fiktive Namen („Platzhalter-Abgeordnete A“). So wird keine reale Person mit einer erfundenen Transaktion verknüpft.
- **Keine geschätzten Index-Fundamentaldaten:** Für Umsatz- und Gewinnwachstum der Indizes gibt es im MVP keine verlässlichen Konsensdaten. Die Spalte bleibt deshalb leer, statt Werte zu raten.
- **Keine fremden Logos:** Die Wortmarke ist eigens gezeichnet, Unternehmen erscheinen nur als Text.
- **Deterministische Demo-Daten:** Fester Seed je Symbol und fester Datenstand (Freitag, 04.09.2026, 17:35 Uhr). Server und Browser zeigen damit identische Werte.
- **Schriften:** Manrope für Oberfläche und Zahlen, Source Serif 4 ausschließlich für redaktionelle Inhalte. Sie werden zur Laufzeit von Google Fonts geladen, dafür gibt es Systemschriften als Rückfall.

## Bekannte Einschränkungen

- Es ist noch kein echter Datenanbieter angebunden. Alle Werte sind DEMO.
- Die Suche ist regelbasiert. Sie führt zur richtigen Stelle, beantwortet Fragen aber nicht frei.
- Portfolio, Kursalarme und Nutzerkonten sind nicht Teil des MVP (siehe `/portfolio`). Die Watchlist liegt nur im Browser.
- Qualitative Unternehmensangaben (Chancen, Risiken, Wettbewerbsvorteile) stammen im DEMO-Modus aus einem branchenweiten Platzhalterkatalog.
- Die Kurshistorie enthält nur Tagesschlusskurse, keine Intraday-Charts auf der Detailseite.
- Die mobile Darstellung wurde im Code geprüft (responsive Raster, horizontal scrollbare Tabellen und Leisten). Ein Test auf echten Geräten steht noch aus.

## Risikohinweis

Die dargestellten Informationen, Modellbewertungen und Analystenschätzungen dienen ausschließlich Informationszwecken und stellen keine Anlageberatung oder Empfehlung zum Kauf oder Verkauf von Finanzinstrumenten dar. Kapitalanlagen sind mit Risiken bis hin zum Totalverlust verbunden.
