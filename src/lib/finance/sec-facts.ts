/**
 * SEC Company Facts -> belegbare Berichtsperioden (reine Funktionen, kein Datenabruf).
 *
 * Auswahlregeln (dokumentiert, getestet):
 *  1. Nur Dauerwerte (start/end) in einer reinen Waehrungseinheit (z. B. USD). Andere Einheiten werden ignoriert.
 *  2. Periodenart aus der Laenge: Quartal 80-100 Tage, Halbjahr 170-190, neun Monate 260-285, Geschaeftsjahr 350-380.
 *     Andere Laengen werden nicht verwendet.
 *  3. Gleicher Zeitraum in mehreren Einreichungen (Original, spaetere Vergleichsangabe, Berichtigung): Es gilt der
 *     Wert der ZULETZT eingereichten Meldung. Abweichende fruehere Werte bleiben als "revisions" sichtbar.
 *  4. Einzelquartale: direkt gemeldete 3-Monats-Werte haben Vorrang. Fehlt einer, wird er NUR aus kumulierten Werten
 *     mit demselben Periodenbeginn abgeleitet (6M - 3M, 9M - 6M, Jahr - 9M). Sonst bleibt das Quartal leer.
 *  5. Fehlende Werte sind fehlend - nie null.
 *  6. Konzeptvorrang je Groesse (z. B. Umsatz); jede Periode vermerkt das verwendete Konzept.
 */

export interface RawFact { start?: string; end: string; val: number; accn: string; form: string; filed: string; fy?: number; fp?: string; frame?: string }
export interface RawConcept { units?: Record<string, RawFact[]> }
export interface CompanyFactsJson { cik?: number | string; entityName?: string; facts?: Record<string, Record<string, RawConcept>> }

export type Quantity = "revenue" | "operatingIncome" | "operatingCashFlow" | "capex";

/** Konzeptvorrang je Groesse (US-GAAP, dann IFRS). */
export const CONCEPTS: Record<Quantity, { taxonomy: "us-gaap" | "ifrs-full"; tag: string }[]> = {
  revenue: [
    { taxonomy: "us-gaap", tag: "RevenueFromContractWithCustomerExcludingAssessedTax" },
    { taxonomy: "us-gaap", tag: "Revenues" },
    { taxonomy: "us-gaap", tag: "SalesRevenueNet" },
    { taxonomy: "ifrs-full", tag: "Revenue" },
  ],
  operatingIncome: [
    { taxonomy: "us-gaap", tag: "OperatingIncomeLoss" },
    { taxonomy: "ifrs-full", tag: "ProfitLossFromOperatingActivities" },
  ],
  operatingCashFlow: [
    { taxonomy: "us-gaap", tag: "NetCashProvidedByUsedInOperatingActivities" },
    { taxonomy: "ifrs-full", tag: "CashFlowsFromUsedInOperatingActivities" },
  ],
  capex: [
    { taxonomy: "us-gaap", tag: "PaymentsToAcquirePropertyPlantAndEquipment" },
    { taxonomy: "ifrs-full", tag: "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities" },
  ],
};

export const QUANTITY_LABEL: Record<Quantity, string> = {
  revenue: "Umsatz", operatingIncome: "Operatives Ergebnis", operatingCashFlow: "Operativer Cashflow",
  capex: "Investitionen in Sachanlagen",
};

export interface SourceRef { accn: string; form: string; filed: string }

export interface PeriodValue {
  quantity: Quantity;
  concept: string;
  unit: string;
  start: string;
  end: string;
  value: number;
  source: SourceRef;
  /** Frueher eingereichte, abweichende Werte fuer denselben Zeitraum (Berichtigungen/Anpassungen). */
  revisions: { value: number; source: SourceRef }[];
  /** Nur bei abgeleiteten Quartalen: Rechenweg */
  derived?: { formula: string; minuend: PeriodValue; subtrahend: PeriodValue };
}

export interface QuantitySeries { quarters: PeriodValue[]; years: PeriodValue[]; unsupportedUnits: string[] }
export type NormalizedFacts = { cik: string; entityName: string; series: Record<Quantity, QuantitySeries> };

const DAY = 86400000;
export const days = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

type Span = "q" | "h" | "9m" | "y";
function spanOf(start: string, end: string): Span | null {
  const d = days(start, end);
  if (d >= 80 && d <= 100) return "q";
  if (d >= 170 && d <= 190) return "h";
  if (d >= 260 && d <= 285) return "9m";
  if (d >= 350 && d <= 380) return "y";
  return null;
}

const isCurrency = (unit: string) => /^[A-Z]{3}$/.test(unit);

/** Je (Beginn, Ende) ein Wert nach Regel 3. */
function latestPerPeriod(q: Quantity, concept: string, unit: string, facts: RawFact[]): PeriodValue[] {
  const groups = new Map<string, RawFact[]>();
  for (const f of facts) {
    if (!f?.start || !f.end || !Number.isFinite(f.val) || !f.filed) continue;
    const k = `${f.start}|${f.end}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  return [...groups.values()].map((g) => {
    const sorted = [...g].sort((a, b) => a.filed.localeCompare(b.filed) || a.accn.localeCompare(b.accn));
    const last = sorted.at(-1)!;
    const revisions = sorted.filter((f) => f.val !== last.val)
      .map((f) => ({ value: f.val, source: { accn: f.accn, form: f.form, filed: f.filed } }));
    return {
      quantity: q, concept, unit, start: last.start!, end: last.end, value: last.val,
      source: { accn: last.accn, form: last.form, filed: last.filed }, revisions,
    };
  });
}

function fmtDe(d: string) {
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
}

/** Quartale nach Regel 4. */
function quartersFrom(values: PeriodValue[]): PeriodValue[] {
  const byKey = new Map(values.map((v) => [`${v.start}|${v.end}`, v]));
  const out = new Map<string, PeriodValue>();
  for (const v of values) if (spanOf(v.start, v.end) === "q") out.set(`${v.start}|${v.end}`, v);
  // Kumulierte Reihen je Periodenbeginn: 3M, 6M, 9M, 12M
  const byStart = new Map<string, PeriodValue[]>();
  for (const v of values) {
    const s = spanOf(v.start, v.end);
    if (!s) continue;
    if (!byStart.has(v.start)) byStart.set(v.start, []);
    byStart.get(v.start)!.push(v);
  }
  const order: Span[] = ["q", "h", "9m", "y"];
  for (const cum of byStart.values()) {
    const bySpan = new Map(cum.map((v) => [spanOf(v.start, v.end)!, v]));
    for (let i = 1; i < order.length; i++) {
      const big = bySpan.get(order[i]);
      const small = bySpan.get(order[i - 1]);
      if (!big || !small || big.concept !== small.concept || big.unit !== small.unit) continue;
      const start = addDays(small.end, 1);
      const key = `${start}|${big.end}`;
      if (out.has(key) || byKey.has(key)) continue; // direkt gemeldetes Quartal hat Vorrang
      if (spanOf(start, big.end) !== "q") continue;
      out.set(key, {
        quantity: big.quantity, concept: big.concept, unit: big.unit, start, end: big.end, value: big.value - small.value,
        source: big.source, revisions: [],
        derived: { formula: `${fmtDe(big.start)}–${fmtDe(big.end)} minus ${fmtDe(small.start)}–${fmtDe(small.end)}`, minuend: big, subtrahend: small },
      });
    }
  }
  return [...out.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/**
 * Normalisiert Company Facts. Je Groesse und Zeitraum gilt das erste Konzept aus der Vorrangliste, das den Zeitraum
 * meldet; das verwendete Konzept steht an jedem Wert.
 */
export function normalizeCompanyFacts(json: CompanyFactsJson): NormalizedFacts {
  const series = {} as Record<Quantity, QuantitySeries>;
  for (const q of Object.keys(CONCEPTS) as Quantity[]) {
    const unsupportedUnits = new Set<string>();
    const quarters = new Map<string, PeriodValue>();
    const years = new Map<string, PeriodValue>();
    for (const { taxonomy, tag } of CONCEPTS[q]) {
      const units = json.facts?.[taxonomy]?.[tag]?.units;
      if (!units) continue;
      for (const [unit, facts] of Object.entries(units)) {
        if (!isCurrency(unit)) { unsupportedUnits.add(unit); continue; }
        const values = latestPerPeriod(q, `${taxonomy}:${tag}`, unit, facts ?? []);
        for (const v of quartersFrom(values)) {
          const k = `${v.start}|${v.end}`;
          if (!quarters.has(k)) quarters.set(k, v);
        }
        for (const v of values) {
          if (spanOf(v.start, v.end) !== "y") continue;
          const k = `${v.start}|${v.end}`;
          if (!years.has(k)) years.set(k, v);
        }
      }
    }
    const sort = (m: Map<string, PeriodValue>) => [...m.values()].sort((a, b) => a.end.localeCompare(b.end));
    series[q] = { quarters: sort(quarters), years: sort(years), unsupportedUnits: [...unsupportedUnits] };
  }
  return { cik: String(json.cik ?? ""), entityName: json.entityName ?? "", series };
}

export function periodLabel(v: { start: string; end: string }, kind: "quartal" | "jahr"): string {
  return `${kind === "quartal" ? "Quartal" : "Geschäftsjahr"} ${fmtDe(v.start)}–${fmtDe(v.end)}`;
}

/** Liegt b direkt nach a (naechste Periode beginnt am Folgetag, Toleranz fuer 52/53-Wochen-Kalender)? */
export function isConsecutive(a: { end: string }, b: { start: string }): boolean {
  const gap = days(a.end, b.start) - 1;
  return gap >= 1 && gap <= 7;
}

export function filingIndexUrl(cik: string, accn: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/`;
}

/** Begrenzt die Reihen auf Perioden, die nach `since` enden (kleinere Antwort an den Browser). */
export function trimFacts(facts: NormalizedFacts, since: string): NormalizedFacts {
  const series = {} as Record<Quantity, QuantitySeries>;
  for (const [q, s] of Object.entries(facts.series) as [Quantity, QuantitySeries][]) {
    series[q] = { ...s, quarters: s.quarters.filter((v) => v.end >= since), years: s.years.filter((v) => v.end >= since) };
  }
  return { ...facts, series };
}
