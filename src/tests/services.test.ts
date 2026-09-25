/**
 * Durchstich-Tests: Dienste gegen nachgebaute Anbieterantworten. Die
 * Antworten bilden nur das dokumentierte Format nach und liegen
 * ausschliesslich im Testordner.
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { __resetHttpState } from "../lib/core/http.ts";
import { __resetTickerCache } from "../lib/sources/sec.ts";
import { getStockOverview } from "../lib/services/stocks.ts";
import { getInsiderActivity } from "../lib/services/insider.ts";
import { getWhalePortfolio, getConsensusPicks } from "../lib/services/whales.ts";
import { getNews } from "../lib/services/news.ts";
import { getMarketCard } from "../lib/services/markets.ts";
import { getCryptoRanking } from "../lib/services/crypto.ts";
import { marketBySlug } from "../config/markets.ts";

type Handler = (url: string) => Response | null;
const original = globalThis.fetch;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", date: "Wed, 23 Sep 2026 08:00:00 GMT" } });
const text = (b: string) => new Response(b, { status: 200, headers: { date: "Wed, 23 Sep 2026 08:00:00 GMT" } });

let calls: string[] = [];
function route(handlers: Handler[]) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    for (const h of handlers) {
      const r = h(url);
      if (r) return r;
    }
    return new Response("nicht gefunden", { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  process.env.SEC_EDGAR_USER_AGENT = "Finanzwelt Test test@example.org";
  delete process.env.TWELVEDATA_API_KEY;
  delete process.env.COINGECKO_API_KEY;
});
afterEach(() => {
  globalThis.fetch = original;
  __resetHttpState();
  __resetTickerCache();
});

/* ---------------- SEC-Nachbau ---------------- */

const years = ["2021", "2022", "2023", "2024", "2025"];
const annual = (vals: number[], unit = "USD") => ({
  units: { [unit]: vals.map((v, i) => ({ start: `${years[i]}-01-01`, end: `${years[i]}-12-31`, val: v, accn: `acc-${i}`, form: "10-K", filed: `${Number(years[i]) + 1}-02-15` })) },
});
const instant = (vals: number[]) => ({
  units: { USD: vals.map((v, i) => ({ end: `${years[i]}-12-31`, val: v, accn: `acc-${i}`, form: "10-K", filed: `${Number(years[i]) + 1}-02-15` })) },
});

const CONCEPT_DATA: Record<string, unknown> = {
  RevenueFromContractWithCustomerExcludingAssessedTax: annual([1000, 1100, 1210, 1331, 1464]),
  OperatingIncomeLoss: annual([200, 220, 250, 280, 310]),
  NetIncomeLoss: annual([150, 165, 185, 210, 230]),
  NetCashProvidedByUsedInOperatingActivities: annual([220, 240, 260, 290, 320]),
  PaymentsToAcquirePropertyPlantAndEquipment: annual([40, 45, 50, 55, 60]),
  CashAndCashEquivalentsAtCarryingValue: instant([300, 320, 350, 380, 400]),
  LongTermDebt: instant([200, 200, 200, 200, 200]),
  StockholdersEquity: instant([800, 850, 900, 950, 1000]),
  EarningsPerShareDiluted: annual([1.5, 1.65, 1.85, 2.1, 2.3], "USD/shares"),
  WeightedAverageNumberOfDilutedSharesOutstanding: annual([100, 100, 100, 100, 100], "shares"),
};

const form4 = (owner: string, code: string, date: string) => `<ownershipDocument><documentType>4</documentType>
  <issuer><issuerCik>0000000042</issuerCik><issuerName>Test Corp</issuerName><issuerTradingSymbol>TEST</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerName>${owner}</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isOfficer>1</isOfficer><officerTitle>CEO</officerTitle></reportingOwnerRelationship></reportingOwner>
  <nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>${date}</value></transactionDate>
  <transactionCoding><transactionCode>${code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>100</value></transactionShares>
  <transactionPricePerShare><value>50</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
  </nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;

const secHandler: Handler = (url) => {
  if (url.includes("company_tickers_exchange.json")) return json({ fields: ["cik", "name", "ticker", "exchange"], data: [[42, "Test Corp", "TEST", "Nasdaq"], [43, "Bank Corp", "BANK", "NYSE"]] });
  if (url.includes("/submissions/CIK0000000042.json")) return json({
    cik: "42", name: "Test Corp", tickers: ["TEST"], exchanges: ["Nasdaq"], sic: "7372", sicDescription: "Prepackaged Software",
    filings: { recent: {
      accessionNumber: ["0000000042-26-000010", "0000000042-26-000009", "0000000042-26-000008"],
      form: ["4", "4", "8-K"], filingDate: ["2026-09-10", "2026-09-08", "2026-09-01"], reportDate: ["2026-09-08", "2026-09-05", ""],
      primaryDocument: ["xslF345X05/a.xml", "xslF345X05/b.xml", "k.htm"], items: ["", "", "2.02,9.01"],
    } },
  });
  if (url.includes("/submissions/CIK0000000043.json")) return json({ cik: "43", name: "Bank Corp", sic: "6021", filings: { recent: {} } });
  if (url.endsWith("/a.xml")) return text(form4("Muster Anna", "P", "2026-09-08"));
  if (url.endsWith("/b.xml")) return text(form4("Muster Bernd", "P", "2026-09-05"));
  const concept = url.match(/companyconcept\/CIK\d+\/[\w-]+\/(\w+)\.json/);
  if (concept && CONCEPT_DATA[concept[1]]) return json(CONCEPT_DATA[concept[1]]);
  return null;
};

describe("Aktienanalyse von der Quelle bis zur Bewertung", () => {
  test("baut aus SEC-Daten Bewertungsband, Scorecard und Kurzfazit – ohne erfundenen Kurs", async () => {
    route([secHandler]);
    const r = await getStockOverview("test");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data.company.name, "Test Corp");
    assert.equal(r.data.financials.latest!.freeCashFlow, 260);
    assert.equal(r.data.model.applicable, true);
    assert.ok(r.data.model.band.bear! < r.data.model.band.bull!);
    assert.equal(r.data.prices.quote, null);
    assert.match(r.data.prices.unavailable!, /TWELVEDATA_API_KEY/);
    assert.equal(r.data.model.price.verdict, "Datenlage unzureichend");
    assert.equal(r.data.scorecard.overall, null);
    assert.ok(r.data.summary.bull.length > 0);
    assert.equal(r.data.filings[0].title, "Geschäftszahlen und Finanzlage");
    assert.ok(calls.some((u) => u.includes("companyconcept")), "Kennzahlen werden einzeln abgerufen");
  });

  test("mit Kursschlüssel: echter Kurs, Abschlag und Potenzial getrennt, eingepreistes Wachstum", async () => {
    process.env.TWELVEDATA_API_KEY = "test";
    const twelve: Handler = (url) => {
      if (url.includes("api.twelvedata.com/quote")) return json({ symbol: "TEST", exchange: "NASDAQ", currency: "USD", close: "30.00", previous_close: "29.50", timestamp: 1790150000, is_market_open: false });
      if (url.includes("api.twelvedata.com/time_series")) return json({ values: Array.from({ length: 300 }, (_, i) => ({ datetime: new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10), close: String(25 + i / 60) })).reverse() });
      return null;
    };
    route([secHandler, twelve]);
    const r = await getStockOverview("TEST");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data.prices.quote!.price, 30);
    const base = r.data.model.band.base!;
    assert.ok(Math.abs(r.data.model.price.discountToBasePct! - ((base - 30) / base) * 100) < 1e-9);
    assert.ok(Math.abs(r.data.model.price.upsideToBasePct! - ((base - 30) / 30) * 100) < 1e-9);
    assert.notEqual(r.data.model.price.verdict, "Datenlage unzureichend");
    assert.notEqual(r.data.scorecard.overall, null, "mit Kursdaten sind genug Dimensionen belegt");
    assert.equal(r.data.prices.quoteMeta!.observedAt, new Date(1790150000000).toISOString(), "Kurszeitpunkt statt Abrufzeitpunkt");
    assert.equal(r.data.prices.quoteMeta!.fetchedAt, "2026-09-23T08:00:00.000Z");
  });

  test("Twelve-Data-Fehler im Antwortrumpf wird als Abruflimit erkannt", async () => {
    process.env.TWELVEDATA_API_KEY = "test";
    route([secHandler, (url) => (url.includes("twelvedata") ? json({ code: 429, status: "error", message: "Limit erreicht" }) : null)]);
    const r = await getStockOverview("TEST");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data.prices.quote, null);
    assert.match(r.data.prices.unavailable!, /Limit/);
  });

  test("ohne SEC-Kontaktangabe klare Meldung statt Abruf", async () => {
    delete process.env.SEC_EDGAR_USER_AGENT;
    route([secHandler]);
    const r = await getStockOverview("TEST");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "not_configured");
    assert.equal(calls.length, 0, "ohne Kontaktangabe darf die SEC nicht angefragt werden");
  });

  test("unbekannter Ticker ergibt 'nicht gefunden'", async () => {
    route([secHandler]);
    const r = await getStockOverview("GIBTSNICHT");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "not_found");
  });
});

describe("Insidermeldungen", () => {
  test("liest Form 4, berechnet Meldeverzug und Alter und erkennt mehrere Käufer", async () => {
    route([secHandler]);
    const r = await getInsiderActivity(["TEST"], 90, 10, new Date("2026-09-23T10:00:00Z"));
    assert.equal(r.rows.length, 2);
    const anna = r.rows.find((x) => x.owner === "Anna Muster")!;
    assert.equal(anna.delayDays, 2);
    assert.equal(anna.ageDays, 13);
    assert.equal(anna.value, 5000);
    assert.equal(anna.role, "CEO");
    assert.equal(anna.materiality, "hoch");
    assert.equal(r.clusters.length, 1);
    assert.deepEqual(r.clusters[0].owners.sort(), ["Anna Muster", "Bernd Muster"]);
  });

  test("entfernt die doppelte Ausübungszeile und fasst Teilverkäufe zusammen", async () => {
    const exerciseXml = `<ownershipDocument><documentType>4</documentType>
      <issuer><issuerCik>0000000099</issuerCik><issuerName>Exercise Corp</issuerName><issuerTradingSymbol>EXRC</issuerTradingSymbol></issuer>
      <reportingOwner><reportingOwnerId><rptOwnerName>Muster Klara</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isOfficer>1</isOfficer><officerTitle>Chief Financial Officer</officerTitle></reportingOwnerRelationship></reportingOwner>
      <nonDerivativeTable>
        <nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-09-01</value></transactionDate>
          <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
          <transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
          <postTransactionAmounts><sharesOwnedFollowingTransaction><value>3000</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
        <nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-09-01</value></transactionDate>
          <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
          <transactionAmounts><transactionShares><value>400</value></transactionShares><transactionPricePerShare><value>60</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
          <postTransactionAmounts><sharesOwnedFollowingTransaction><value>2600</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
        <nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-09-01</value></transactionDate>
          <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
          <transactionAmounts><transactionShares><value>200</value></transactionShares><transactionPricePerShare><value>62</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
          <postTransactionAmounts><sharesOwnedFollowingTransaction><value>2400</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
      </nonDerivativeTable>
      <derivativeTable><derivativeTransaction><securityTitle><value>Stock Option</value></securityTitle><transactionDate><value>2026-09-01</value></transactionDate>
        <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
        <transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionAcquiredDisposedCode><value>D</value></transactionAmounts></derivativeTransaction></derivativeTable></ownershipDocument>`;
    route([
      (url) => url.includes("company_tickers_exchange.json") ? json({ fields: ["cik", "name", "ticker", "exchange"], data: [[99, "Exercise Corp", "EXRC", "Nasdaq"]] }) : null,
      (url) => url.includes("/submissions/CIK0000000099.json") ? json({ cik: "99", name: "Exercise Corp", filings: { recent: {
        accessionNumber: ["0000000099-26-000001"], form: ["4"], filingDate: ["2026-09-03"], reportDate: ["2026-09-01"],
        primaryDocument: ["xslF345X05/c.xml"], items: [""],
      } } }) : null,
      (url) => url.endsWith("/c.xml") ? text(exerciseXml) : null,
    ]);
    const r = await getInsiderActivity(["EXRC"], 90, 10, new Date("2026-09-10T10:00:00Z"));
    // Die Ausübung darf nur einmal erscheinen (direkte Zeile), nicht zusätzlich als Derivat-Zeile.
    const exercises = r.rows.filter((x) => x.category === "ausuebung");
    assert.equal(exercises.length, 1);
    assert.equal(exercises[0].table, "direkt");
    // Die beiden Teilverkäufe (400 @ 60, 200 @ 62) werden zu einer Zeile zusammengefasst.
    const sale = r.rows.find((x) => x.category === "verkauf")!;
    assert.equal(sale.shares, 600);
    assert.ok(Math.abs(sale.price! - 60.6667) < 0.01, "mengengewichteter Durchschnittspreis");
    assert.equal(sale.fills.length, 2);
    // Anteil am Bestand: vor dem Verkauf hielt sie 3000 Aktien, 600 wurden verkauft.
    assert.ok(Math.abs(sale.shareOfHolding! - 0.2) < 0.001);
  });
});

describe("Große Fische (13F)", () => {
  test("vergleicht zwei Quartale und erkennt neue, erhöhte, reduzierte und geschlossene Positionen", async () => {
    const q2InfoTable = `<informationTable>
      <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><cusip>037833100</cusip><value>100000</value>
        <shrsOrPrnAmt><sshPrnamt>1000000</sshPrnamt></shrsOrPrnAmt></infoTable>
      <infoTable><nameOfIssuer>OLDCO INC</nameOfIssuer><cusip>111111111</cusip><value>5000</value>
        <shrsOrPrnAmt><sshPrnamt>200000</sshPrnamt></shrsOrPrnAmt></infoTable>
    </informationTable>`;
    const q3InfoTable = `<informationTable>
      <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><cusip>037833100</cusip><value>150000</value>
        <shrsOrPrnAmt><sshPrnamt>1500000</sshPrnamt></shrsOrPrnAmt></infoTable>
      <infoTable><nameOfIssuer>NEWCO INC</nameOfIssuer><cusip>222222222</cusip><value>8000</value>
        <shrsOrPrnAmt><sshPrnamt>50000</sshPrnamt></shrsOrPrnAmt></infoTable>
    </informationTable>`;

    route([
      (url) => url.includes("/submissions/CIK0001067983.json") ? json({
        cik: "1067983", name: "Berkshire Hathaway Inc", filings: { recent: {
          accessionNumber: ["0001067983-26-000009", "0001067983-26-000005"],
          form: ["13F-HR", "13F-HR"], filingDate: ["2026-08-14", "2026-05-15"],
          reportDate: ["2026-06-30", "2026-03-31"],
          primaryDocument: ["primary_doc.xml", "primary_doc.xml"], items: ["", ""],
        } },
      }) : null,
      (url) => url.endsWith("000106798326000009/index.json") ? json({ directory: { item: [
        { name: "primary_doc.xml", type: "text.xml" }, { name: "infotable.xml", type: "text.xml" },
      ] } }) : null,
      (url) => url.endsWith("000106798326000005/index.json") ? json({ directory: { item: [
        { name: "primary_doc.xml", type: "text.xml" }, { name: "infotable.xml", type: "text.xml" },
      ] } }) : null,
      (url) => url.endsWith("000106798326000009/infotable.xml") ? text(q3InfoTable) : null,
      (url) => url.endsWith("000106798326000005/infotable.xml") ? text(q2InfoTable) : null,
    ]);

    const r = await getWhalePortfolio({ slug: "berkshire-hathaway", displayName: "Warren Buffett / Berkshire Hathaway", cik: 1067983, nameHints: ["BERKSHIRE"], note: "" });
    if (!r.ok) throw new Error(r.message);
    assert.equal(r.data.reportDate, "2026-06-30");
    assert.equal(r.data.previousReportDate, "2026-03-31");

    const apple = r.data.holdings.find((h) => h.cusip === "037833100")!;
    assert.equal(apple.change, "erhöht");
    assert.equal(apple.previousShares, 1_000_000);

    const newco = r.data.holdings.find((h) => h.cusip === "222222222")!;
    assert.equal(newco.change, "neu");

    const oldco = r.data.holdings.find((h) => h.cusip === "111111111")!;
    assert.equal(oldco.change, "geschlossen");
    assert.equal(oldco.valueUsd, 0);

    assert.equal(r.data.totalValueUsd, (150000 + 8000) * 1000);
  });

  test("sperrt die Anzeige, wenn die CIK zu einer anderen Firma gehört als erwartet", async () => {
    route([
      (url) => url.includes("/submissions/CIK0001067983.json") ? json({
        cik: "1067983", name: "Some Unrelated Corp", filings: { recent: {} },
      }) : null,
    ]);

    const r = await getWhalePortfolio({ slug: "berkshire-hathaway", displayName: "Warren Buffett / Berkshire Hathaway", cik: 1067983, nameHints: ["BERKSHIRE"], note: "" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /Some Unrelated Corp/);
  });

  test("Konsens-Käufe: zählt nur Aktien, die mehrere Fonds gleichzeitig offen halten", async () => {
    const fund1Table = `<informationTable>
      <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><cusip>037833100</cusip><value>150000</value>
        <shrsOrPrnAmt><sshPrnamt>1500000</sshPrnamt></shrsOrPrnAmt></infoTable>
      <infoTable><nameOfIssuer>NEWCO INC</nameOfIssuer><cusip>222222222</cusip><value>8000</value>
        <shrsOrPrnAmt><sshPrnamt>50000</sshPrnamt></shrsOrPrnAmt></infoTable>
    </informationTable>`;
    const fund2Table = `<informationTable>
      <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><cusip>037833100</cusip><value>90000</value>
        <shrsOrPrnAmt><sshPrnamt>900000</sshPrnamt></shrsOrPrnAmt></infoTable>
      <infoTable><nameOfIssuer>TESLA INC</nameOfIssuer><cusip>999999999</cusip><value>4000</value>
        <shrsOrPrnAmt><sshPrnamt>10000</sshPrnamt></shrsOrPrnAmt></infoTable>
    </informationTable>`;

    route([
      (url) => url.includes("/submissions/CIK0001067983.json") ? json({
        cik: "1067983", name: "Berkshire Hathaway Inc", filings: { recent: {
          accessionNumber: ["0001067983-26-000009"], form: ["13F-HR"], filingDate: ["2026-08-14"],
          reportDate: ["2026-06-30"], primaryDocument: ["primary_doc.xml"], items: [""],
        } },
      }) : null,
      (url) => url.includes("/submissions/CIK0002000000.json") ? json({
        cik: "2000000", name: "Second Fund LLC", filings: { recent: {
          accessionNumber: ["0002000000-26-000001"], form: ["13F-HR"], filingDate: ["2026-08-10"],
          reportDate: ["2026-06-30"], primaryDocument: ["primary_doc.xml"], items: [""],
        } },
      }) : null,
      (url) => url.endsWith("000106798326000009/index.json") ? json({ directory: { item: [
        { name: "primary_doc.xml", type: "text.xml" }, { name: "infotable.xml", type: "text.xml" },
      ] } }) : null,
      (url) => url.endsWith("000200000026000001/index.json") ? json({ directory: { item: [
        { name: "primary_doc.xml", type: "text.xml" }, { name: "infotable.xml", type: "text.xml" },
      ] } }) : null,
      (url) => url.endsWith("000106798326000009/infotable.xml") ? text(fund1Table) : null,
      (url) => url.endsWith("000200000026000001/infotable.xml") ? text(fund2Table) : null,
    ]);

    const profiles = [
      { slug: "berkshire-hathaway", displayName: "Warren Buffett / Berkshire Hathaway", cik: 1067983, nameHints: ["BERKSHIRE"], note: "" },
      { slug: "second-fund", displayName: "Second Fund LLC", cik: 2000000, nameHints: ["SECOND FUND"], note: "" },
    ];
    const { picks, issues } = await getConsensusPicks(profiles, 2);
    assert.equal(issues.length, 0);
    assert.equal(picks.length, 1);
    assert.equal(picks[0].cusip, "037833100");
    assert.equal(picks[0].fundCount, 2);
    assert.equal(picks[0].totalValueUsd, (150000 + 90000) * 1000);
  });
});

describe("Nachrichten", () => {
  test("zeigt verfügbare Quellen und meldet ausgefallene ehrlich", async () => {
    route([
      (url) => url.includes("federalreserve.gov") ? text(`<rss><channel><item><title>FOMC statement</title><link>https://www.federalreserve.gov/a.htm</link><pubDate>Wed, 16 Sep 2026 18:00:00 GMT</pubDate><category>Monetary Policy</category></item></channel></rss>`) : null,
      (url) => url.includes("ecb.europa.eu") ? new Response("", { status: 503 }) : null,
      (url) => url.includes("sec.gov/news") ? text(`<rss><channel><item><title>SEC charges firm</title><link>https://www.sec.gov/b</link><pubDate>Tue, 15 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>`) : null,
    ]);
    const r = await getNews();
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].category, "notenbanken");
    assert.equal(r.items[1].category, "politik-regulierung");
    const ecb = r.sources.find((s) => s.sourceId === "ecb-press")!;
    assert.equal(ecb.ok, false);
  });
});

describe("Märkte", () => {
  test("EUR/USD aus EZB-Daten mit Tageswert und Vorwert", async () => {
    route([(url) => url.includes("data-api.ecb.europa.eu") ? text(`TIME_PERIOD,OBS_VALUE\n2026-09-21,1.1700\n2026-09-22,1.1760\n`) : null]);
    const card = await getMarketCard(marketBySlug("eur-usd")!);
    assert.equal(card.status, "ok");
    assert.equal(card.value, 1.176);
    assert.ok(Math.abs(card.changePct! - 0.5128) < 0.001);
    assert.equal(card.meta!.observedPrecision, "day");
  });
  test("US-Rendite: Veränderung in Basispunkten statt Prozent", async () => {
    route([(url) => url.includes("home.treasury.gov") ? text(`<feed><entry><content><m:properties><d:NEW_DATE>2026-09-21T00:00:00</d:NEW_DATE><d:BC_10YEAR>4.10</d:BC_10YEAR></m:properties></content></entry><entry><content><m:properties><d:NEW_DATE>2026-09-22T00:00:00</d:NEW_DATE><d:BC_10YEAR>4.15</d:BC_10YEAR></m:properties></content></entry></feed>`) : null]);
    const card = await getMarketCard(marketBySlug("us-rendite-10j")!);
    assert.equal(card.changeBp, 5);
    assert.equal(card.changePct, null);
  });
  test("Gold ohne Twelve-Data-Schlüssel: ehrlich nicht verfügbar, kein erfundener Wert", async () => {
    route([]);
    const card = await getMarketCard(marketBySlug("gold")!);
    assert.equal(card.status, "unavailable");
    assert.equal(card.value, null);
    assert.equal(calls.length, 0, "ohne Schlüssel darf gar nicht erst angefragt werden");
  });
  test("Gold über den Ersatz-ETF GLD, klar als ETF-Kurs gekennzeichnet", async () => {
    process.env.TWELVEDATA_API_KEY = "test-key";
    route([(url) => url.includes("twelvedata") ? json({ symbol: "GLD", close: "245.10", previous_close: "243.00", currency: "USD", is_market_open: true }) : null]);
    const card = await getMarketCard(marketBySlug("gold")!);
    assert.equal(card.status, "ok");
    assert.equal(card.value, 245.1);
    assert.equal(card.tradingNote, "Ersatz-ETF-Kurs, kein Indexstand");
  });
  test("DAX bleibt ohne ETF-Ersatz ehrlich unverfügbar", async () => {
    route([]);
    const card = await getMarketCard(marketBySlug("dax")!);
    assert.equal(card.status, "unavailable");
    assert.equal(calls.length, 0);
  });
});

describe("Krypto-Rangliste", () => {
  test("blättert mit festem Datenstand und kennzeichnet Stablecoins", async () => {
    const coins = Array.from({ length: 250 }, (_, i) => ({ id: `c${i}`, symbol: `c${i}`, name: i === 3 ? "Tether" : `Coin ${i}`, current_price: 1, market_cap: 1e9 - i, market_cap_rank: i + 1, total_volume: 1e7, last_updated: "2026-09-23T07:55:00Z", sparkline_in_7d: { price: [1, 1.01] } }));
    route([(url) => {
      if (!url.includes("api.coingecko.com")) return null;
      if (url.includes("categories/list")) return json([{ category_id: "stablecoins", name: "Stablecoins" }]);
      if (url.includes("category=stablecoins")) return json([coins[3]]);
      if (url.includes("&page=2")) return json([]);
      if (url.includes("/coins/markets")) return json(coins);
      return null;
    }]);
    const first = await getCryptoRanking({ page: 1, q: "", filter: "alle", sort: "marketCap", dir: "desc" });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.data.page.total, 250);
    assert.equal(first.data.page.items[3].item.profile.label, "Stablecoin");
    const second = await getCryptoRanking({ page: 2, q: "", filter: "ohne-stablecoins", sort: "marketCap", dir: "desc", stand: first.data.snapshot.stand });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.data.replaced, false, "gleicher Datenstand beim Blättern");
    assert.equal(second.data.page.total, 249);
    assert.equal(second.data.page.items[0].sizeRank, 102, "Größenrang bleibt erhalten, Stablecoin fehlt");
  });
});
