/**
 * Jahresfinanzzahlen aus SEC-XBRL-Daten (US-GAAP oder IFRS), rein funktional.
 * Werte stammen ausschliesslich aus eingereichten Jahresberichten; fehlende
 * Groessen bleiben leer und werden nicht geschaetzt.
 */

import type { AnnualValue } from "../sources/parsers/sec.ts";
import { cagr } from "./valuation.ts";

export type FinKey =
  | "revenue" | "operatingIncome" | "netIncome" | "operatingCashFlow" | "capex"
  | "cash" | "debtTotal" | "debtNoncurrent" | "debtCurrent" | "equity"
  | "epsDiluted" | "dilutedShares" | "dividendsPaid" | "buybacks";

export interface ConceptSpec {
  key: FinKey;
  kind: "duration" | "instant";
  usGaap: string[];
  ifrs: string[];
  unit: "money" | "perShare" | "shares";
}

/** Reihenfolge = Vorrang. Beim Umsatz werden Tag-Wechsel ueber die Jahre zusammengefuehrt. */
export const CONCEPTS: ConceptSpec[] = [
  { key: "revenue", kind: "duration", unit: "money", usGaap: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], ifrs: ["Revenue"] },
  { key: "operatingIncome", kind: "duration", unit: "money", usGaap: ["OperatingIncomeLoss"], ifrs: ["ProfitLossFromOperatingActivities"] },
  { key: "netIncome", kind: "duration", unit: "money", usGaap: ["NetIncomeLoss"], ifrs: ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"] },
  { key: "operatingCashFlow", kind: "duration", unit: "money", usGaap: ["NetCashProvidedByUsedInOperatingActivities"], ifrs: ["CashFlowsFromUsedInOperatingActivities"] },
  { key: "capex", kind: "duration", unit: "money", usGaap: ["PaymentsToAcquirePropertyPlantAndEquipment"], ifrs: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"] },
  { key: "cash", kind: "instant", unit: "money", usGaap: ["CashAndCashEquivalentsAtCarryingValue"], ifrs: ["CashAndCashEquivalents"] },
  { key: "debtTotal", kind: "instant", unit: "money", usGaap: ["LongTermDebt"], ifrs: [] },
  { key: "debtNoncurrent", kind: "instant", unit: "money", usGaap: ["LongTermDebtNoncurrent"], ifrs: [] },
  { key: "debtCurrent", kind: "instant", unit: "money", usGaap: ["LongTermDebtCurrent"], ifrs: [] },
  { key: "equity", kind: "instant", unit: "money", usGaap: ["StockholdersEquity"], ifrs: ["EquityAttributableToOwnersOfParent", "Equity"] },
  { key: "epsDiluted", kind: "duration", unit: "perShare", usGaap: ["EarningsPerShareDiluted"], ifrs: ["DilutedEarningsLossPerShare"] },
  { key: "dilutedShares", kind: "duration", unit: "shares", usGaap: ["WeightedAverageNumberOfDilutedSharesOutstanding"], ifrs: ["AdjustedWeightedAverageShares"] },
  { key: "dividendsPaid", kind: "duration", unit: "money", usGaap: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"], ifrs: ["DividendsPaidClassifiedAsFinancingActivities"] },
  { key: "buybacks", kind: "duration", unit: "money", usGaap: ["PaymentsForRepurchaseOfCommonStock"], ifrs: [] },
];

export const LABELS: Record<FinKey, string> = {
  revenue: "Umsatz", operatingIncome: "Operatives Ergebnis", netIncome: "Jahresüberschuss",
  operatingCashFlow: "Operativer Cashflow", capex: "Investitionen in Sachanlagen",
  cash: "Zahlungsmittel", debtTotal: "Finanzschulden", debtNoncurrent: "Langfristige Finanzschulden",
  debtCurrent: "Kurzfristiger Anteil der Finanzschulden", equity: "Eigenkapital",
  epsDiluted: "Verwässertes Ergebnis je Aktie", dilutedShares: "Verwässerte Aktienanzahl",
  dividendsPaid: "Gezahlte Dividenden", buybacks: "Aktienrückkäufe",
};

export interface FinancialYear {
  end: string;
  revenue: number | null; operatingIncome: number | null; netIncome: number | null;
  operatingCashFlow: number | null; capex: number | null; freeCashFlow: number | null;
  cash: number | null; debt: number | null; debtIncomplete: boolean;
  equity: number | null; epsDiluted: number | null; dilutedShares: number | null;
  dividendsPaid: number | null; buybacks: number | null;
  filed: string | null; form: string | null; accession: string | null;
}

export interface CompanyFinancials {
  currency: string | null;
  taxonomy: "us-gaap" | "ifrs-full" | null;
  years: FinancialYear[];
  latest: FinancialYear | null;
  /** Anteil der Kerngroessen, die fuer das letzte Jahr vorliegen (0–100). */
  coveragePct: number;
  missing: FinKey[];
}

/** Fuehrt mehrere Konzeptreihen zusammen; die erste Reihe hat Vorrang. */
export function mergeSeries(series: AnnualValue[][]): AnnualValue[] {
  const byEnd = new Map<string, AnnualValue>();
  for (const s of series) for (const v of s) if (!byEnd.has(v.end)) byEnd.set(v.end, v);
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

function near(series: AnnualValue[] | undefined, end: string, toleranceDays = 7): AnnualValue | undefined {
  if (!series) return undefined;
  const t = Date.parse(`${end}T00:00:00Z`);
  return series.find((v) => Math.abs(Date.parse(`${v.end}T00:00:00Z`) - t) <= toleranceDays * 86400000);
}

const CORE: FinKey[] = ["revenue", "operatingIncome", "netIncome", "operatingCashFlow", "capex", "cash", "equity", "dilutedShares"];

export function buildFinancials(
  series: Partial<Record<FinKey, AnnualValue[]>>,
  taxonomy: "us-gaap" | "ifrs-full" | null,
  maxYears = 6,
): CompanyFinancials {
  const anchor = series.revenue?.length ? series.revenue : series.netIncome ?? [];
  const ends = anchor.map((v) => v.end).slice(-maxYears);
  const currency = (series.revenue?.[0] ?? series.netIncome?.[0])?.unit ?? null;

  const years: FinancialYear[] = ends.map((end) => {
    const get = (k: FinKey) => near(series[k], end)?.value ?? null;
    const ocf = get("operatingCashFlow");
    const capex = get("capex");
    const total = get("debtTotal");
    const nonCurrent = get("debtNoncurrent");
    const current = get("debtCurrent");
    let debt: number | null = null;
    let debtIncomplete = false;
    if (total !== null) debt = total;
    else if (nonCurrent !== null && current !== null) debt = nonCurrent + current;
    else if (nonCurrent !== null) { debt = nonCurrent; debtIncomplete = true; }
    const src = near(series.revenue, end) ?? near(series.netIncome, end);
    return {
      end,
      revenue: get("revenue"), operatingIncome: get("operatingIncome"), netIncome: get("netIncome"),
      operatingCashFlow: ocf, capex,
      freeCashFlow: ocf !== null && capex !== null ? ocf - Math.abs(capex) : null,
      cash: get("cash"), debt, debtIncomplete, equity: get("equity"),
      epsDiluted: get("epsDiluted"), dilutedShares: get("dilutedShares"),
      dividendsPaid: get("dividendsPaid"), buybacks: get("buybacks"),
      filed: src?.filed ?? null, form: src?.form ?? null, accession: src?.accession ?? null,
    };
  });

  const latest = years.at(-1) ?? null;
  const missing = latest ? CORE.filter((k) => (latest as unknown as Record<string, unknown>)[k] === null) : CORE;
  return { currency, taxonomy, years, latest, coveragePct: Math.round(((CORE.length - missing.length) / CORE.length) * 100), missing };
}

export interface FinancialMetrics {
  revenueCagr: number | null; revenueCagrYears: number; revenueGrowthLatest: number | null;
  epsGrowthLatest: number | null; operatingMargin: number | null; netMargin: number | null;
  fcfMargin: number | null; avgFcfMargin: number | null; roe: number | null;
  netDebt: number | null; netDebtToOcf: number | null;
  /** Veraenderung der verwaesserten Aktienanzahl; positiv = Verwaesserung. */
  shareCountChange: number | null; shareCountYears: number;
  fcfPositiveYears: number; yearsWithFcf: number; negativeEquity: boolean;
  equityPerShare: number | null;
  /** Ausschuettung und Rueckkauf im Verhaeltnis zum freien Cashflow. */
  payoutOfFcf: number | null;
}

export function financialMetrics(f: CompanyFinancials): FinancialMetrics {
  const y = f.years;
  const last = y.at(-1);
  const prev = y.at(-2);
  const ratio = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null && b !== 0 ? a / b : null);
  const growth = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null && b > 0 ? a / b - 1 : null);

  const withRevenue = y.filter((v) => v.revenue !== null && v.revenue > 0);
  const span = Math.min(3, withRevenue.length - 1);
  const fcfMargins = y.slice(-3).map((v) => ratio(v.freeCashFlow, v.revenue)).filter((m): m is number => m !== null);
  const avgEquity = last?.equity != null && prev?.equity != null ? (last.equity + prev.equity) / 2 : last?.equity ?? null;
  const netDebt = last && last.debt !== null && last.cash !== null ? last.debt - last.cash : null;
  const sharesWith = y.filter((v) => v.dilutedShares !== null);
  const shareSpan = Math.min(3, sharesWith.length - 1);
  const payout = last && last.freeCashFlow && last.freeCashFlow > 0
    ? (Math.abs(last.dividendsPaid ?? 0) + Math.abs(last.buybacks ?? 0)) / last.freeCashFlow
    : null;

  return {
    revenueCagr: span >= 1 ? cagr(withRevenue.at(-1 - span)!.revenue!, withRevenue.at(-1)!.revenue!, span) : null,
    revenueCagrYears: Math.max(span, 0),
    revenueGrowthLatest: growth(last?.revenue, prev?.revenue),
    epsGrowthLatest: growth(last?.epsDiluted, prev?.epsDiluted),
    operatingMargin: ratio(last?.operatingIncome, last?.revenue),
    netMargin: ratio(last?.netIncome, last?.revenue),
    fcfMargin: ratio(last?.freeCashFlow, last?.revenue),
    avgFcfMargin: fcfMargins.length ? fcfMargins.reduce((a, b) => a + b, 0) / fcfMargins.length : null,
    roe: avgEquity !== null && avgEquity > 0 && last?.netIncome != null ? last.netIncome / avgEquity : null,
    netDebt,
    netDebtToOcf: netDebt !== null && last?.operatingCashFlow && last.operatingCashFlow > 0 ? netDebt / last.operatingCashFlow : null,
    shareCountChange: shareSpan >= 1 ? sharesWith.at(-1)!.dilutedShares! / sharesWith.at(-1 - shareSpan)!.dilutedShares! - 1 : null,
    shareCountYears: Math.max(shareSpan, 0),
    fcfPositiveYears: y.filter((v) => v.freeCashFlow !== null && v.freeCashFlow > 0).length,
    yearsWithFcf: y.filter((v) => v.freeCashFlow !== null).length,
    negativeEquity: last?.equity != null && last.equity < 0,
    equityPerShare: ratio(last?.equity, last?.dilutedShares),
    payoutOfFcf: payout,
  };
}
