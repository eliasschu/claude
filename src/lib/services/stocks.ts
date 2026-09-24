import { fail, ok, type DataMeta, type Result } from "../core/meta.ts";
import { SourceError } from "../core/http.ts";
import { getCompany, getConcept, getTickerIndex, secFailure, secMeta } from "../sources/sec.ts";
import { getStockQuote, getStockSeries } from "../sources/twelvedata.ts";
import { annualValues, EIGHT_K_ITEMS, filingUrls, FORM_LABELS, latestSharesOutstanding, type AnnualValue, type SecCompany, type SecListing } from "../sources/parsers/sec.ts";
import type { StockQuote, SeriesPoint } from "../sources/parsers/twelvedata.ts";
import { buildFinancials, CONCEPTS, financialMetrics, mergeSeries, type CompanyFinancials, type FinKey, type FinancialMetrics } from "../finance/fundamentals.ts";
import { buildStockModel, type StockModel } from "../finance/stock-model.ts";
import { buildScorecard, type Scorecard } from "../finance/stock-scorecard.ts";
import { buildSummary, type StockSummary } from "../finance/stock-summary.ts";
import { annualizedVolatilityPct, maxDrawdownPct, totalReturnPct } from "../finance/performance.ts";
import { scoreFromRange } from "../finance/valuation.ts";

export const FEATURED_TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA"];

export async function findListing(ticker: string): Promise<Result<SecListing>> {
  const index = await getTickerIndex();
  if (!index.ok) return index;
  const listing = index.data.byTicker.get(ticker.toUpperCase());
  return listing ? ok(listing, index.meta) : fail("sec", "not_found", `Kein bei der SEC registriertes Wertpapier mit dem Ticker ${ticker}.`);
}

const UNITS = { money: ["USD", "EUR", "GBP", "CHF", "JPY", "CAD"], perShare: ["USD/shares", "EUR/shares"], shares: ["shares"] };

/** Laedt alle Kennzahlen; faellt von US-GAAP auf IFRS zurueck. */
export async function loadSeries(cik: number) {
  const probe = await getConcept(cik, "us-gaap", CONCEPTS[0].usGaap[0]) ?? await getConcept(cik, "us-gaap", CONCEPTS[0].usGaap[1]);
  const taxonomy: "us-gaap" | "ifrs-full" = probe ? "us-gaap" : "ifrs-full";
  const series: Partial<Record<FinKey, AnnualValue[]>> = {};
  for (const spec of CONCEPTS) {
    const tags = taxonomy === "us-gaap" ? spec.usGaap : spec.ifrs;
    const collected: AnnualValue[][] = [];
    for (const tag of tags) {
      const concept = await getConcept(cik, taxonomy, tag);
      if (!concept) continue;
      const values = annualValues(concept.units, spec.kind, UNITS[spec.unit]);
      if (values.length) collected.push(values);
      if (values.length && spec.key !== "revenue") break;
    }
    if (collected.length) series[spec.key] = mergeSeries(collected);
  }
  const dei = await getConcept(cik, "dei", "EntityCommonStockSharesOutstanding");
  return { series, taxonomy: series.revenue || series.netIncome ? taxonomy : null, sharesOutstanding: latestSharesOutstanding(dei?.units) };
}

export interface CompanyNewsItem {
  id: string; title: string; form: string; formLabel: string; items: string[];
  filingDate: string; reportDate: string | null; url: string; indexUrl: string;
}

export function filingsAsNews(company: SecCompany, days = 180, limit = 15, now = Date.now()): CompanyNewsItem[] {
  const relevant = new Set(["8-K", "10-K", "10-Q", "20-F", "6-K", "40-F"]);
  const cutoff = new Date(now - days * 86400000).toISOString().slice(0, 10);
  return company.filings
    .filter((f) => relevant.has(f.form) && f.filingDate >= cutoff)
    .slice(0, limit)
    .map((f) => {
      const urls = filingUrls(company.cik, f.accession, f.primaryDocument);
      const items = f.items.map((i) => EIGHT_K_ITEMS[i]).filter((x): x is string => !!x && x !== "Abschlüsse und Anlagen");
      return {
        id: f.accession,
        title: f.form === "8-K" && items.length ? items.join(" · ") : FORM_LABELS[f.form] ?? f.form,
        form: f.form, formLabel: FORM_LABELS[f.form] ?? f.form, items,
        filingDate: f.filingDate, reportDate: f.reportDate, url: urls.document, indexUrl: urls.index,
      };
    });
}

export interface PriceBlock {
  quote: StockQuote | null;
  quoteMeta: DataMeta | null;
  daily: SeriesPoint[] | null;
  /** Grund, falls keine Kurse vorliegen. */
  unavailable: string | null;
}

/** Kurs und Tagesverlauf; ohne Schluessel ehrlich leer. */
export async function loadPrices(ticker: string): Promise<PriceBlock> {
  const quote = await getStockQuote(ticker);
  if (!quote.ok) return { quote: null, quoteMeta: null, daily: null, unavailable: quote.message };
  const series = await getStockSeries(ticker, "1day", 1300);
  return { quote: quote.data, quoteMeta: quote.meta, daily: series.ok ? series.data : null, unavailable: null };
}

export interface StockOverview {
  listing: SecListing; company: SecCompany; companyMeta: DataMeta;
  financials: CompanyFinancials; metrics: FinancialMetrics; model: StockModel;
  scorecard: Scorecard; summary: StockSummary; filings: CompanyNewsItem[]; factsMeta: DataMeta;
  prices: PriceBlock;
}

export async function getStockOverview(ticker: string, options: { withPrices?: boolean; priceOverride?: number } = {}): Promise<Result<StockOverview>> {
  const listing = await findListing(ticker);
  if (!listing.ok) return listing;
  const company = await getCompany(listing.data.cik);
  if (!company.ok) return company;
  try {
    const { series, taxonomy, sharesOutstanding } = await loadSeries(listing.data.cik);
    const prices = options.withPrices === false ? { quote: null, quoteMeta: null, daily: null, unavailable: "Kurse nicht angefordert." } : await loadPrices(listing.data.ticker);
    const price = options.priceOverride ?? prices.quote?.price ?? null;

    const financials = buildFinancials(series, taxonomy);
    const metrics = financialMetrics(financials);
    const model = buildStockModel(financials, metrics, { sic: company.data.sic, sharesOutstanding: sharesOutstanding?.value ?? null, price });

    const closes = prices.daily?.map((p) => p[1]) ?? [];
    const lastYear = closes.slice(-252);
    const threeMonths = closes.slice(-63);
    const valuationScore = model.band.bear !== null && model.band.bull !== null && price !== null
      ? scoreFromRange(price, model.band.bull * 1.2, model.band.bear * 0.8)
      : null;
    const scorecard = buildScorecard(financials, metrics, {
      sic: company.data.sic,
      valuationScore,
      momentum3mPct: threeMonths.length > 20 ? totalReturnPct(threeMonths) : null,
      volatilityPct: lastYear.length > 60 ? annualizedVolatilityPct(lastYear) : null,
      maxDrawdownPct: lastYear.length > 60 ? maxDrawdownPct(lastYear) : null,
    });
    const summary = buildSummary(company.data.name, financials, metrics, scorecard, model);
    const latest = financials.latest;
    const factsMeta: DataMeta = {
      ...secMeta(company.meta.fetchedAt, latest?.end ?? null, false, undefined,
        latest?.accession ? filingUrls(listing.data.cik, latest.accession, "").index : undefined),
      source: "SEC EDGAR – Jahresabschlüsse", freshness: "laut Einreichung des Jahresberichts",
      calcVersion: model.calcVersion,
    };
    return ok({
      listing: listing.data, company: company.data, companyMeta: company.meta,
      financials, metrics, model, scorecard, summary, filings: filingsAsNews(company.data), factsMeta, prices,
    }, company.meta);
  } catch (error) {
    return error instanceof SourceError ? secFailure(error) : fail("sec", "unavailable", "Finanzdaten konnten nicht geladen werden.");
  }
}
