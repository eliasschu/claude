import { env, upstream } from "../core/env.ts";
import { fetchSource, parseJson, parseText, SourceError } from "../core/http.ts";
import { fail, ok, type DataMeta, type Result } from "../core/meta.ts";
import { filingUrls, normalizeSubmissions, normalizeTickerIndex, padCik, parseForm4, type ConceptFact, type Form4, type SecCompany, type SecListing } from "./parsers/sec.ts";
import { findInfoTableFile, parse13FInfoTable, parseEdgarIndexJson, type ThirteenFHolding } from "./parsers/sec-13f.ts";

function headers(): Record<string, string> {
  const ua = env.secUserAgent();
  if (!ua) throw new SourceError("sec", "not_configured", "SEC_EDGAR_USER_AGENT fehlt. Die SEC verlangt Name und E-Mail-Adresse.");
  return { "User-Agent": ua };
}

// Fair-Access-Regel der SEC: hoechstens 10 Anfragen je Sekunde.
const COMMON = { sourceId: "sec" as const, minIntervalMs: 125 };

export function secMeta(fetchedAt: string, observedAt: string | null, stale = false, staleReason?: string, sourceUrl?: string): DataMeta {
  return {
    sourceId: "sec", source: "SEC EDGAR", sourceUrl: sourceUrl ?? "https://www.sec.gov/edgar/search/",
    observedAt, observedPrecision: "day", fetchedAt, freshness: "Meldungen laut Eingang bei der SEC",
    stale, staleReason,
  };
}

export function secFailure<T>(error: unknown): Result<T> {
  return error instanceof SourceError ? fail("sec", error.reason, error.message) : fail("sec", "unavailable", "Unbekannter Fehler beim Abruf");
}

let tickerCache: { at: number; list: SecListing[]; byTicker: Map<string, SecListing>; fetchedAt: string } | null = null;

export async function getTickerIndex(): Promise<Result<{ list: SecListing[]; byTicker: Map<string, SecListing> }>> {
  try {
    if (tickerCache && Date.now() - tickerCache.at < 6 * 3600 * 1000) {
      return ok({ list: tickerCache.list, byTicker: tickerCache.byTicker }, secMeta(tickerCache.fetchedAt, null));
    }
    const res = await fetchSource({ ...COMMON, url: upstream("https://www.sec.gov/files/company_tickers_exchange.json"), headers: headers(), revalidate: 86400, parse: parseJson });
    const list = normalizeTickerIndex(res.value);
    if (list.length === 0) return fail("sec", "invalid", "Tickerverzeichnis leer");
    const byTicker = new Map(list.map((l) => [l.ticker, l]));
    tickerCache = { at: Date.now(), list, byTicker, fetchedAt: res.fetchedAt };
    return ok({ list, byTicker }, secMeta(res.fetchedAt, null, res.stale, res.staleReason));
  } catch (error) {
    return secFailure(error);
  }
}

export async function getCompany(cik: number): Promise<Result<SecCompany>> {
  try {
    const res = await fetchSource({ ...COMMON, url: upstream(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`), headers: headers(), revalidate: 900, parse: parseJson });
    const company = normalizeSubmissions(res.value);
    if (!company) return fail("sec", "invalid", "Stammdaten unvollständig");
    return ok(company, secMeta(res.fetchedAt, company.filings[0]?.filingDate ?? null, res.stale, res.staleReason,
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padCik(cik)}`));
  } catch (error) {
    return secFailure(error);
  }
}

export interface ConceptResponse { taxonomy: string; tag: string; units: Record<string, ConceptFact[]> }

/** Ein XBRL-Konzept; `null`, wenn der Emittent es nicht meldet. */
export async function getConcept(cik: number, taxonomy: string, tag: string): Promise<ConceptResponse | null> {
  try {
    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${padCik(cik)}/${taxonomy}/${tag}.json`;
    const res = await fetchSource({ ...COMMON, url: upstream(url), headers: headers(), revalidate: 86400, parse: parseJson, retries: 1 });
    return { taxonomy, tag, units: ((res.value as { units?: Record<string, ConceptFact[]> }).units) ?? {} };
  } catch (error) {
    if (error instanceof SourceError && error.reason === "not_found") return null;
    throw error;
  }
}

export interface Form4Record extends Form4 { accession: string; filingDate: string; form: string; documentUrl: string; indexUrl: string }

/** Form-4-Meldungen sind unveraenderlich und werden lange zwischengespeichert. */
export async function getForm4(cik: number, accession: string, primaryDocument: string, filingDate: string, form: string): Promise<Form4Record | null> {
  const urls = filingUrls(cik, accession, primaryDocument);
  if (!urls.rawXml || !urls.rawXml.endsWith(".xml")) return null;
  try {
    const res = await fetchSource({ ...COMMON, url: upstream(urls.rawXml), headers: headers(), revalidate: 7 * 86400, parse: parseText, retries: 1 });
    const parsed = parseForm4(res.value);
    return parsed ? { ...parsed, accession, filingDate, form, documentUrl: urls.document, indexUrl: urls.index } : null;
  } catch (error) {
    if (error instanceof SourceError && (error.reason === "not_found" || error.reason === "invalid")) return null;
    throw error;
  }
}

/** Ordnerindex einer Einreichung - listet alle enthaltenen Dateien (fuer 13F: Deckblatt + Informationstabelle). */
export async function getFilingIndex(cik: number, accession: string): Promise<Result<{ name: string; type: string | null }[]>> {
  try {
    const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;
    const res = await fetchSource({ ...COMMON, url: upstream(`${folder}/index.json`), headers: headers(), revalidate: 7 * 86400, parse: parseJson, retries: 1 });
    return ok(parseEdgarIndexJson(res.value), secMeta(res.fetchedAt, null, res.stale, res.staleReason));
  } catch (error) {
    return secFailure(error);
  }
}

export interface ThirteenFRecord { holdings: ThirteenFHolding[]; accession: string; filingDate: string; reportDate: string | null; documentUrl: string }

/** 13F-Informationstabelle: erst der Ordnerindex, dann die eigentliche Tabelle (liegt neben dem Deckblatt). */
export async function getForm13F(cik: number, accession: string, primaryDocument: string, filingDate: string, reportDate: string | null): Promise<ThirteenFRecord | null> {
  const index = await getFilingIndex(cik, accession);
  if (!index.ok) return null;
  const infoTableFile = findInfoTableFile(index.data, primaryDocument);
  if (!infoTableFile) return null;
  const urls = filingUrls(cik, accession, infoTableFile);
  try {
    const res = await fetchSource({ ...COMMON, url: upstream(urls.document), headers: headers(), revalidate: 7 * 86400, parse: parseText, retries: 1 });
    const holdings = parse13FInfoTable(res.value);
    return { holdings, accession, filingDate, reportDate, documentUrl: urls.document };
  } catch (error) {
    if (error instanceof SourceError && (error.reason === "not_found" || error.reason === "invalid")) return null;
    throw error;
  }
}

/** Nur fuer Tests. */
export function __resetTickerCache() { tickerCache = null; }
