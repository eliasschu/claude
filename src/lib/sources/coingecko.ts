import { env, upstream } from "../core/env.ts";
import { fetchSource, parseJson, SourceError } from "../core/http.ts";
import { fail, isStale, ok, type DataMeta, type Result } from "../core/meta.ts";
import { normalizeCoinDetail, normalizeCoinMarkets, normalizeMarketChart, type CoinDetail, type CoinRow, type SeriesPoint } from "./parsers/coingecko.ts";

const BASE = "https://api.coingecko.com/api/v3";
export const VS_CURRENCY = "eur";
const validId = (id: string) => /^[a-z0-9-]+$/.test(id);

function request(path: string) {
  const key = env.coingeckoKey();
  return {
    url: upstream(`${BASE}${path}`),
    headers: key ? { "x-cg-demo-api-key": key } : undefined,
    // Ohne Schluessel erlaubt der oeffentliche Zugang nur wenige Abrufe je Minute.
    minIntervalMs: key ? 2100 : 4500,
  };
}

function meta(fetchedAt: string, observedAt: string | null, stale: boolean, staleReason?: string, maxAgeMs = 30 * 60000): DataMeta {
  const tooOld = isStale(observedAt, maxAgeMs);
  return {
    sourceId: "coingecko", source: "CoinGecko", sourceUrl: "https://www.coingecko.com/",
    observedAt, observedPrecision: "minute", fetchedAt,
    freshness: "laut Anbieter ab etwa 60 Sekunden verzögert",
    stale: stale || tooOld,
    staleReason: staleReason ?? (tooOld ? "Der Datenzeitpunkt liegt länger zurück als üblich." : undefined),
    attribution: "Powered by CoinGecko",
  };
}

function toFailure<T>(error: unknown): Result<T> {
  return error instanceof SourceError ? fail("coingecko", error.reason, error.message) : fail("coingecko", "unavailable", "Unbekannter Fehler beim Abruf");
}

export interface CoinSnapshot { rows: CoinRow[]; observedFrom: string | null; observedTo: string | null }

/** Bis zu 500 Werte nach zirkulierender Marktkapitalisierung. */
export async function getTopCoins(limit = 500): Promise<Result<CoinSnapshot>> {
  try {
    const rows: CoinRow[] = [];
    let fetchedAt = "";
    let stale = false;
    let staleReason: string | undefined;
    for (let page = 1; page <= Math.ceil(Math.min(limit, 500) / 250); page++) {
      const r = request(`/coins/markets?vs_currency=${VS_CURRENCY}&order=market_cap_desc&per_page=250&page=${page}&sparkline=true&price_change_percentage=1h,24h,7d`);
      const res = await fetchSource({ sourceId: "coingecko", ...r, revalidate: 300, parse: parseJson });
      rows.push(...normalizeCoinMarkets(res.value));
      if (!fetchedAt || res.fetchedAt < fetchedAt) fetchedAt = res.fetchedAt;
      if (res.stale) { stale = true; staleReason = res.staleReason; }
    }
    const seen = new Set<string>();
    const unique = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).slice(0, limit);
    const times = unique.map((r) => r.lastUpdated).filter((t): t is string => !!t).sort();
    return ok({ rows: unique, observedFrom: times[0] ?? null, observedTo: times.at(-1) ?? null }, meta(fetchedAt, times[0] ?? null, stale, staleReason));
  } catch (error) {
    return toFailure(error);
  }
}

export async function getCategoryMembers(categoryId: string): Promise<Result<Set<string>>> {
  if (!validId(categoryId)) return fail("coingecko", "invalid", "Ungültige Kategorie");
  try {
    const r = request(`/coins/markets?vs_currency=${VS_CURRENCY}&category=${categoryId}&order=market_cap_desc&per_page=250&page=1`);
    const res = await fetchSource({ sourceId: "coingecko", ...r, revalidate: 6 * 3600, parse: parseJson });
    return ok(new Set(normalizeCoinMarkets(res.value).map((c) => c.id)), meta(res.fetchedAt, res.fetchedAt, res.stale, res.staleReason, 24 * 3600000));
  } catch (error) {
    return toFailure(error);
  }
}

export async function getCategoryList(): Promise<Result<Map<string, string>>> {
  try {
    const res = await fetchSource({ sourceId: "coingecko", ...request("/coins/categories/list"), revalidate: 24 * 3600, parse: parseJson });
    const list = Array.isArray(res.value) ? (res.value as { category_id?: string; name?: string }[]) : [];
    return ok(new Map(list.filter((c) => c.category_id && c.name).map((c) => [c.category_id!, c.name!])), meta(res.fetchedAt, res.fetchedAt, res.stale, res.staleReason, 48 * 3600000));
  } catch (error) {
    return toFailure(error);
  }
}

export async function getCoinDetail(id: string): Promise<Result<CoinDetail>> {
  if (!validId(id)) return fail("coingecko", "not_found", "Unbekannte Kennung");
  try {
    const r = request(`/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`);
    const res = await fetchSource({ sourceId: "coingecko", ...r, revalidate: 300, parse: parseJson });
    const detail = normalizeCoinDetail(res.value);
    if (!detail) return fail("coingecko", "invalid", "Antwort ohne verwertbare Angaben");
    return ok(detail, { ...meta(res.fetchedAt, detail.lastUpdated, res.stale, res.staleReason), sourceUrl: `https://www.coingecko.com/en/coins/${id}` });
  } catch (error) {
    return toFailure(error);
  }
}

export type ChartSpan = 1 | 90 | 365;

/** Aufloesung laut Anbieter: 1 Tag ~5 Minuten, bis 90 Tage stuendlich, darueber taeglich. */
export async function getCoinChart(id: string, days: ChartSpan): Promise<Result<SeriesPoint[]>> {
  if (!validId(id)) return fail("coingecko", "not_found", "Unbekannte Kennung");
  try {
    const res = await fetchSource({
      sourceId: "coingecko", ...request(`/coins/${id}/market_chart?vs_currency=${VS_CURRENCY}&days=${days}`),
      revalidate: days === 1 ? 300 : days === 90 ? 1800 : 6 * 3600, parse: parseJson,
    });
    const points = normalizeMarketChart(res.value);
    const last = points.at(-1);
    return ok(points, meta(res.fetchedAt, last ? new Date(last[0]).toISOString() : null, res.stale, res.staleReason, days === 1 ? 30 * 60000 : 2 * 86400000));
  } catch (error) {
    return toFailure(error);
  }
}
