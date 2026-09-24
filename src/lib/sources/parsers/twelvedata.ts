/**
 * Zerleger fuer Twelve Data. Achtung: Fehler kommen mit HTTP 200 und stehen
 * im Antwortrumpf (`{"code":429,"status":"error"}`), deshalb wird der Rumpf geprueft.
 */

export interface ProviderError { code: number; message: string }

export function readProviderError(raw: unknown): ProviderError | null {
  const r = raw as { status?: string; code?: number; message?: string };
  if (r && r.status === "error") return { code: Number(r.code) || 0, message: String(r.message ?? "Fehler des Anbieters") };
  return null;
}

export interface StockQuote {
  symbol: string; exchange: string | null; currency: string | null;
  price: number | null; previousClose: number | null;
  changeAbs: number | null; changePct: number | null;
  /** Tagesvolumen in Stueck, falls vom Anbieter geliefert. */
  volume: number | null;
  /** Zeitpunkt des Kurses laut Anbieter (nicht der Abrufzeitpunkt). */
  observedAt: string | null;
  marketOpen: boolean | null;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normalizeQuote(raw: unknown): StockQuote | null {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r.symbol !== "string") return null;
  const price = num(r.close);
  const prev = num(r.previous_close);
  const stamp = num(r.timestamp);
  return {
    symbol: r.symbol.toUpperCase(),
    exchange: typeof r.exchange === "string" ? r.exchange : null,
    currency: typeof r.currency === "string" ? r.currency : null,
    price,
    previousClose: prev,
    changeAbs: price !== null && prev !== null ? price - prev : null,
    changePct: price !== null && prev !== null && prev > 0 ? (price / prev - 1) * 100 : null,
    volume: num(r.volume),
    observedAt: stamp !== null ? new Date(stamp * 1000).toISOString() : typeof r.datetime === "string" ? r.datetime : null,
    marketOpen: typeof r.is_market_open === "boolean" ? r.is_market_open : null,
  };
}

export type SeriesPoint = [number, number];

/** time_series: Werte kommen absteigend und als Text; hier aufsteigend und als Zahl. */
export function normalizeTimeSeries(raw: unknown): SeriesPoint[] {
  const values = (raw as { values?: unknown[] })?.values;
  if (!Array.isArray(values)) return [];
  const points: SeriesPoint[] = [];
  for (const v of values as Record<string, unknown>[]) {
    const close = num(v.close);
    const raw = typeof v.datetime === "string" ? v.datetime : "";
    // Reine Tagesangaben als UTC-Mittag ablegen, damit die Wiener Anzeige den Tag behaelt.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw.replace(" ", "T") + (raw.includes("Z") ? "" : "Z");
    const t = Date.parse(iso);
    if (close !== null && !Number.isNaN(t)) points.push([t, close]);
  }
  return points.sort((a, b) => a[0] - b[0]);
}
