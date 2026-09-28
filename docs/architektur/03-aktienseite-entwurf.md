# Aktienseite: Bestandsaufnahme, Datenlage, Entwurf und Etappen

Stand: 28.09.2026. Dies ist nur Analyse und Entwurf. **Am Code wurde nichts geändert.** Die Umsetzung beginnt erst nach „weiter“.

Grundlage ist der Code auf dem Branch `claude/trading-intelligence-platform-g93s2v` (Commit `da0fd3c`), kein altes ZIP.

---

## 1. Aktueller Projektstand der Aktienseite

### Was es gibt und bleiben soll

| Baustein | Datei | Zustand |
|---|---|---|
| Aktienseite `/aktie/[symbol]` | `src/app/aktie/[symbol]/page.tsx` | Kopf mit Name, Ticker, Börse, CIK, Kurs, Tagesveränderung, Volumen und Handelsstatus. Darunter Chart, Bewertung, Scorecard und SEC-Meldungen |
| Kurschart | `src/components/stock/price-chart.tsx` | Eigenes SVG mit Linie und Fläche, nur Schlusskurse. Zeiträume 1M, 3M, lfd. Jahr, 1J, 3J, 5J, Max. Ohne Fadenkreuz, Tastatur, Vergleich oder Kerzen |
| Bewertungsmodell | `src/lib/finance/stock-model.ts`, `valuation.ts` | Drei-Szenarien-DCF, Sensitivität, **Reverse-DCF (`impliedGrowth`)**, Abschlag und Potenzial korrekt getrennt (`discountToModelPct` / `upsideToModelPct`, getestet) |
| Scorecard v1 | `src/lib/finance/stock-scorecard.ts` | 7 Dimensionen, Gesamtwert ab 4 Dimensionen, Warnsignale separat, Datenabdeckung separat |
| Branchenprofile | `src/lib/finance/sectors.ts` | Nach SIC-Code: Finanzen und Immobilien ohne DCF, mit Begründung |
| Fundamentaldaten | `src/lib/finance/fundamentals.ts` | SEC-XBRL, nur Jahreswerte, bis 6 Jahre, US-GAAP und IFRS |
| Insider (Form 4) | `src/lib/services/insider.ts`, `/tracker` | Klassifikation, Materialität, Plan-Kennzeichen. Auf der Aktienseite noch **nicht** eingebunden |
| Nachrichten | `src/lib/services/news.ts`, `/nachrichten` | EZB-, Fed- und SEC-Pressefeeds sowie SEC-Einreichungen, Dubletten-Bündelung über Titelähnlichkeit |
| Watchlist | `src/components/watchlist/*` | Nur lokal im Browser (localStorage), ohne Konto |
| Datenstand | `DataStamp`, `src/lib/core/freshness.ts` | Quelle, Zeitpunkt und „stale“ je Wert |
| Hell/Dunkel | `theme-toggle.tsx` | vorhanden |
| Python-Dienst `services/quant` | SEC Form 4/13F/13D-G, FRED, CFTC, Point-in-Time | Datenbasis für spätere Etappen. Wird vom Frontend für Aktien noch nicht genutzt |

### Befunde, die vor dem Ausbau wichtig sind

1. **Ladezeit, wahrscheinliche Hauptursache: Die Drosselung greift auch bei Cache-Treffern.**
   - `fetchSource` ruft `throttle()` **vor** `fetch()` auf. Der Abstand von 7,6 s zwischen Twelve-Data-Abrufen gilt also auch dann, wenn Next.js die Antwort aus dem Cache liefert.
   - Die Aktienseite holt nacheinander Kurs und Verlauf, also mindestens 7,6 s Wartezeit.
   - `generateMetadata` ruft `getStockOverview` ein zweites Mal auf. Dadurch kommen weitere Twelve-Data-Slots hinzu.
   - Hochgerechnet aus dem Code: 7,6 s bis über 20 s je Aufruf. **Gemessen ist das noch nicht.** Messung ist Etappe 0.
2. **Viele serielle SEC-Abrufe.**
   - `loadSeries` fragt 15 bis 25 XBRL-Konzepte einzeln ab (`companyconcept`), jeweils mit 125 ms Mindestabstand.
   - Der Endpunkt `companyfacts` liefert alles in **einem** Abruf.
3. **Nichts wird gestreamt.** Die Seite wartet auf alle Quellen, bevor sie etwas zeigt. Es gibt kein `Suspense` je Abschnitt. Eine langsame Quelle blockiert die ganze Seite. Das widerspricht der Vorgabe „Externe Quellen dürfen die Seite nicht blockieren“.
4. **Die Kursreihe enthält nur Schlusskurse** (`SeriesPoint = [t, close]`). Kerzen, Volumen und die meisten Indikatoren brauchen OHLCV. Der Parser muss erweitert werden.
5. **„Max“ ist falsch beschriftet.** Es werden 1.300 Tageskurse geladen, also rund 5 Jahre. „Max“ zeigt damit dasselbe wie „5J“.
6. **„Laufendes Jahr“ rechnet in lokaler Zeit** (`setMonth`/`setDate`) statt in Börsenzeit. Zu wenige Daten zeigt die Seite stillschweigend als die letzten zwei Punkte, statt „nicht verfügbar“ zu melden.
7. **Die Scorecard v1 mischt Fundamentaldaten und Kursverhalten.** Momentum und Schwankung sind Teil des Gesamtwerts. Sie gehören aber in die Risikoanalyse, nicht in eine Unternehmensbewertung.
8. **Die Scorecard v1 gewichtet stillschweigend um.** Fehlende Dimensionen werden aus der Gewichtssumme herausgerechnet. Das widerspricht der neuen Vorgabe. Schwellen sind fest, Vergleichsgruppen gibt es nicht.
9. **Die Währung ist nicht abgeglichen.** Bei ausländischen Emittenten (20-F, zum Beispiel in TWD oder JPY berichtend) ist die Berichtswährung eine andere als die Kurswährung USD. Kennzahlen wie das KGV wären dann falsch.
10. **Die Tarifangaben widersprechen sich.** Auf `/datenquellen` steht noch „Plus = höherer Datentarif, Pro = Analystenkonsens/Top-500“. Der neue Auftrag sieht vor: „Plus = Feed, Watchlist, Alarme; Pro = Filter, Historie, Werkzeuge“. Außerdem ist die Watchlist heute kostenlos.

---

## 2. Machbare Datenabdeckung und offene Lizenzfragen

Eine **Datenprobe war in dieser Umgebung nicht möglich.** Der Egress-Proxy lehnt Verbindungen zu SEC, Twelve Data, Polymarket und Kalshi ab. Alle Angaben unten sind deshalb noch zu verifizieren: Dokumentation lesen, Probe ziehen, Bedingungen prüfen.

| Bereich | Quelle (Kandidat) | Machbar | Offene Lizenz-/Datenfrage |
|---|---|---|---|
| Kurse Tag (OHLCV) | Twelve Data (angebunden) | ja, nur US-Titel verlässlich | **Gratistarif nur private, nicht-öffentliche Nutzung.** Das blockiert jede öffentliche Seite |
| Kurse intraday (1 h, 1 Handelstag, 7 T) | Twelve Data | ja, im Rahmen von 800 Credits/Tag | Vor- und Nachbörse (`prepost`) vermutlich nur in höheren Tarifen. Wie lange Intraday-Historie reicht, ist zu prüfen |
| Splits, Dividenden, bereinigte Kurse | Twelve Data `/splits`, `/dividends` | vermutlich | In welchem Tarif? Wie wird bereinigt (Splits bzw. Dividenden)? Muss vor jeder Renditeaussage geklärt sein |
| Indizes als Benchmark | – | nein (lizenzpflichtig) | Stattdessen ETF (SPY, QQQ …), ausdrücklich als „ETF, Näherung“ gekennzeichnet. So wird es heute schon gehandhabt |
| Fundamentaldaten USA | SEC XBRL `companyfacts` | ja, kostenlos | Behördendaten. Fair-Access-Regeln (10 Anfragen/s, User-Agent) |
| Quartalszahlen / TTM | SEC XBRL (10-Q) | ja | Q4 muss als Jahr minus 9 Monate abgeleitet werden. Das braucht Tests |
| Vergleichsgruppen | SEC XBRL `frames` (ein Konzept für alle Firmen einer Periode) | ja, kostenlos | Die Branche kommt nur über den SIC-Code und ist grob. Große Mischkonzerne sind schlecht zuordenbar |
| Fundamentaldaten Europa | ESEF-Berichte (filings.xbrl.org) | teilweise | Abdeckung und Aktualität schwanken, ein Ticker-Mapping fehlt. **Später** |
| Analystenrevisionen, Kursziele | FMP, EODHD u. a. | nur kostenpflichtig | **Kein Einsatz ohne Auftrag.** Bis dahin wird der Bereich als nicht verfügbar gezeigt |
| Unternehmensausblick | 8-K Item 2.02 und 7.01 (Anlage EX-99) | teilweise | Nur Link und Zitat kurzer Kernaussagen, keine Volltexte |
| Insider | SEC Form 4 (vorhanden) | ja | Bestandsanteil nur berechenbar, wenn die Aktienzahl aus `dei` vorliegt |
| Beteiligungsmeldungen | SEC 13D/G, 13F (Python-Dienst) | ja | 13F hat bis zu 45 Tage Verzug. Das muss sichtbar sein |
| Termine (nächste Zahlen) | – | nein, kostenlos nicht verlässlich | Vergangene Termine sind aus 8-K/10-Q ableitbar. Künftige nur mit lizenzierter Quelle |
| Prognosemärkte | Polymarket (Gamma-API), Kalshi (Market-Data-API) | technisch ja | **Offen:** kommerzielle Anzeige und Speicherung laut Nutzungsbedingungen, Polymarket-Beschränkungen für bestimmte Länder, **DSGVO** bei der Anzeige pseudonymer Wallet-Profile. Kalshi zeigt keine Einzelpersonen |
| Nachrichten Behörden und Notenbanken | RSS/Pressebereiche von Fed, EZB, SEC (vorhanden), ESMA, BaFin, BoE, BoJ, PBoC, RBA, SARB, BCB … | ja | Je Behörde eigene Bedingungen. Meist sind Überschrift, Kurztext und Link erlaubt |
| Börsenmitteilungen | ASX, HKEX, SGX, JSE, B3, Euronext … | teilweise | Oft nur Webseite, keine API, teils Weiterverwendungsverbote. Einzeln prüfen |
| Unternehmensmeldungen | IR-RSS der Unternehmen, 8-K | ja | Keine Volltexte übernehmen |
| Redaktionell, weltweit | GDELT (Metadaten, Links) | ja, kostenlos | Liefert nur Metadaten und Links, keine Texte. Die Qualität schwankt, daher nur als Kandidatenquelle |
| Agenturen | dpa, Reuters, AP, AFP, Kyodo, Xinhua, AAP, ANA … | nur mit Lizenzvertrag | **Nicht kostenlos. Kein Vertragsschluss ohne Auftrag.** Angebot anfragen erst nach Freigabe |
| Russland | Interfax, TASS | technisch ja | TASS ist staatlich und muss so gekennzeichnet werden. **Vor einer Anbindung die EU-Sanktionen gegen russische Medien prüfen** |
| Übersetzung und Zusammenfassung | maschinell | ja | Das ist ein **Betriebskostenpunkt** (Übersetzungs-API oder LLM). Nicht ohne Auftrag aktivieren. Ergebnisse sichtbar als maschinelle Übersetzung kennzeichnen |
| Chartbibliothek | eigenes SVG (vorhanden) oder TradingView Lightweight Charts | beides | Lightweight Charts: Apache-2.0 mit **Attributionspflicht**. Zeichenwerkzeuge (Fibonacci) sind nicht enthalten und müssen selbst gebaut werden |

Gratisangebote und Betriebskosten sind getrennt zu sehen. Auch ein kostenloser Datentarif verursacht Kosten für Server, Cache und Übersetzung.

---

## 3. Entwurf der Aktienseite (mobil zuerst)

```
┌──────────────────────────────────────────┐
│ Apple Inc.                    [☆ Beobachten]│
│ AAPL · Nasdaq · USD                        │
│ 227,48 USD  ▲ +1,24 % (+2,79)              │
│ Schluss 26.09., 16:00 New York · Börse zu  │  ← Datenstand + Handelsstatus
├──────────────────────────────────────────┤
│ FUNDAMENTALES SCOREBOARD   Methodik v2 ⓘ  │
│ Gesamt: überdurchschnittlich (68)          │  ← nur bei ausreichenden Daten
│ Qualität ████████░ stark                   │
│ Bewertung ███░░░░░ unterdurchschnittlich   │
│ Wachstum/Aktie █████░░ durchschnittlich    │
│ Stabilität ███████░ überdurchschnittlich   │
│ Kapitalverw. ██████░ überdurchschnittlich  │
│ ⚠ 1 Warnsignal · Daten: 100 % · GJ 09/2025 │  ← getrennt vom Score
├──────────────────────────────────────────┤
│ Marktkap. 3,4 Bio. USD │ Umsatz +2 % (GJ) │  ← max. 6 Zahlen, 2 Spalten
│ EPS 6,08 USD (GJ)      │ FCF 108 Mrd.     │     mit Einheit und Zeitraum
│ Nettoliq. 0,1 × OCF    │ FCF-Rendite 3,2 %│
├──────────────────────────────────────────┤
│ [1T][7T][1M][3M][6M][YTD][1J][5J][Max][⋯] │
│  ~~~~~~~~ großer Chart ~~~~~~~~            │
│ +12,4 % (+24,90 USD) im Zeitraum · Kurs    │
│ [Linie▾] [+ Werkzeug] [+ Vergleich] [Marker]│
├──────────────────────────────────────────┤
│ Was hat sich verändert? (max. 3, belegt)   │
├──────────────────────────────────────────┤
│ ▸ Unternehmensanalyse (A · B · C als Tabs) │
│ ▸ Insider & Beteiligungsmeldungen          │
│ ▸ Prognosemärkte (nur wenn passend)        │
│ ▸ Nachrichten & Termine                    │
│ ▸ Methodik, Quellen, weitere Kennzahlen    │
└──────────────────────────────────────────┘
```

Die Zahlen im Entwurf sind **Platzhalter und keine Daten.**

Auf dem Desktop stehen Kopf und Scoreboard nebeneinander, darunter der Chart in voller Breite. „Alarm einstellen“ erscheint erst, wenn Alarme tatsächlich funktionieren (Konto und Benachrichtigungsweg). Einen deaktivierten Scheinknopf gibt es nicht.

**Kennzahlen im Überblick (höchstens 6, je nach Branchenprofil):**

| Profil | Kennzahlen |
|---|---|
| Standard | Marktkap., Umsatzwachstum, EPS verwässert, freier Cashflow, Nettoverschuldung ÷ OCF, FCF-Rendite bzw. KGV (nur bei positivem Gewinn) |
| Unprofitabel | Marktkap., Umsatzwachstum, operatives Ergebnis, Cash-Reichweite (Monate), Verwässerung, EV/Umsatz |
| Banken | Marktkap., EPS, Eigenkapitalrendite, Eigenkapital ÷ Bilanzsumme, Kurs-Buchwert, Dividende je Aktie |
| Versicherer | wie Banken. Die Schaden-Kosten-Quote fehlt in Standard-XBRL und wird als nicht verfügbar gezeigt |
| Immobilien/REITs | Marktkap., Umsatzwachstum, Verschuldung, Kurs-Buchwert, Ausschüttung. FFO ist nicht standardisiert und wird als nicht verfügbar gezeigt |

Jede Zahl trägt Einheit, Währung und Berichtszeitraum, zum Beispiel „GJ bis 09/2025“ oder „TTM bis 06/2026“. Weicht die Berichtswährung von der Kurswährung ab und gibt es keinen EZB-Referenzkurs, erscheint keine Bewertungskennzahl, sondern ein Hinweis.

---

## 4. Bewertungssystem und Chartumfang

### 4.1 Fundamentales Scoreboard v2 (Vorschlag, zu prüfen)

**Säulen und Gewichte:** Geschäftsqualität 25 %, Bewertung 25 %, Wachstum je Aktie 20 %, Finanzielle Stabilität 20 %, Kapitalverwendung 10 %.

| Säule | Kennzahlen (je 5 Jahre mit Median und jüngster Veränderung) |
|---|---|
| Geschäftsqualität | Kapitalrendite (ROIC ≈ EBIT × (1 − Steuerquote) ÷ investiertes Kapital), Höhe **und** Schwankung der operativen Marge, Cash-Conversion (FCF ÷ Jahresüberschuss) |
| Bewertung | FCF-Rendite auf den Unternehmenswert, EV/EBIT, KGV nur bei positivem Gewinn. Jeweils gegen die eigene 5-Jahres-Historie **und** die Vergleichsgruppe |
| Wachstum je Aktie | Umsatz/Aktie, EPS verwässert und FCF/Aktie, jeweils als 3- und 5-Jahres-CAGR. Wachstum wird nicht berechnet, wenn der Basiswert ≤ 0 ist oder unter 25 % des 5-Jahres-Medians liegt (problematische Basis) |
| Finanzielle Stabilität | Nettoverschuldung ÷ OCF, Zinsdeckung (EBIT ÷ Zinsaufwand), Jahre mit positivem FCF von 5 |
| Kapitalverwendung | Veränderung der verwässerten Aktienanzahl (Verwässerung), Ausschüttungen und Rückkäufe gedeckt durch FCF oder schuldenfinanziert, aktienbasierte Vergütung ÷ Umsatz (falls gemeldet) |

**Punkte:**
- Mit Vergleichsgruppe (mindestens 12 Unternehmen gleicher SIC-Gruppe, über SEC `frames`): Perzentil in der Gruppe.
- Sonst: feste, dokumentierte Schwellen, gekennzeichnet mit „ohne Vergleichsgruppe“.
- Die Säule ist der Mittelwert ihrer Kennzahlen.

**Wortskala:** 0–19 schwach · 20–39 unterdurchschnittlich · 40–59 durchschnittlich · 60–79 überdurchschnittlich · 80–100 stark. Die Punkte sind aufklappbar.

**Mindestanforderungen (vor der Umsetzung festgelegt):**
- **Säule gültig:**
  - mindestens 2 ihrer 3 Kennzahlen;
  - mindestens 3 Geschäftsjahre;
  - letzter Jahresabschluss höchstens 18 Monate alt;
  - bei „Bewertung“ zusätzlich ein Kurs, der höchstens 5 Handelstage alt ist, und eine Währung passend zum Abschluss.
- **Gesamtwert (Punktzahl):** nur, wenn **alle fünf** Säulen gültig sind.
- **Genau eine Säule mit höchstens 20 % Gewicht fehlt:**
  - Statt einer Zahl erscheint eine **Spanne**. Die fehlende Säule wird einmal mit 0 und einmal mit 100 eingesetzt, zum Beispiel „zwischen 52 und 72, unvollständig“.
  - So wird weder mit null aufgefüllt noch umgewichtet.
- **Sonst:** kein Gesamtwert, mit Begründung.

**Branchenregeln:**

| Profil | Regel |
|---|---|
| Banken, Versicherer | Eigenes Modell: Qualität = Eigenkapitalrendite und Gesamtkapitalrendite; Bewertung = Kurs-Buchwert und KGV; Stabilität = Eigenkapital ÷ Bilanzsumme. FCF und Nettoverschuldung sind ausgeschlossen. Fehlen Kernquoten in XBRL (etwa Tier 1 oder die Schaden-Kosten-Quote), gibt es **keinen Gesamtwert** |
| REITs | Kein Gesamtwert, solange FFO nicht verlässlich vorliegt. Die Säulen werden einzeln gezeigt |
| Unprofitabel (operatives Ergebnis in 2 der letzten 3 Jahre negativ) | Kein Gesamtwert. Qualität zeigt den Weg zur Profitabilität, Bewertung nutzt nur EV/Umsatz relativ zur Gruppe, Stabilität zeigt die Cash-Reichweite |
| Rohstoffe | Durchschnitte über den Zyklus (5 Jahre) statt des letzten Jahres |

**Sondereffekte:**
- Wertminderungen und Veräußerungsgewinne sind als XBRL-Konzepte verfügbar (zum Beispiel `GoodwillImpairmentLoss`, `GainLossOnSaleOfBusiness`).
- Übersteigen sie 10 % des Jahresüberschusses, wird ein Hinweis angezeigt. Wachstumsraten mit diesem Jahr als Basis werden als „durch Sondereffekt verzerrt“ markiert.

**Warnsignale:**
- Sie stehen immer sichtbar neben dem Score und ändern ihn nicht.
- Beispiele: negatives Eigenkapital, Umsatzrückgang, negativer FCF, Verschuldung über 4 × OCF, Verwässerung über 5 % in 3 Jahren, unvollständige Schulden, ein Abschluss älter als 15 Monate, Währungskonflikt.

**Datenabdeckung und Aktualität:** eigene Zeile, ohne Einfluss auf den Score.

**Versionierung und Veränderungen:**
- `SCORE_METHOD_VERSION = "fundamental-v2.0"`.
- Ob sich der Score verändert hat, wird deterministisch berechnet: gegen denselben Score **auf Basis des Vorjahresabschlusses** bzw. des vorherigen Kurses. So entsteht die Aussage „Bewertung von durchschnittlich auf unterdurchschnittlich, weil die FCF-Rendite von 4,1 % auf 3,2 % fiel“.
- Eine Datenbank ist dafür nicht nötig.
- Beim Wechsel von v1 auf v2 erklärt ein Hinweis, warum Momentum, Kursstabilität und Revisionen herausgefallen sind.

**Drei Blickwinkel (A Qualität und Wert, B Risiko, C Wachstum und Erwartungen):**
- Sie sind aufklappbare Erläuterungen **ohne eigenen Score**.
- Nutzen sie eine Scoreboard-Kennzahl, ist sie als „siehe Scoreboard“ markiert und zählt nicht als zusätzlicher Beleg.

| Blickwinkel | Inhalt | Wiederverwendung |
|---|---|---|
| A | Ertragsbeständigkeit, Kapitalrendite, Hinweise auf Wettbewerbsvorteile nur mit Beleg (Marge allein reicht nicht), Szenarien Bär/Basis/Bulle, Sicherheitsabstand, Reverse-DCF. Keine Aussagen im Namen von Investoren | `stock-model.ts`, `impliedGrowth` |
| B | Volatilität, Drawdowns, Beta und Korrelation zu Benchmark-ETF, Währungs- und Zinsabhängigkeit (Zinsdeckung, variable Schulden, soweit gemeldet), Stressszenarien mit offengelegten Annahmen (zum Beispiel „Markt −20 % × Beta“). Portfolioaussagen nur mit Portfolio | `performance.ts` |
| C | Wachstum je Aktie, Ausblick aus 8-K, relative Bewertung zur Vergleichsgruppe, optimistisches und skeptisches Szenario gleich lang. Revisionen: „keine geeignete Quelle verbunden“ | – |

### 4.2 Chartumfang

**Zeitraum und Kerzenintervall sind getrennt.** Das Intervall wird automatisch gewählt und ist änderbar.

| Zeitraum | Aktie (Intervall) | Krypto | Bedingung |
|---|---|---|---|
| 1 Stunde | 1 min | 1 min | Aktie nur während der Handelszeit, sonst „nicht verfügbar – Börse geschlossen“ |
| 1 Handelstag / 24 h | 5 min | 5 min | Aktie = letzte reguläre Sitzung. Vor- und Nachbörse nur, wenn der Tarif sie liefert, dann als eigener Bereich hinterlegt |
| 7 Tage | 30 min | 1 h | Handelspausen und Wochenenden werden komprimiert (Achse nach Handelszeit), mit Sitzungstrennern |
| 1 Monat | 1 h | 4 h | |
| 3 M, 6 M, lfd. Jahr, 1 J | 1 Tag | 1 Tag | „Laufendes Jahr“ ab dem ersten Handelstag in **Börsenzeit** |
| 5 J | 1 Woche | 1 Woche | |
| Max | 1 Monat | 1 Woche | Echte gesamte Historie, nicht 1.300 Tage |
| Frei | automatisch, höchstens ~1.500 Punkte | | |

**Funktionen, Etappe 1:**
- Linie, Fläche und Kerzen (nur mit OHLC).
- Absolute und prozentuale Veränderung im Zeitraum.
- Fadenkreuz mit Datum, Uhrzeit (Börsenzeit und Ortszeit) und Wert.
- Bedienung per Maus, Touch (Ziehen, Pinch) und Tastatur (Pfeile, Pos1/Ende, Esc).
- Bereich auswählen und zurücksetzen.
- Nicht verfügbare Zeiträume werden deaktiviert, mit Grund.

**Etappe 2:**
- Vergleich mit Aktien und Benchmark-ETF, auf 100 normalisiert. Die Währung wird auf Wunsch über EZB-Referenzkurse umgerechnet, ohne Umrechnung wird der Unterschied gekennzeichnet.
- Marker für 10-K/10-Q, 8-K, Splits, Dividenden und Insider.
- Insider-Marker liegen am **Meldetag**, der Handelstag steht im Tooltip. Sonst wirkt eine Meldung früher bekannt, als sie war.

**Kennzeichnung:** „Kurs, splitbereinigt“ und „Gesamtrendite inkl. Dividenden“ werden nie vermischt und sind immer beschriftet. Die Gesamtrendite gibt es erst, wenn Dividendendaten geprüft vorliegen.

**Werkzeuge:**
- Die Standardansicht ist ein ruhiger Kurschart. Werkzeuge kommen über „+ Werkzeug“ mit Suche hinzu, jeweils mit einem Satz Erklärung, und lassen sich einzeln entfernen.
- Es gibt keine Kauf- oder Verkaufsampel.

| Stufe | Werkzeug | Datenbedarf und Einschränkung |
|---|---|---|
| Kostenlos | Volumen, SMA, EMA, RSI (Wilder), MACD (12/26/9) | OHLCV bzw. Schlusskurse |
| Pro | Bollinger, ATR, Stochastik, ADX/DMI, OBV, Donchian, Keltner, ROC, CCI, MFI, Williams %R, Chaikin Money Flow, Ichimoku | High, Low und Volumen nötig. Ohne sie wird das Werkzeug nicht angeboten |
| Pro | VWAP | **Nur intraday, je Sitzung verankert.** Auf Tageskerzen irreführend und dort nicht angeboten |
| Pro | Fibonacci-Retracement (Zeichenwerkzeug, keine Kurve) | Eigene Umsetzung, auch mit Lightweight Charts |

Jeder Indikator wird gegen veröffentlichte Referenzrechnungen getestet (Wilders Originalbeispiele, StockCharts ChartSchool). Ungenaue Anlaufwerte werden nicht gezeichnet.

---

## 5. Etappen (klein, priorisiert)

Jede Etappe endet mit:
- Tests, Typprüfung und Lint;
- `next build`;
- Browserprüfung per Playwright auf Smartphone und Desktop, jeweils hell und dunkel;
- Commit auf dem Branch.

| # | Etappe | Inhalt | Neue Quelle / Kosten |
|---|---|---|---|
| 0 | **Ladezeit messen und beheben** | Zeitmessung je Quelle. Drosselung nur vor echten Netzabrufen. `companyfacts` statt 15–25 Einzelabrufen. `generateMetadata` ohne zweiten Datenabruf. `Suspense` je Abschnitt, damit keine Quelle die Seite blockiert. Dazu die Fehler bei „Max“ und „laufendes Jahr“ | keine |
| 1 | Seitenaufbau | Neue Reihenfolge, Kopf mit Handelsplatz, Währung und Status, höchstens 6 Kennzahlen je Branchenprofil, aufklappbare Bereiche, mobil zuerst. Nur vorhandene Daten | keine |
| 2 | Scoreboard v2 (feste Schwellen) | Reine Funktionen mit Tests: Säulen, Mindestanforderungen, Spanne statt Umgewichtung, Branchenregeln, Sondereffekte, Warnsignale, Methodikversion, Erklärung von Änderungen | keine |
| 3 | Chart-Grundlage | OHLCV-Parser, Modell für Zeitraum und Intervall, Sitzungen und Zeitzonen, Linie, Fläche und Kerzen, Fadenkreuz, Touch und Tastatur, Bereichsauswahl. Kurze Zeiträume laden erst bei Bedarf (Route-Handler mit Cache) | Twelve Data, gleicher Schlüssel, mehr Credits |
| 4 | Kostenlose Werkzeuge | Volumen, SMA, EMA, RSI, MACD mit Referenztests, Suche, einzeln entfernbar | keine |
| 5 | Insider auf der Aktienseite | Person, Rolle, Handlung, Betrag, Anteil am Bestand, Handels- und Meldetag, Plan-Kennzeichen, Link | keine (SEC) |
| 6 | Vergleich und Marker | Normalisierung, Benchmark-ETF, EZB-Währungsumrechnung, Marker für Berichte und Insider | keine |
| 7 | Blickwinkel A, B, C | Aufklappbar, ohne eigenen Score, Doppelzählungsschutz | keine |
| 8 | Vergleichsgruppen | SEC `frames`, Perzentile statt fester Schwellen (Score v2.1) | keine |
| 9 | „Was hat sich verändert?“ und Unternehmensnachrichten | 8-K/10-Q-Ereignisse, Scoreänderung, Insider-Cluster (höchstens 3). Unternehmensbezogene Meldungen aus SEC und IR-Feeds, Dubletten zusammengefasst | keine |
| 10 | Splits, Dividenden, Gesamtrendite | nach Tarif- und Bereinigungsprüfung | ggf. Twelve-Data-Tarif |
| 11 | Prognosemärkte | Erst nach der Lizenz- und DSGVO-Prüfung: eigene Seite, höchstens 5 auf der Startseite, Aktienseite nur bei echtem Bezug | offen |
| 12 | Tarife | Erst nach Klärung: Konto, Berechtigungsprüfung, Tests für Zugriffsrechte. Keine Zahlungsanbieter | offen (Konto und Datenbank) |
| 13 | Pro-Werkzeuge | nach Etappe 12 | keine |
| 14 | Weltweite Nachrichten | Quellenregister je Region mit Rechten und Lücken. Übersetzung erst nach Kostenfreigabe | offen |

---

## 6. Vor der Umsetzung zu klären

1. **Tarife:**
   - Soll „Beobachten/Watchlist“ künftig Plus sein? Heute ist die Watchlist kostenlos. Vorschlag: Die lokale Watchlist bleibt kostenlos, synchronisierte Watchlist, Feed und Alarme werden Plus.
   - Ist „Max“ im Chart kostenlos, und was bedeutet „vertiefte Historien“ in Pro? Vorschlag: Kurse vollständig kostenlos, vertiefte Historie = Fundamental- und Insiderhistorie über 5 Jahre hinaus.
   - Die widersprüchlichen Angaben auf `/datenquellen` werden an die Entscheidung angepasst.
2. **Öffentlicher Betrieb:** Der Twelve-Data-Gratistarif erlaubt nur private Nutzung. Solange kein lizenzierter Kursanbieter beauftragt ist, bleibt die Seite privat.
3. **Chartbibliothek:**
   - Empfehlung: TradingView Lightweight Charts (Apache-2.0, Attribution sichtbar, etwa 45 KB). Sie bringt Kerzen, Fadenkreuz, Touch und Performance mit. Indikatoren und Fibonacci bauen wir selbst.
   - Alternative: das eigene SVG weiter ausbauen. Das ist deutlich mehr Aufwand, besonders für Touch, Kerzen und Performance bei vielen Punkten.
4. **Gesamtwert:** Die Spannenregel bei genau einer fehlenden Säule (höchstens 20 %) muss bestätigt werden. Alternative: Gesamtwert nur, wenn alle fünf Säulen gültig sind.
