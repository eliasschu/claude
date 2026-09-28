/**
 * Quartalsuebersicht aus SEC Company Facts (reine Funktion). Gleiche Regeln wie die Kriterienpruefung:
 * Einzelquartale direkt oder aus kumulierten Werten mit gleichem Beginn; Ergebnis je Aktie nur direkt gemeldet;
 * fehlende Werte bleiben leer. Wachstum nur ggue. dem Vorjahresquartal mit demselben SEC-Konzept und Basis > 0.
 */

import { days, filingIndexUrl, isConsecutive, type NormalizedFacts, type PeriodValue, type Quantity } from "./sec-facts.ts";

export interface QuarterCell { value: number; derived: boolean; revised: boolean; yoyPct: number | null }

export interface QuarterRow {
  start: string;
  end: string;
  unit: string;
  cells: Partial<Record<Quantity, QuarterCell>>;
  operatingMarginPct: number | null;
  freeCashFlow: number | null;
  source: { form: string; filed: string; url: string };
}

export interface QuarterlyOverview {
  rows: QuarterRow[];
  /** Summe der letzten vier lueckenlos aufeinanderfolgenden Quartale; null, wenn eines fehlt. */
  ttm: { end: string; revenue: number | null; operatingIncome: number | null; netIncome: number | null; freeCashFlow: number | null } | null;
}

const key = (p: { start: string; end: string }) => `${p.start}|${p.end}`;

function priorYear(list: PeriodValue[], v: PeriodValue): PeriodValue | undefined {
  return list.find((p) => {
    const gap = days(p.end, v.end) - 1;
    return gap >= 357 && gap <= 372 && Math.abs(days(p.start, p.end) - days(v.start, v.end)) <= 14;
  });
}

export function quarterlyOverview(facts: NormalizedFacts, count = 5): QuarterlyOverview {
  const s = facts.series;
  const spine = [...s.revenue.quarters].sort((a, b) => b.end.localeCompare(a.end)).slice(0, count);
  const cell = (q: Quantity, p: { start: string; end: string }): QuarterCell | undefined => {
    const v = s[q].quarters.find((x) => key(x) === key(p));
    if (!v) return undefined;
    const prev = priorYear(s[q].quarters, v);
    const yoyPct = prev && prev.concept === v.concept && prev.unit === v.unit && prev.value > 0 ? (v.value / prev.value - 1) * 100 : null;
    return { value: v.value, derived: Boolean(v.derived), revised: v.revisions.length > 0, yoyPct };
  };
  const rows = spine.map((r): QuarterRow => {
    const cells: QuarterRow["cells"] = {};
    for (const q of ["revenue", "operatingIncome", "netIncome", "epsDiluted", "operatingCashFlow", "capex"] as Quantity[]) {
      const c = cell(q, r);
      if (c) cells[q] = c;
    }
    const ocf = s.operatingCashFlow.quarters.find((x) => key(x) === key(r));
    const capex = s.capex.quarters.find((x) => key(x) === key(r));
    const oi = cells.operatingIncome;
    return {
      start: r.start, end: r.end, unit: r.unit, cells,
      operatingMarginPct: oi && r.value > 0 ? (oi.value / r.value) * 100 : null,
      freeCashFlow: ocf && capex && ocf.unit === capex.unit ? ocf.value - capex.value : null,
      source: { form: r.source.form, filed: r.source.filed, url: filingIndexUrl(facts.cik, r.source.accn) },
    };
  });

  const four = rows.slice(0, 4);
  const consecutive = four.length === 4 && four.every((r, i) => i === 0 || isConsecutive(four[i], four[i - 1]));
  const sum = (get: (r: QuarterRow) => number | null | undefined) => {
    const vals = four.map(get);
    return consecutive && vals.every((v) => v !== null && v !== undefined) ? (vals as number[]).reduce((a, b) => a + b, 0) : null;
  };
  const ttm = consecutive ? {
    end: four[0].end,
    revenue: sum((r) => r.cells.revenue?.value), operatingIncome: sum((r) => r.cells.operatingIncome?.value),
    netIncome: sum((r) => r.cells.netIncome?.value), freeCashFlow: sum((r) => r.freeCashFlow),
  } : null;
  return { rows, ttm };
}
