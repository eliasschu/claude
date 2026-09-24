/**
 * Modellbewertung einer Aktie aus Jahresabschluessen. Ergebnis ist ein Band
 * aus drei Szenarien mit offengelegten Annahmen – kein "richtiger Preis".
 * Zusaetzlich wird umgekehrt gerechnet: Welches Wachstum steckt im Kurs?
 */

import type { CompanyFinancials, FinancialMetrics } from "./fundamentals.ts";
import { sectorProfile, type SectorProfile } from "./sectors.ts";
import {
  classifyAgainstBand, clamp, discountedCashFlow, discountToModelPct, impliedGrowth,
  sensitivityGrid, upsideToModelPct, VALUATION_CALC_VERSION,
  type BandVerdict, type DcfInputs, type DcfResult, type SensitivityCell,
} from "./valuation.ts";

export interface ScenarioResult {
  key: "bear" | "base" | "bull";
  label: string;
  growth: number;
  discountRate: number;
  terminalGrowth: number;
  result: DcfResult | null;
}

export interface StockModel {
  applicable: boolean;
  reasons: string[];
  calcVersion: string;
  profile: SectorProfile;
  currency: string | null;
  basis: string;
  normalizedFcf: number | null;
  fcfMarginUsed: number | null;
  netDebt: number | null;
  shares: number | null;
  sharesBasis: string | null;
  scenarios: ScenarioResult[];
  band: { bear: number | null; base: number | null; bull: number | null };
  sensitivity: { growths: number[]; discountRates: number[]; cells: SensitivityCell[] } | null;
  assumptions: string[];
  price: {
    value: number | null;
    discountToBasePct: number | null;
    upsideToBasePct: number | null;
    verdict: BandVerdict;
    /** Wachstum, das der Kurs voraussetzt. */
    impliedGrowth: number | null;
    /** Historisches Wachstum zum Vergleich. */
    historicalGrowth: number | null;
  };
}

export const MODEL_DEFAULTS = {
  years: 10,
  maxBaseGrowth: 0.15,
  base: { discountRate: 0.09, terminalGrowth: 0.025 },
  bear: { discountRate: 0.1, terminalGrowth: 0.02, growthFactor: 0.5 },
  bull: { discountRate: 0.08, terminalGrowth: 0.03, growthAdd: 0.03, maxGrowth: 0.2 },
};

const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")} %`;

export function buildStockModel(
  fin: CompanyFinancials,
  metrics: FinancialMetrics,
  options: { sic: string | null; sharesOutstanding: number | null; price: number | null },
): StockModel {
  const profile = sectorProfile(options.sic);
  const latest = fin.latest;
  const reasons: string[] = [];
  const basis = latest
    ? `${fin.taxonomy === "ifrs-full" ? "IFRS" : "US-GAAP"}, Geschäftsjahr bis ${latest.end}, ${latest.form ?? "Jahresbericht"} eingereicht am ${latest.filed ?? "–"}, Währung ${fin.currency ?? "unbekannt"}`
    : "keine Jahresabschlüsse verfügbar";

  if (!profile.dcfSuitable) reasons.push(profile.dcfNote ?? "Für diese Branche ist das Verfahren nicht geeignet.");
  if (!latest || latest.revenue === null) reasons.push("Umsatz des letzten Geschäftsjahres fehlt.");
  if (metrics.avgFcfMargin === null) reasons.push("Freier Cashflow nicht ermittelbar (operativer Cashflow oder Investitionen fehlen).");
  else if (metrics.avgFcfMargin <= 0) reasons.push("Der freie Cashflow war im Durchschnitt der letzten Jahre nicht positiv; ein DCF wäre nicht aussagekräftig.");
  if (metrics.netDebt === null) reasons.push("Nettoverschuldung nicht ermittelbar (Finanzschulden oder Zahlungsmittel fehlen).");
  if (metrics.revenueCagr === null) reasons.push("Umsatzwachstum nicht ermittelbar (weniger als zwei Jahreswerte).");

  const shares = latest?.dilutedShares ?? options.sharesOutstanding;
  const sharesBasis = latest?.dilutedShares
    ? "verwässerte durchschnittliche Aktienanzahl des letzten Geschäftsjahres"
    : options.sharesOutstanding ? "ausstehende Aktien laut Deckblatt des letzten Berichts" : null;
  if (!shares) reasons.push("Aktienanzahl fehlt.");

  const empty: StockModel = {
    applicable: false, reasons, calcVersion: VALUATION_CALC_VERSION, profile,
    currency: fin.currency, basis, normalizedFcf: null, fcfMarginUsed: null,
    netDebt: metrics.netDebt, shares: shares ?? null, sharesBasis,
    scenarios: [], band: { bear: null, base: null, bull: null }, sensitivity: null, assumptions: [],
    price: { value: options.price, discountToBasePct: null, upsideToBasePct: null, verdict: "Datenlage unzureichend", impliedGrowth: null, historicalGrowth: metrics.revenueCagr },
  };
  if (reasons.length > 0 || !latest?.revenue || !shares || metrics.avgFcfMargin === null || metrics.netDebt === null || metrics.revenueCagr === null) {
    return empty;
  }

  const fcfMarginUsed = metrics.avgFcfMargin;
  const normalizedFcf = latest.revenue * fcfMarginUsed;
  const baseGrowth = clamp(metrics.revenueCagr, 0, MODEL_DEFAULTS.maxBaseGrowth);
  const common = { freeCashFlow: normalizedFcf, shares, netDebt: metrics.netDebt, years: MODEL_DEFAULTS.years, fade: true };

  const defs = [
    { key: "bear" as const, label: "Pessimistisch", growth: baseGrowth * MODEL_DEFAULTS.bear.growthFactor, discountRate: MODEL_DEFAULTS.bear.discountRate, terminalGrowth: MODEL_DEFAULTS.bear.terminalGrowth },
    { key: "base" as const, label: "Basis", growth: baseGrowth, discountRate: MODEL_DEFAULTS.base.discountRate, terminalGrowth: MODEL_DEFAULTS.base.terminalGrowth },
    { key: "bull" as const, label: "Optimistisch", growth: Math.min(baseGrowth + MODEL_DEFAULTS.bull.growthAdd, MODEL_DEFAULTS.bull.maxGrowth), discountRate: MODEL_DEFAULTS.bull.discountRate, terminalGrowth: MODEL_DEFAULTS.bull.terminalGrowth },
  ];
  const inputsFor = (d: (typeof defs)[number]): DcfInputs => ({ ...common, growth: d.growth, discountRate: d.discountRate, terminalGrowth: d.terminalGrowth });
  const scenarios: ScenarioResult[] = defs.map((d) => ({ ...d, result: discountedCashFlow(inputsFor(d)) }));
  const value = (k: "bear" | "base" | "bull") => scenarios.find((s) => s.key === k)?.result?.perShare ?? null;
  const band = { bear: value("bear"), base: value("base"), bull: value("bull") };

  const growths = [-0.04, -0.02, 0, 0.02, 0.04].map((d) => Math.max(baseGrowth + d, -0.02));
  const discountRates = [0.08, 0.09, 0.1];

  const assumptions = [
    `Ausgangsbasis: normalisierter freier Cashflow = letzter Umsatz × durchschnittliche FCF-Marge der letzten ${Math.min(3, fin.years.length)} Geschäftsjahre (${pct(fcfMarginUsed)}); die Marge wird als konstant angenommen.`,
    `Startwachstum im Basisszenario = historisches Umsatzwachstum (${pct(metrics.revenueCagr)} pro Jahr über ${metrics.revenueCagrYears} Jahre), begrenzt auf 0 bis ${pct(MODEL_DEFAULTS.maxBaseGrowth)}.`,
    `Das Wachstum sinkt über ${MODEL_DEFAULTS.years} Jahre linear auf das ewige Wachstum.`,
    `Diskontsatz: ${pct(MODEL_DEFAULTS.bull.discountRate)} optimistisch, ${pct(MODEL_DEFAULTS.base.discountRate)} Basis, ${pct(MODEL_DEFAULTS.bear.discountRate)} pessimistisch. Pauschale Annahme, kein unternehmensspezifischer Kapitalkostensatz.`,
    `Ewiges Wachstum: ${pct(MODEL_DEFAULTS.bear.terminalGrowth)} / ${pct(MODEL_DEFAULTS.base.terminalGrowth)} / ${pct(MODEL_DEFAULTS.bull.terminalGrowth)}.`,
    `Nettoverschuldung = Finanzschulden minus Zahlungsmittel${latest.debtIncomplete ? " (nur langfristiger Anteil gemeldet – der Wert kann zu niedrig sein)" : ""}; Leasingverbindlichkeiten und Wertpapiere sind nicht berücksichtigt.`,
    `Aktienanzahl: ${sharesBasis}.`,
  ];
  if (profile.dcfNote) assumptions.push(`Branchenhinweis: ${profile.dcfNote}`);

  const base = band.base;
  return {
    applicable: base !== null,
    reasons: base === null ? ["Das Modell liefert mit diesen Annahmen keinen positiven Eigenkapitalwert."] : [],
    calcVersion: VALUATION_CALC_VERSION, profile, currency: fin.currency, basis,
    normalizedFcf, fcfMarginUsed, netDebt: metrics.netDebt, shares, sharesBasis,
    scenarios, band,
    sensitivity: { growths, discountRates, cells: sensitivityGrid(inputsFor(defs[1]), growths, discountRates) },
    assumptions,
    price: {
      value: options.price,
      discountToBasePct: base !== null && options.price ? discountToModelPct(base, options.price) : null,
      upsideToBasePct: base !== null && options.price ? upsideToModelPct(base, options.price) : null,
      verdict: classifyAgainstBand(options.price, band.bear, band.bull),
      impliedGrowth: options.price ? impliedGrowth({ ...common, discountRate: MODEL_DEFAULTS.base.discountRate, terminalGrowth: MODEL_DEFAULTS.base.terminalGrowth }, options.price) : null,
      historicalGrowth: metrics.revenueCagr,
    },
  };
}

/** Satz fuer die Oberflaeche: Was setzt der Kurs voraus? */
export function impliedGrowthSentence(model: StockModel): string | null {
  const g = model.price.impliedGrowth;
  const h = model.price.historicalGrowth;
  if (g === null) {
    return model.price.value === null
      ? "Ohne Kurs lässt sich nicht bestimmen, welches Wachstum eingepreist ist."
      : "Der Kurs liegt außerhalb des Bereichs, den das Modell sinnvoll abbilden kann.";
  }
  const base = `Damit der heutige Kurs aufgeht, müsste der freie Cashflow im Modell zunächst um rund ${pct(g)} pro Jahr wachsen und danach über zehn Jahre auf das ewige Wachstum zurückgehen.`;
  if (h === null) return base;
  const comparison = g > h + 0.02 ? "Das liegt deutlich über dem historischen Wachstum" : g < h - 0.02 ? "Das liegt unter dem historischen Wachstum" : "Das entspricht ungefähr dem historischen Wachstum";
  return `${base} ${comparison} von ${pct(h)}.`;
}
