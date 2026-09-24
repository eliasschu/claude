import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseEcbCsv, parseEiaSeries, parseTreasuryXml } from "../lib/sources/parsers/macro.ts";
import { parseFeed } from "../lib/sources/parsers/rss.ts";
import { annualValues, filingUrls, latestSharesOutstanding, normalizeSubmissions, normalizeTickerIndex, parseForm4 } from "../lib/sources/parsers/sec.ts";
import { normalizeCoinDetail, normalizeCoinMarkets, normalizeMarketChart } from "../lib/sources/parsers/coingecko.ts";
import { normalizeQuote, normalizeTimeSeries, readProviderError } from "../lib/sources/parsers/twelvedata.ts";

describe("EZB, Treasury, EIA", () => {
  test("liest EZB-CSV auch mit Kommas in Textfeldern", () => {
    const csv = `KEY,FREQ,TIME_PERIOD,OBS_VALUE,TITLE\nEXR,D,2026-09-18,1.1734,"US dollar/Euro, ECB"\nEXR,D,2026-09-17,1.1702,"US dollar/Euro, ECB"\n`;
    assert.deepEqual(parseEcbCsv(csv), [{ date: "2026-09-17", value: 1.1702 }, { date: "2026-09-18", value: 1.1734 }]);
  });
  test("liest die Treasury-Zinskurve", () => {
    const xml = `<feed xmlns:d="d"><entry><content><m:properties><d:NEW_DATE>2026-09-18T00:00:00</d:NEW_DATE><d:BC_10YEAR>4.12</d:BC_10YEAR></m:properties></content></entry><entry><content><m:properties><d:NEW_DATE>2026-09-17T00:00:00</d:NEW_DATE><d:BC_10YEAR>4.08</d:BC_10YEAR></m:properties></content></entry></feed>`;
    assert.deepEqual(parseTreasuryXml(xml), [{ date: "2026-09-17", value: 4.08 }, { date: "2026-09-18", value: 4.12 }]);
  });
  test("liest EIA-Werte auch als Text", () => {
    const r = parseEiaSeries({ response: { data: [{ period: "2026-09-15", value: "74.10", units: "$/BBL", "series-description": "Europe Brent Spot Price FOB" }, { period: "2026-09-14", value: 73.2 }] } });
    assert.deepEqual(r.points.map((p) => p.value), [73.2, 74.1]);
    assert.equal(r.units, "$/BBL");
  });
});

describe("RSS", () => {
  test("bereinigt Texte und verwirft unsichere Links", () => {
    const xml = `<rss><channel>
      <item><title>Fed issues &lt;b&gt;FOMC&lt;/b&gt; statement</title><link>https://www.federalreserve.gov/x.htm</link><pubDate>Wed, 16 Sep 2026 18:00:00 GMT</pubDate><description><![CDATA[<p>Text <script>x()</script>mit Markup</p>]]></description><category>Monetary Policy</category></item>
      <item><title>Böser Link</title><link>javascript:alert(1)</link></item></channel></rss>`;
    const items = parseFeed(xml);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "Fed issues FOMC statement");
    assert.equal(items[0].summary, "Text mit Markup");
    assert.equal(items[0].publishedAt, "2026-09-16T18:00:00.000Z");
    assert.deepEqual(items[0].categories, ["Monetary Policy"]);
  });
  test("liest Atom-Einträge mit Link-Attribut", () => {
    const items = parseFeed(`<feed><entry><title>EZB</title><link href="https://www.ecb.europa.eu/a.html"/><updated>2026-09-10T12:00:00Z</updated></entry></feed>`);
    assert.equal(items[0].url, "https://www.ecb.europa.eu/a.html");
  });
  test("liefert bei kaputtem XML eine leere Liste", () => {
    assert.deepEqual(parseFeed("<rss><channel><item>"), []);
  });
});

describe("SEC", () => {
  test("normalisiert das Tickerverzeichnis ohne Dubletten", () => {
    const list = normalizeTickerIndex({ fields: ["cik", "name", "ticker", "exchange"], data: [[1, "A Corp", "aaa", "Nasdaq"], [1, "A Corp", "AAA", "Nasdaq"], [2, "B Corp", "BBB", null]] });
    assert.deepEqual(list, [{ cik: 1, name: "A Corp", ticker: "AAA", exchange: "Nasdaq" }, { cik: 2, name: "B Corp", ticker: "BBB", exchange: null }]);
  });
  test("zerlegt die spaltenweise Meldungsliste", () => {
    const c = normalizeSubmissions({ cik: "1", name: "A Corp", tickers: ["AAA"], sic: "3571", filings: { recent: { accessionNumber: ["0001-26-000001"], form: ["8-K"], filingDate: ["2026-09-01"], reportDate: [""], primaryDocument: ["a.htm"], items: ["2.02,9.01"] } } })!;
    assert.equal(c.filings[0].form, "8-K");
    assert.deepEqual(c.filings[0].items, ["2.02", "9.01"]);
    assert.equal(c.filings[0].reportDate, null);
  });
  test("bildet den Link zum Form-4-Roh-XML", () => {
    const u = filingUrls(320193, "0000320193-26-000077", "xslF345X05/wk-form4_1.xml");
    assert.equal(u.rawXml, "https://www.sec.gov/Archives/edgar/data/320193/000032019326000077/wk-form4_1.xml");
    assert.match(u.index, /0000320193-26-000077-index\.htm$/);
  });
  test("nimmt Jahreswerte nur aus Jahresberichten, jüngste Einreichung gewinnt", () => {
    const units = { USD: [
      { start: "2024-10-01", end: "2025-09-30", val: 100, accn: "a", form: "10-K", filed: "2025-11-01" },
      { start: "2024-10-01", end: "2025-09-30", val: 105, accn: "b", form: "10-K", filed: "2026-11-01" },
      { start: "2025-04-01", end: "2025-06-30", val: 30, accn: "c", form: "10-Q", filed: "2025-08-01" },
      { start: "2025-01-01", end: "2025-09-30", val: 80, accn: "d", form: "10-K", filed: "2025-11-01" },
    ] };
    const v = annualValues(units, "duration", ["USD"]);
    assert.equal(v.length, 1);
    assert.equal(v[0].value, 105);
  });
  test("addiert Aktiengattungen derselben Einreichung", () => {
    const s = latestSharesOutstanding({ shares: [
      { end: "2026-07-20", val: 5_800_000_000, accn: "q2", form: "10-Q", filed: "2026-07-25" },
      { end: "2026-07-20", val: 860_000_000, accn: "q2", form: "10-Q", filed: "2026-07-25" },
      { end: "2026-04-20", val: 6_000_000_000, accn: "q1", form: "10-Q", filed: "2026-04-25" },
    ] })!;
    assert.equal(s.value, 6_660_000_000);
  });
  test("zerlegt Form 4 mit Rolle, Codes, Fußnotenpreis und 10b5-1-Hinweis", () => {
    const xml = `<?xml version="1.0"?><ownershipDocument><documentType>4</documentType><periodOfReport>2026-08-12</periodOfReport><aff10b5One>1</aff10b5One>
      <issuer><issuerCik>0000000001</issuerCik><issuerName>Testemittent Inc.</issuerName><issuerTradingSymbol>TEST</issuerTradingSymbol></issuer>
      <reportingOwner><reportingOwnerId><rptOwnerCik>9</rptOwnerCik><rptOwnerName>Muster Max</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Financial Officer</officerTitle><isTenPercentOwner>0</isTenPercentOwner></reportingOwnerRelationship></reportingOwner>
      <nonDerivativeTable>
        <nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-08-12</value></transactionDate>
          <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
          <transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
          <postTransactionAmounts><sharesOwnedFollowingTransaction><value>5000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
          <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature></nonDerivativeTransaction>
        <nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-08-12</value></transactionDate>
          <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
          <transactionAmounts><transactionShares><value>600</value></transactionShares><transactionPricePerShare><footnoteId id="F1"/></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
          <ownershipNature><directOrIndirectOwnership><value>I</value></directOrIndirectOwnership></ownershipNature></nonDerivativeTransaction>
      </nonDerivativeTable>
      <derivativeTable><derivativeTransaction><securityTitle><value>Restricted Stock Units</value></securityTitle><transactionCoding><transactionCode>M</transactionCode></transactionCoding>
        <transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts></derivativeTransaction></derivativeTable></ownershipDocument>`;
    const f = parseForm4(xml)!;
    assert.equal(f.issuerTicker, "TEST");
    assert.deepEqual(f.owners[0].roles, ["Führungskraft: Chief Financial Officer"]);
    assert.equal(f.plan10b51, true);
    assert.equal(f.transactions.length, 3);
    assert.equal(f.transactions[0].category, "ausuebung");
    assert.equal(f.transactions[0].acquired, true);
    assert.equal(f.transactions[1].category, "verkauf");
    assert.equal(f.transactions[1].price, null, "Fußnotenpreis darf nicht erfunden werden");
    assert.equal(f.transactions[1].ownership, "indirekt");
    assert.equal(f.transactions[2].table, "derivativ");
  });
  test("liefert bei fremdem XML null", () => {
    assert.equal(parseForm4("<html>kein Form 4</html>"), null);
  });
});

describe("CoinGecko", () => {
  const raw = [
    { id: "coin-a", symbol: "aaa", name: "Coin A", current_price: 10, market_cap: 1000, market_cap_rank: 1, fully_diluted_valuation: 5000, total_volume: 50, circulating_supply: 100, max_supply: 500, last_updated: "2026-09-22T10:00:00.000Z", price_change_percentage_1h_in_currency: 0.1, price_change_percentage_24h_in_currency: -2, price_change_percentage_7d_in_currency: null, sparkline_in_7d: { price: Array.from({ length: 168 }, (_, i) => 10 + i / 100) } },
    { id: "coin-a", symbol: "aaa", name: "Doppelt", current_price: 1, market_cap: 1 },
    { id: "coin-b", symbol: "bbb", name: "Coin B", current_price: null, market_cap: 0 },
  ];
  test("normalisiert, entfernt Dubletten und trennt FDV von Marktkapitalisierung", () => {
    const rows = normalizeCoinMarkets(raw);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].marketCap, 1000);
    assert.equal(rows[0].fdv, 5000);
    assert.equal(rows[0].symbol, "AAA");
    assert.equal(rows[0].change7d, null);
    assert.ok(rows[0].sparkline7d.length <= 48);
  });
  test("ersetzt fehlende Werte nicht durch null-Werte", () => {
    const b = normalizeCoinMarkets(raw)[1];
    assert.equal(b.price, null);
    assert.equal(b.marketCap, null);
  });
  test("unterscheidet begrenztes, unbegrenztes und nicht angegebenes Maximalangebot", () => {
    const base = { id: "x", name: "X", symbol: "x" };
    assert.deepEqual(normalizeCoinDetail({ ...base, market_data: { max_supply: 21000000 } })!.maxSupply, { kind: "begrenzt", value: 21000000 });
    assert.deepEqual(normalizeCoinDetail({ ...base, market_data: { max_supply: null, max_supply_infinite: true } })!.maxSupply, { kind: "unbegrenzt" });
    assert.deepEqual(normalizeCoinDetail({ ...base, market_data: { max_supply: null } })!.maxSupply, { kind: "nicht angegeben" });
  });
  test("übernimmt Vertragsadressen je Netzwerk", () => {
    const d = normalizeCoinDetail({ id: "t", name: "T", symbol: "t", detail_platforms: { ethereum: { contract_address: "0xabc" }, "": { contract_address: "" } } })!;
    assert.deepEqual(d.contracts, [{ network: "ethereum", address: "0xabc" }]);
  });
  test("sortiert Verlaufspunkte und verwirft ungültige", () => {
    assert.deepEqual(normalizeMarketChart({ prices: [[3, 1], [1, 2], ["x", 1], [2, NaN]] }), [[1, 2], [3, 1]]);
  });
});

describe("Twelve Data", () => {
  test("erkennt Fehler im Antwortrumpf trotz HTTP 200", () => {
    assert.deepEqual(readProviderError({ code: 429, status: "error", message: "limit" }), { code: 429, message: "limit" });
    assert.equal(readProviderError({ symbol: "AAPL" }), null);
  });
  test("liest Kurs, Vorwert, Veränderung und Kurszeitpunkt", () => {
    const q = normalizeQuote({ symbol: "aapl", exchange: "NASDAQ", currency: "USD", close: "182.50", previous_close: "180.00", timestamp: 1790000000, is_market_open: true })!;
    assert.equal(q.symbol, "AAPL");
    assert.equal(q.price, 182.5);
    assert.equal(q.changeAbs, 2.5);
    assert.ok(Math.abs(q.changePct! - 1.3888) < 0.001);
    assert.equal(q.observedAt, new Date(1790000000000).toISOString());
  });
  test("bringt die Zeitreihe in aufsteigende Reihenfolge", () => {
    const pts = normalizeTimeSeries({ values: [{ datetime: "2026-09-18", close: "182.50" }, { datetime: "2026-09-17", close: "180.00" }, { datetime: "kaputt", close: "1" }] });
    assert.equal(pts.length, 2);
    assert.ok(pts[0][0] < pts[1][0]);
    assert.equal(pts[1][1], 182.5);
  });
});
