/**
 * Bewertungsschicht – reine Funktionen, kein Datenzugriff, keine Oberflaeche.
 * Ergebnisse sind Modellwerte auf Basis offengelegter Annahmen, keine
 * Tatsachenaussage. Es gibt bewusst keine Kennzahl, die wie eine
 * Trefferwahrscheinlichkeit aussieht.
 */

export const VALUATION_CALC_VERSION = "bewertung-2026.09-2";

export interface DcfInputs {
  /** Freier Cashflow des Ausgangsjahres (operativer Cashflow minus Investitionen). */
  freeCashFlow: number;
  /** Verwaesserte Aktienanzahl. */
  shares: number;
  /** Nettoverschuldung = Finanzschulden minus Zahlungsmittel. Negativ = Nettoliquiditaet. */
  netDebt: number;
  /** Wachstum im ersten Planjahr. */
  growth: number;
  terminalGrowth: number;
  discountRate: number;
  years: number;
  /** true: Wachstum sinkt linear auf das ewige Wachstum (konservativer). */
  fade: boolean;
}

export interface DcfResult {
  perShare: number;
  enterpriseValue: number;
  equityValue: number;
  /** Anteil des Endwerts am Unternehmenswert: hoch = Ergebnis haengt an ferner Zukunft. */
  terminalShare: number;
  growthPath: number[];
}

export function growthPath(start: number, terminal: number, years: number, fade: boolean): number[] {
  if (!fade || years <= 1) return Array.from({ length: years }, () => start);
  return Array.from({ length: years }, (_, i) => start + ((terminal - start) * i) / (years - 1));
}

/**
 * Zweiphasiges DCF-Modell. `null`, wenn das Modell nicht definiert ist:
 * negativer Cashflow, Diskontsatz nicht ueber dem ewigen Wachstum, keine
 * Aktien oder rechnerisch nicht positives Eigenkapital.
 */
export function discountedCashFlow(i: DcfInputs): DcfResult | null {
  if (![i.freeCashFlow, i.shares, i.netDebt, i.growth, i.terminalGrowth, i.discountRate].every(Number.isFinite)) return null;
  if (i.freeCashFlow <= 0 || i.shares <= 0 || i.years < 1) return null;
  if (i.discountRate <= i.terminalGrowth) return null;

  const path = growthPath(i.growth, i.terminalGrowth, i.years, i.fade);
  let flow = i.freeCashFlow;
  let presentValue = 0;
  path.forEach((g, index) => {
    flow *= 1 + g;
    presentValue += flow / Math.pow(1 + i.discountRate, index + 1);
  });
  const terminalValue = (flow * (1 + i.terminalGrowth)) / (i.discountRate - i.terminalGrowth);
  const discountedTerminal = terminalValue / Math.pow(1 + i.discountRate, i.years);
  const enterpriseValue = presentValue + discountedTerminal;
  const equityValue = enterpriseValue - i.netDebt;
  if (equityValue <= 0) return null;

  return {
    perShare: equityValue / i.shares,
    enterpriseValue,
    equityValue,
    terminalShare: discountedTerminal / enterpriseValue,
    growthPath: path,
  };
}

/**
 * Abschlag des Kurses zum Modellwert, bezogen auf den Modellwert:
 *   (Modellwert − Kurs) ÷ Modellwert
 * Beispiel: Kurs 512,70, Modellwert 602,94 -> 14,97 %.
 */
export function discountToModelPct(modelValue: number, price: number): number | null {
  if (!Number.isFinite(modelValue) || !Number.isFinite(price) || modelValue <= 0 || price <= 0) return null;
  return ((modelValue - price) / modelValue) * 100;
}

/**
 * Potenzial bis zum Modellwert, bezogen auf den Kurs:
 *   (Modellwert − Kurs) ÷ Kurs
 * Beispiel: Kurs 512,70, Modellwert 602,94 -> 17,60 %.
 */
export function upsideToModelPct(modelValue: number, price: number): number | null {
  if (!Number.isFinite(modelValue) || !Number.isFinite(price) || modelValue <= 0 || price <= 0) return null;
  return ((modelValue - price) / price) * 100;
}

/**
 * Umgekehrte Rechnung: Welches Startwachstum rechtfertigt genau den heutigen
 * Kurs? Beantwortet die Frage "Was ist im Kurs eingepreist?" statt einen
 * angeblich richtigen Preis zu behaupten.
 * Sucht per Intervallhalbierung; `null`, wenn der Kurs ausserhalb des
 * durchsuchten Bereichs liegt.
 */
export function impliedGrowth(
  inputs: Omit<DcfInputs, "growth">,
  price: number,
  bounds: { min: number; max: number } = { min: -0.05, max: 0.4 },
  steps = 60,
): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const valueAt = (growth: number) => discountedCashFlow({ ...inputs, growth })?.perShare ?? null;
  let low = bounds.min;
  let high = bounds.max;
  const atLow = valueAt(low);
  const atHigh = valueAt(high);
  if (atLow === null || atHigh === null) return null;
  if (price < atLow || price > atHigh) return null;

  for (let i = 0; i < steps; i++) {
    const mid = (low + high) / 2;
    const value = valueAt(mid);
    if (value === null) return null;
    if (value < price) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export type BandVerdict =
  | "Bewertung erscheint attraktiv"
  | "Eher fair bewertet"
  | "Hohe Erwartungen eingepreist"
  | "Datenlage unzureichend";

export const BAND_RULES: Record<BandVerdict, string> = {
  "Bewertung erscheint attraktiv": "Der Kurs liegt unter dem pessimistischen Szenario des Modells.",
  "Eher fair bewertet": "Der Kurs liegt innerhalb der Spanne zwischen pessimistischem und optimistischem Szenario.",
  "Hohe Erwartungen eingepreist": "Der Kurs liegt über dem optimistischen Szenario des Modells.",
  "Datenlage unzureichend": "Kurs oder Modellspanne fehlen; eine Einordnung wäre nicht belastbar.",
};

export function classifyAgainstBand(price: number | null, bear: number | null, bull: number | null): BandVerdict {
  if (price === null || bear === null || bull === null || !(price > 0) || !(bear > 0) || !(bull >= bear)) {
    return "Datenlage unzureichend";
  }
  if (price < bear) return "Bewertung erscheint attraktiv";
  if (price <= bull) return "Eher fair bewertet";
  return "Hohe Erwartungen eingepreist";
}

export interface SensitivityCell { growth: number; discountRate: number; perShare: number | null }

export function sensitivityGrid(inputs: DcfInputs, growths: number[], discountRates: number[]): SensitivityCell[] {
  const cells: SensitivityCell[] = [];
  for (const discountRate of discountRates) {
    for (const growth of growths) {
      const r = discountedCashFlow({ ...inputs, growth, discountRate });
      cells.push({ growth, discountRate, perShare: r ? r.perShare : null });
    }
  }
  return cells;
}

/** Durchschnittliche jaehrliche Wachstumsrate zwischen zwei positiven Werten. */
export function cagr(first: number, last: number, years: number): number | null {
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Lineare Abbildung auf 0–100; worst > best kehrt die Richtung um. */
export function scoreFromRange(value: number, worst: number, best: number): number {
  if (!Number.isFinite(value)) return 0;
  if (worst === best) return 50;
  return clamp(Math.round(((value - worst) / (best - worst)) * 100), 0, 100);
}
