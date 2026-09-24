/**
 * Aktien-Scorecard. Jede Dimension nennt Kennzahlen, Richtung, Methode,
 * Gewicht und Vergleichsmassstab. Fehlende Dimensionen werden nicht mit 0
 * gefuellt. Ein Gesamtwert entsteht erst ab vier belegten Dimensionen, und
 * Warnsignale stehen immer daneben.
 */

import type { CompanyFinancials, FinancialMetrics } from "./fundamentals.ts";
import { scoreFromRange } from "./valuation.ts";
import { sectorProfile } from "./sectors.ts";

export type DimensionKey = "bewertung" | "wachstum" | "profitabilitaet" | "bilanz" | "momentum" | "revisionen" | "stabilitaet";

export interface Dimension {
  key: DimensionKey; label: string; weight: number; score: number | null;
  metrics: { label: string; value: string; plain?: string }[];
  direction: string; method: string; comparison: string; unavailableReason?: string;
}

export interface Scorecard {
  dimensions: Dimension[];
  overall: number | null;
  overallNote: string;
  redFlags: string[];
  dataQuality: { coveragePct: number; latestFiscalYearEnd: string | null; ageMonths: number | null; note: string };
}

export const MIN_DIMENSIONS_FOR_OVERALL = 4;

const share = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(1).replace(".", ",")} %`);
const mult = (v: number | null) => (v === null ? "–" : `${v.toFixed(1).replace(".", ",")}×`);

export function buildScorecard(
  fin: CompanyFinancials,
  m: FinancialMetrics,
  options: { sic?: string | null; momentum3mPct?: number | null; volatilityPct?: number | null; maxDrawdownPct?: number | null; valuationScore?: number | null } = {},
  now = new Date(),
): Scorecard {
  const profile = sectorProfile(options.sic ?? null);
  const avg = (values: (number | null)[]) => {
    const v = values.filter((x): x is number => x !== null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const noPrice = "Benötigt Kursdaten; derzeit keine Quelle verbunden.";

  const balanceScore = !profile.dcfSuitable
    ? null
    : m.netDebt === null ? null : m.netDebt <= 0 ? 100 : m.netDebtToOcf === null ? 0 : scoreFromRange(m.netDebtToOcf, 4, 0);

  const dims: Dimension[] = [
    {
      key: "bewertung", label: "Bewertung", weight: 0.15, score: options.valuationScore ?? null, metrics: [],
      direction: "Höher = günstiger im Verhältnis zum Modellwert",
      method: "Lage des Kurses im Bewertungsband der Modellbewertung.", comparison: "eigenes Modell",
      unavailableReason: options.valuationScore == null ? noPrice : undefined,
    },
    {
      key: "wachstum", label: "Wachstum", weight: 0.25,
      score: avg([
        m.revenueCagr === null ? null : scoreFromRange(m.revenueCagr * 100, 0, 20),
        m.epsGrowthLatest === null ? null : scoreFromRange(m.epsGrowthLatest * 100, -20, 30),
      ]),
      metrics: [
        { label: `Umsatzwachstum pro Jahr (${m.revenueCagrYears} J.)`, value: share(m.revenueCagr),
          plain: m.revenueCagr === null ? undefined : m.revenueCagr > 0.1 ? "Der Umsatz wächst deutlich." : m.revenueCagr > 0 ? "Der Umsatz wächst langsam." : "Der Umsatz wächst nicht." },
        { label: "Veränderung Ergebnis je Aktie (letztes Jahr)", value: share(m.epsGrowthLatest) },
      ],
      direction: "Höher = stärkeres Wachstum",
      method: "Umsatz-Wachstum 0 % → 0 Punkte, 20 % → 100; Ergebnisveränderung −20 % → 0, +30 % → 100; Mittelwert.",
      comparison: "feste Schwellen, keine Branchengruppe",
    },
    {
      key: "profitabilitaet", label: "Profitabilität", weight: 0.25,
      score: avg([
        m.operatingMargin === null ? null : scoreFromRange(m.operatingMargin * 100, 0, 35),
        m.roe === null ? null : scoreFromRange(m.roe * 100, 0, 35),
      ]),
      metrics: [
        { label: "Operative Marge", value: share(m.operatingMargin),
          plain: m.operatingMargin === null ? undefined : `Von 100 ${fin.currency ?? "Einheiten"} Umsatz bleiben ${(m.operatingMargin * 100).toFixed(0)} vor Zinsen und Steuern übrig.` },
        { label: "Eigenkapitalrendite", value: m.negativeEquity ? "nicht sinnvoll (negatives Eigenkapital)" : share(m.roe) },
        { label: "Freier Cashflow zum Umsatz", value: share(m.fcfMargin) },
      ],
      direction: "Höher = profitabler",
      method: "Operative Marge 0–35 % und Eigenkapitalrendite 0–35 % linear auf 0–100; Mittelwert.",
      comparison: "feste Schwellen, keine Branchengruppe",
    },
    {
      key: "bilanz", label: "Bilanz", weight: 0.2, score: balanceScore,
      metrics: [
        { label: "Nettoverschuldung ÷ operativer Cashflow", value: m.netDebt !== null && m.netDebt <= 0 ? "Nettoliquidität" : mult(m.netDebtToOcf),
          plain: m.netDebt !== null && m.netDebt <= 0
            ? "Das Unternehmen hat mehr Zahlungsmittel als Finanzschulden."
            : m.netDebtToOcf === null ? undefined : `Die Schulden entsprechen etwa ${m.netDebtToOcf.toFixed(1).replace(".", ",")} Jahren des operativen Cashflows.` },
      ],
      direction: "Höher = solidere Finanzierung",
      method: "Nettoliquidität → 100; Schulden von vier Jahres-Cashflows oder mehr → 0; dazwischen linear.",
      comparison: "feste Schwellen, keine Branchengruppe",
      unavailableReason: !profile.dcfSuitable ? `Für ${profile.label} ist diese Kennzahl nicht aussagekräftig.` : undefined,
    },
    {
      key: "momentum", label: "Momentum", weight: 0.05,
      score: options.momentum3mPct == null ? null : scoreFromRange(options.momentum3mPct, -25, 25),
      metrics: options.momentum3mPct == null ? [] : [{ label: "Kursentwicklung 3 Monate", value: `${options.momentum3mPct.toFixed(1).replace(".", ",")} %` }],
      direction: "Höher = stärkere Kursentwicklung", method: "Kursentwicklung über drei Monate, −25 % → 0, +25 % → 100.",
      comparison: "eigene Historie", unavailableReason: options.momentum3mPct == null ? noPrice : undefined,
    },
    {
      key: "revisionen", label: "Analystenrevisionen", weight: 0.05, score: null, metrics: [],
      direction: "Höher = angehobene Schätzungen", method: "Veränderung der Konsensschätzungen über 90 Tage.",
      comparison: "Konsens", unavailableReason: "Benötigt einen lizenzierten Analystendatensatz; derzeit keine Quelle verbunden.",
    },
    {
      key: "stabilitaet", label: "Stabilität", weight: 0.05,
      score: options.volatilityPct == null || options.maxDrawdownPct == null ? null
        : Math.round((scoreFromRange(options.volatilityPct, 60, 0) + scoreFromRange(options.maxDrawdownPct, -60, 0)) / 2),
      metrics: options.volatilityPct == null ? [] : [
        { label: "Schwankung (annualisiert)", value: `${options.volatilityPct.toFixed(1).replace(".", ",")} %` },
        { label: "Größter Rückgang", value: options.maxDrawdownPct == null ? "–" : `${options.maxDrawdownPct.toFixed(1).replace(".", ",")} %` },
      ],
      direction: "Höher = ruhigerer Kursverlauf (hohe Zahl ist gut)",
      method: "Schwankung 60 % → 0, 0 % → 100; größter Rückgang −60 % → 0, 0 % → 100; Mittelwert.",
      comparison: "feste Schwellen",
      unavailableReason: options.volatilityPct == null ? noPrice : undefined,
    },
  ];

  for (const d of dims) if (d.score === null && !d.unavailableReason) d.unavailableReason = "Zugrunde liegende Kennzahlen fehlen im Jahresabschluss.";

  const available = dims.filter((d) => d.score !== null);
  let overall: number | null = null;
  let overallNote: string;
  if (available.length >= MIN_DIMENSIONS_FOR_OVERALL) {
    const w = available.reduce((s, d) => s + d.weight, 0);
    overall = Math.round(available.reduce((s, d) => s + d.score! * d.weight, 0) / w);
    overallNote = `Gewichteter Mittelwert aus ${available.length} von ${dims.length} Dimensionen.`;
  } else {
    overallNote = `Kein Gesamtwert: nur ${available.length} von ${dims.length} Dimensionen sind belegt (mindestens ${MIN_DIMENSIONS_FOR_OVERALL} nötig).`;
  }

  const redFlags: string[] = [];
  if (m.negativeEquity) redFlags.push("Negatives Eigenkapital im letzten Jahresabschluss.");
  if (m.revenueGrowthLatest !== null && m.revenueGrowthLatest < 0) redFlags.push(`Umsatzrückgang im letzten Geschäftsjahr (${share(m.revenueGrowthLatest)}).`);
  if (m.fcfMargin !== null && m.fcfMargin < 0) redFlags.push("Negativer freier Cashflow im letzten Geschäftsjahr.");
  if (m.netDebtToOcf !== null && m.netDebtToOcf > 4) redFlags.push(`Hohe Verschuldung: Nettoverschuldung entspricht ${mult(m.netDebtToOcf)} des operativen Cashflows.`);
  if (m.shareCountChange !== null && m.shareCountChange > 0.05) {
    redFlags.push(`Verwässerung: Die Aktienanzahl stieg in ${m.shareCountYears} Jahren um ${share(m.shareCountChange)}. Dein Anteil am Unternehmen wird dadurch kleiner.`);
  }
  if (fin.latest?.debtIncomplete) redFlags.push("Finanzschulden nur teilweise gemeldet; die Verschuldung kann höher sein als ausgewiesen.");

  const latestEnd = fin.latest?.end ?? null;
  const ageMonths = latestEnd ? Math.floor((now.getTime() - Date.parse(`${latestEnd}T00:00:00Z`)) / (30.44 * 86400000)) : null;
  return {
    dimensions: dims, overall, overallNote, redFlags,
    dataQuality: {
      coveragePct: fin.coveragePct, latestFiscalYearEnd: latestEnd, ageMonths,
      note: `${fin.coveragePct} % der Kerngrößen im letzten Jahresabschluss vorhanden${ageMonths !== null && ageMonths > 15 ? "; der letzte Jahresabschluss ist älter als 15 Monate" : ""}.`,
    },
  };
}
