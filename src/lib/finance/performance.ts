/**
 * Renditen und Risiko. Unterschiede zwischen zwei Renditen werden immer in
 * Prozentpunkten angegeben, nie in Prozent.
 */

export const TRADING_DAYS_PER_YEAR = 252;

export function totalReturnPct(series: number[]): number | null {
  if (series.length < 2) return null;
  const first = series[0];
  if (!Number.isFinite(first) || first <= 0) return null;
  return (series[series.length - 1] / first - 1) * 100;
}

export function annualizedReturnPct(totalPct: number, years: number): number | null {
  if (!Number.isFinite(totalPct) || years <= 0) return null;
  const growth = 1 + totalPct / 100;
  return growth <= 0 ? null : (Math.pow(growth, 1 / years) - 1) * 100;
}

export function dailyReturns(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    if (Number.isFinite(prev) && prev > 0) out.push(series[i] / prev - 1);
  }
  return out;
}

export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

export function annualizedVolatilityPct(series: number[], periodsPerYear = TRADING_DAYS_PER_YEAR): number | null {
  const sd = standardDeviation(dailyReturns(series));
  return sd === null ? null : sd * Math.sqrt(periodsPerYear) * 100;
}

/** Groesster Rueckgang vom bisherigen Hoechststand, als negativer Prozentwert. */
export function maxDrawdownPct(series: number[]): number | null {
  if (series.length < 2) return null;
  let peak = series[0];
  let worst = 0;
  for (const value of series) {
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.min(worst, value / peak - 1);
  }
  return worst * 100;
}

/** Differenz zweier Renditen in Prozentpunkten. */
export const outperformancePp = (assetPct: number, benchmarkPct: number) => assetPct - benchmarkPct;

/** Normiert eine Reihe auf 100 – fuer den optischen Vergleich mehrerer Werte. */
export function rebaseTo100(series: number[]): number[] {
  if (series.length === 0) return [];
  const base = series[0];
  return !Number.isFinite(base) || base === 0 ? series.map(() => 100) : series.map((v) => (v / base) * 100);
}

export type PeriodKey = "1M" | "3M" | "YTD" | "1J" | "3J" | "5J" | "MAX";

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  "1M": "1 Monat",
  "3M": "3 Monate",
  YTD: "Laufendes Jahr",
  "1J": "1 Jahr",
  "3J": "3 Jahre",
  "5J": "5 Jahre",
  MAX: "Gesamter Verlauf",
};

interface DatedClose {
  date: string;
  close: number;
}

/** Schneidet eine taeglich sortierte Kursreihe auf den gewaehlten Zeitraum zu. */
export function sliceByPeriod<T extends DatedClose>(series: T[], period: PeriodKey): T[] {
  if (series.length === 0) return series;
  if (period === "MAX") return series;
  const last = new Date(series[series.length - 1].date);
  const from = new Date(last);
  if (period === "1M") from.setMonth(from.getMonth() - 1);
  else if (period === "3M") from.setMonth(from.getMonth() - 3);
  else if (period === "YTD") { from.setMonth(0); from.setDate(1); }
  else if (period === "1J") from.setFullYear(from.getFullYear() - 1);
  else if (period === "3J") from.setFullYear(from.getFullYear() - 3);
  else if (period === "5J") from.setFullYear(from.getFullYear() - 5);
  const cutoff = from.getTime();
  const sliced = series.filter((p) => new Date(p.date).getTime() >= cutoff);
  return sliced.length >= 2 ? sliced : series.slice(-2);
}

/** Ueber- oder Unterperformance eines Werts gegenueber einer Benchmark ueber denselben Zeitraum. */
export interface BenchmarkRow {
  label: string;
  priceReturnPct: number | null;
  totalReturnPct: number | null;
  annualizedPct: number | null;
  volatilityPct: number | null;
  maxDrawdownPct: number | null;
  sharpe: number | null;
  correlation: number | null;
}

export interface BenchmarkComparison {
  asset: BenchmarkRow;
  benchmarks: (BenchmarkRow & { outperformancePp: number | null })[];
}

export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const x = a.slice(a.length - n);
  const y = b.slice(b.length - n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  return vx === 0 || vy === 0 ? null : cov / Math.sqrt(vx * vy);
}
