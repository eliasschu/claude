import { env, upstream } from "../core/env.ts";
import { fetchSource, SourceError } from "../core/http.ts";
import { fail, isStale, ok, type DataMeta, type Result } from "../core/meta.ts";
import { normalizeQuote, normalizeTimeSeries, readProviderError, type SeriesPoint, type StockQuote } from "./parsers/twelvedata.ts";

const BASE = "https://api.twelvedata.com";
const validSymbol = (s: string) => /^[A-Z0-9.\-]{1,12}$/.test(s);

/** Twelve Data meldet Fehler mit HTTP 200 im Rumpf – deshalb eigener Parser. */
async function parseChecked(response: Response): Promise<unknown> {
  const body = await response.json();
  const error = readProviderError(body);
  if (error) {
    const reason = error.code === 429 ? "rate_limited" : error.code === 401 || error.code === 403 ? "not_configured" : error.code === 404 || error.code === 400 ? "not_found" : "unavailable";
    throw new SourceError("twelvedata", reason, error.message);
  }
  return body;
}

function meta(fetchedAt: string, observedAt: string | null, stale: boolean, staleReason: string | undefined, maxAgeMs: number, precision: "minute" | "day" = "minute"): DataMeta {
  const tooOld = isStale(observedAt, maxAgeMs);
  return {
    sourceId: "twelvedata", source: "Twelve Data", sourceUrl: "https://twelvedata.com",
    observedAt, observedPrecision: precision, fetchedAt,
    freshness: "Gratistarif, nur private Nutzung; Aktualität je Börse laut Anbieter",
    stale: stale || tooOld,
    staleReason: staleReason ?? (tooOld ? "Der Kurszeitpunkt liegt länger zurück – Börse vermutlich geschlossen." : undefined),
  };
}

function keyOrFail<T>(): { key: string } | { failure: Result<T> } {
  const key = env.twelveDataKey();
  return key ? { key } : { failure: fail("twelvedata", "not_configured", "TWELVEDATA_API_KEY ist nicht gesetzt. Für Aktienkurse bitte einen kostenlosen Schlüssel eintragen.") };
}

// Gratistarif: 8 Abrufe je Minute -> mindestens 7,5 Sekunden Abstand.
const LIMIT = { minIntervalMs: 7600 };

export async function getStockQuote(symbol: string): Promise<Result<StockQuote>> {
  const s = symbol.toUpperCase();
  if (!validSymbol(s)) return fail("twelvedata", "not_found", "Ungültiges Symbol");
  const k = keyOrFail<StockQuote>();
  if ("failure" in k) return k.failure;
  try {
    const res = await fetchSource({ sourceId: "twelvedata", url: upstream(`${BASE}/quote?symbol=${encodeURIComponent(s)}&apikey=${encodeURIComponent(k.key)}`), revalidate: 300, parse: parseChecked, ...LIMIT });
    const quote = normalizeQuote(res.value);
    if (!quote || quote.price === null) return fail("twelvedata", "invalid", "Kein Kurs in der Antwort");
    return ok(quote, meta(res.fetchedAt, quote.observedAt, res.stale, res.staleReason, 4 * 86400000));
  } catch (error) {
    return error instanceof SourceError ? fail("twelvedata", error.reason, error.message) : fail("twelvedata", "unavailable", "Unbekannter Fehler");
  }
}

export type StockInterval = "5min" | "1h" | "1day";

export async function getStockSeries(symbol: string, interval: StockInterval, outputsize: number): Promise<Result<SeriesPoint[]>> {
  const s = symbol.toUpperCase();
  if (!validSymbol(s)) return fail("twelvedata", "not_found", "Ungültiges Symbol");
  const k = keyOrFail<SeriesPoint[]>();
  if ("failure" in k) return k.failure;
  try {
    const url = `${BASE}/time_series?symbol=${encodeURIComponent(s)}&interval=${interval}&outputsize=${Math.min(outputsize, 5000)}&timezone=UTC&apikey=${encodeURIComponent(k.key)}`;
    const res = await fetchSource({ sourceId: "twelvedata", url: upstream(url), revalidate: interval === "1day" ? 6 * 3600 : 900, parse: parseChecked, ...LIMIT });
    const points = normalizeTimeSeries(res.value);
    const last = points.at(-1);
    return ok(points, meta(res.fetchedAt, last ? new Date(last[0]).toISOString() : null, res.stale, res.staleReason, 5 * 86400000, interval === "1day" ? "day" : "minute"));
  } catch (error) {
    return error instanceof SourceError ? fail("twelvedata", error.reason, error.message) : fail("twelvedata", "unavailable", "Unbekannter Fehler");
  }
}
