/**
 * Verbindet das Bewertungsmodell (lib/finance/stock-model.ts) mit der
 * Oberflaeche. Reine Umformung realer Modellergebnisse in Anzeige-Typen –
 * keine zusaetzliche Berechnung, keine erfundenen Werte.
 */

import { getStockOverview } from "./stocks.ts";
import type { BandVerdict, SensitivityCell } from "../finance/valuation.ts";
import type { StockModel } from "../finance/stock-model.ts";

export interface ValuationMethod { id: string; label: string; value: number | null; weight: number; assumption: string }
export interface ValuationScenario { key: "bear" | "base" | "bull"; label: string; perShare: number | null; growth: number; deviationPct: number | null }

export interface ValuationView {
  verdict: BandVerdict;
  deviationPct: number | null;
  aggregate: { value: number | null; low: number | null; high: number | null; confidence: number };
  scenarios: ValuationScenario[];
  methods: ValuationMethod[];
  terminalShare: number | null;
  sensitivity: { growths: number[]; discountRates: number[]; cells: SensitivityCell[] };
}

/** Konfidenz aus Datenabdeckung: mehr nutzbare Kennzahlen und ein enges Band erhöhen sie. */
function confidenceFromModel(model: StockModel): number {
  if (!model.applicable || model.band.bear === null || model.band.bull === null || model.band.base === null) return 0;
  const spread = (model.band.bull - model.band.bear) / model.band.base;
  const spreadScore = Math.max(0, 100 - spread * 80);
  const dataScore = 100 - model.reasons.length * 20;
  return Math.max(0, Math.min(100, Math.round((spreadScore + dataScore) / 2)));
}

export function toValuationView(model: StockModel): ValuationView | null {
  if (!model.applicable || model.band.base === null) return null;
  const confidence = confidenceFromModel(model);
  const terminalScenario = model.scenarios.find((s) => s.key === "base")?.result;
  return {
    verdict: model.price.verdict,
    deviationPct: model.price.discountToBasePct,
    aggregate: { value: model.band.base, low: model.band.bear, high: model.band.bull, confidence },
    scenarios: model.scenarios.map((s) => ({
      key: s.key,
      label: s.label,
      perShare: s.result?.perShare ?? null,
      growth: s.growth,
      deviationPct: s.result && model.price.value ? ((s.result.perShare - model.price.value) / model.price.value) * 100 : null,
    })),
    methods: [{
      id: "dcf",
      label: "Discounted Cashflow (zweiphasig)",
      value: model.band.base,
      weight: 1,
      assumption: model.assumptions[0] ?? "Zwei-Phasen-DCF auf Basis des normalisierten freien Cashflows.",
    }],
    terminalShare: terminalScenario?.terminalShare ?? null,
    sensitivity: model.sensitivity ?? { growths: [], discountRates: [], cells: [] },
  };
}

/** Leichtgewichtiger Verdikt fuer Kachelübersichten (Magnificent Seven), ohne die Preisreihe erneut zu laden. */
export async function getValuationSummary(symbol: string, price: number): Promise<{ verdict: BandVerdict; deviation: number | null } | null> {
  const overview = await getStockOverview(symbol, { withPrices: false, priceOverride: price });
  if (!overview.ok) return null;
  const view = toValuationView(overview.data.model);
  if (!view) return { verdict: "Datenlage unzureichend", deviation: null };
  return { verdict: view.verdict, deviation: view.deviationPct };
}
