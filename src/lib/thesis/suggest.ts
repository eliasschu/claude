/**
 * Vorschlaege fuer Widerlegungskriterien aus den juengsten SEC-Quartalszahlen (reine Funktion).
 * Nur Werte, die sich nach den Regeln der automatischen Pruefung berechnen lassen - nichts wird geschaetzt.
 *  - Operative Marge:  aktueller Wert minus 5 Prozentpunkte, zwei Quartale in Folge
 *  - FCF-Marge:        aktueller Wert minus 5 Prozentpunkte, zwei Quartale in Folge
 *  - Umsatzwachstum:   unter 0 % ggue. Vorjahresquartal, zwei Quartale in Folge
 */

import type { NormalizedFacts } from "../finance/sec-facts.ts";
import { evaluateCriterion } from "./criteria-eval.ts";
import type { MeasurableCriterion, MetricKey } from "./model.ts";

export const SUGGEST_MARGIN_PP = 5;

export interface Suggestion {
  criteria: MeasurableCriterion[];
  basis: { metric: MetricKey; value: number; periodEnd: string; stale: boolean }[];
  missing: MetricKey[];
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function suggestCriteria(facts: NormalizedFacts, today: string, newId: () => string): Suggestion {
  const out: Suggestion = { criteria: [], basis: [], missing: [] };
  const probe = (metric: MetricKey) => {
    const r = evaluateCriterion({ id: "probe", metric, operator: "<", threshold: 0, period: "quartal", consecutive: 1 }, facts, today);
    const p = r.periods[0];
    return p && p.value !== null ? { value: p.value, periodEnd: p.end, stale: r.status === "veraltete_daten" } : null;
  };
  for (const metric of ["operating_margin", "fcf_margin", "revenue_growth_yoy"] as MetricKey[]) {
    const v = probe(metric);
    if (!v) { out.missing.push(metric); continue; }
    out.basis.push({ metric, ...v });
    const threshold = metric === "revenue_growth_yoy" ? 0 : round1(v.value - SUGGEST_MARGIN_PP);
    out.criteria.push({ id: newId(), metric, operator: "<", threshold, period: "quartal", consecutive: 2 });
  }
  return out;
}
