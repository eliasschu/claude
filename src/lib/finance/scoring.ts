/**
 * Bewertungslogik für den Interest Score und die Aktien-Scorecard.
 *
 * Beide Werte sind Ordnungshilfen, keine Kauf- oder Verkaufsempfehlung.
 * Die Gewichtungen stehen als Konstanten in dieser Datei und werden in der
 * Oberflaeche unverändert angezeigt.
 */

import { clamp } from "./valuation";

/** Lineare Abbildung eines Messwerts auf 0–100, ausserhalb der Spanne gekappt. */
export function scoreFromRange(value: number, worst: number, best: number): number {
  if (!Number.isFinite(value)) return 0;
  if (worst === best) return 50;
  const raw = ((value - worst) / (best - worst)) * 100;
  return clamp(Math.round(raw), 0, 100);
}

export interface InterestComponents {
  /** Handelsvolumen im Verhaeltnis zum Durchschnitt, 0–100. */
  volumeAnomaly: number;
  /** Kursmomentum über 1 und 3 Monate, 0–100. */
  momentum: number;
  /** Netto-Hochstufungen der Analysten, 0–100. */
  analystRevisions: number;
  /** Veränderung der Gewinnschätzungen, 0–100. */
  earningsRevisions: number;
  /** Bewertung gegenüber eigener Historie und Branche, 0–100. */
  valuation: number;
  /** Nachrichtenrelevanz der letzten Tage, 0–100. */
  newsRelevance: number;
  /** Insider- und institutionelle Aktivitaet, 0–100. */
  insiderActivity: number;
  /** Nähe und Bedeutung anstehender Ereignisse, 0–100. */
  upcomingEvents: number;
  /** Volatilität – erhöhte Schwankung erhöht die Aufmerksamkeit, 0–100. */
  volatility: number;
  /** Datenqualitaet, 0–100. */
  dataQuality: number;
}

export const INTEREST_WEIGHTS: Record<keyof InterestComponents, number> = {
  volumeAnomaly: 0.15,
  momentum: 0.15,
  analystRevisions: 0.12,
  earningsRevisions: 0.12,
  valuation: 0.12,
  newsRelevance: 0.12,
  insiderActivity: 0.08,
  upcomingEvents: 0.08,
  volatility: 0.03,
  dataQuality: 0.03,
};

export const INTEREST_LABELS: Record<keyof InterestComponents, string> = {
  volumeAnomaly: "Ungewöhnliches Volumen",
  momentum: "Kursmomentum",
  analystRevisions: "Analystenrevisionen",
  earningsRevisions: "Gewinnrevisionen",
  valuation: "Bewertung",
  newsRelevance: "Nachrichtenrelevanz",
  insiderActivity: "Insider und Institutionen",
  upcomingEvents: "Anstehende Ereignisse",
  volatility: "Volatilität",
  dataQuality: "Datenqualitaet",
};

export interface InterestScoreResult {
  score: number;
  contributions: { key: keyof InterestComponents; label: string; value: number; weight: number; points: number }[];
  /** Die drei stärksten Treiber, absteigend. */
  topDrivers: (keyof InterestComponents)[];
}

/** Gewichteter Interest Score von 0 bis 100. */
export function interestScore(components: InterestComponents): InterestScoreResult {
  const keys = Object.keys(INTEREST_WEIGHTS) as (keyof InterestComponents)[];
  const contributions = keys.map((key) => {
    const value = clamp(components[key] ?? 0, 0, 100);
    const weight = INTEREST_WEIGHTS[key];
    return { key, label: INTEREST_LABELS[key], value, weight, points: value * weight };
  });

  const score = clamp(Math.round(contributions.reduce((sum, c) => sum + c.points, 0)), 0, 100);
  const topDrivers = [...contributions].sort((a, b) => b.points - a.points).slice(0, 3).map((c) => c.key);

  return { score, contributions, topDrivers };
}

export interface ScorecardInputs {
  fairValueDeviationPct: number | null;
  revenueGrowth: number;
  epsGrowth: number;
  fcfGrowth: number;
  operatingMargin: number;
  returnOnEquity: number;
  netDebtToEbitda: number;
  momentum3mPct: number | null;
  epsRevision90dPct: number;
  volatilityPct: number | null;
  maxDrawdownPct: number | null;
  dataCompleteness: number;
}

export type ScorecardKey =
  | "bewertung"
  | "wachstum"
  | "qualitaet"
  | "momentum"
  | "bilanz"
  | "revisionen"
  | "risiko"
  | "datenqualitaet";

export const SCORECARD_WEIGHTS: Record<ScorecardKey, number> = {
  bewertung: 0.2,
  wachstum: 0.18,
  qualitaet: 0.16,
  bilanz: 0.12,
  momentum: 0.12,
  revisionen: 0.1,
  risiko: 0.07,
  datenqualitaet: 0.05,
};

export const SCORECARD_METHODS: Record<ScorecardKey, string> = {
  bewertung: "Abweichung vom modellierten fairen Wert, von −40 % (0) bis +40 % (100).",
  wachstum: "Umsatz-, Gewinn- und Free-Cashflow-Wachstum zu gleichen Teilen, 0 % bis 25 %.",
  qualitaet: "Operative Marge (0–35 %) und Eigenkapitalrendite (0–35 %) je zur Hälfte.",
  momentum: "Kursentwicklung der letzten drei Monate, von −25 % (0) bis +25 % (100).",
  bilanz: "Nettoverschuldung zu EBITDA, von 4,0 (0) bis 0,0 (100).",
  revisionen: "Veränderung der Gewinnschätzung der letzten 90 Tage, von −10 % bis +10 %.",
  risiko: "Volatilität (0–60 %) und maximaler Rückgang (0 bis −60 %) je zur Hälfte, invertiert.",
  datenqualitaet: "Vollständigkeit und Aktualität der zugrunde liegenden Kennzahlen.",
};

export const SCORECARD_LABELS: Record<ScorecardKey, string> = {
  bewertung: "Bewertung",
  wachstum: "Wachstum",
  qualitaet: "Qualität",
  momentum: "Momentum",
  bilanz: "Bilanz",
  revisionen: "Analystenrevisionen",
  risiko: "Risiko",
  datenqualitaet: "Datenqualitaet",
};

export interface ScorecardResult {
  scores: Record<ScorecardKey, number | null>;
  /** Gewichteter Gesamtwert; Dimensionen ohne Daten werden herausgerechnet. */
  overall: number | null;
  missing: ScorecardKey[];
}

export function scorecard(inputs: ScorecardInputs): ScorecardResult {
  const scores: Record<ScorecardKey, number | null> = {
    bewertung:
      inputs.fairValueDeviationPct === null ? null : scoreFromRange(inputs.fairValueDeviationPct, -40, 40),
    wachstum: Math.round(
      (scoreFromRange(inputs.revenueGrowth * 100, 0, 25) +
        scoreFromRange(inputs.epsGrowth * 100, 0, 25) +
        scoreFromRange(inputs.fcfGrowth * 100, 0, 25)) /
        3,
    ),
    qualitaet: Math.round(
      (scoreFromRange(inputs.operatingMargin * 100, 0, 35) +
        scoreFromRange(inputs.returnOnEquity * 100, 0, 35)) /
        2,
    ),
    momentum: inputs.momentum3mPct === null ? null : scoreFromRange(inputs.momentum3mPct, -25, 25),
    bilanz: scoreFromRange(inputs.netDebtToEbitda, 4, 0),
    revisionen: scoreFromRange(inputs.epsRevision90dPct, -10, 10),
    risiko:
      inputs.volatilityPct === null || inputs.maxDrawdownPct === null
        ? null
        : Math.round(
            (scoreFromRange(inputs.volatilityPct, 60, 0) + scoreFromRange(inputs.maxDrawdownPct, -60, 0)) / 2,
          ),
    datenqualitaet: clamp(Math.round(inputs.dataCompleteness), 0, 100),
  };

  const keys = Object.keys(SCORECARD_WEIGHTS) as ScorecardKey[];
  const available = keys.filter((k) => scores[k] !== null);
  const missing = keys.filter((k) => scores[k] === null);

  if (available.length === 0) return { scores, overall: null, missing };

  const weightSum = available.reduce((sum, k) => sum + SCORECARD_WEIGHTS[k], 0);
  const overall = Math.round(
    available.reduce((sum, k) => sum + (scores[k] as number) * SCORECARD_WEIGHTS[k], 0) / weightSum,
  );

  return { scores, overall, missing };
}
