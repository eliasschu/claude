/**
 * Automatische Pruefung messbarer Kriterien aus SEC-Unternehmenszahlen (reine Funktionen).
 *
 * Regeln:
 *  - Quartale und Geschaeftsjahre werden nie gemischt.
 *  - Der Anker ist die juengste gemeldete Periode der benoetigten Groessen. Die geforderten n Perioden muessen
 *    lueckenlos aufeinander folgen und am Anker enden. Eine fehlende Periode wird nie uebersprungen.
 *  - "ausgeloest" nur, wenn alle n Perioden die Bedingung erfuellen. Erfuellt eine vorhandene Periode sie nicht,
 *    ist das Ergebnis "nicht ausgeloest" - auch wenn andere Perioden fehlen. Sonst "unzureichende Daten".
 *  - Veraltet richtet sich nach dem Bericht, nicht nach dem Abrufzeitpunkt: endet die juengste Periode mehr als
 *    STALE_DAYS (siehe staleLimit) vor dem Pruefdatum, muesste laut SEC-Fristen bereits ein neuerer Bericht vorliegen.
 *  - Margen sind Prozent (Anteil), Wachstum ist eine relative Veraenderung in Prozent, Abstaende zwischen
 *    Prozentwerten sind Prozentpunkte. Basis <= 0 ergibt keine Wachstumsrate (und bei Umsatz <= 0 keine Marge).
 *  - Freier Cashflow = operativer Cashflow minus Investitionen in Sachanlagen (Zahlungen), gleiche Periode,
 *    gleiche Waehrung. Fehlt eine Seite, gibt es keinen Wert.
 */

import { addDays, days, filingIndexUrl, isConsecutive, QUANTITY_LABEL, type NormalizedFacts, type PeriodValue, type Quantity } from "../finance/sec-facts.ts";
import { describeCriterion, type MeasurableCriterion, type MetricKey, type Period } from "./model.ts";

export const EVAL_VERSION = "kriterien-1.1";

export type AutoStatus = "nicht_ausgeloest" | "ausgeloest" | "unzureichende_daten" | "veraltete_daten" | "nicht_unterstuetzt";
export const AUTO_STATUS_LABEL: Record<AutoStatus, string> = {
  nicht_ausgeloest: "nicht ausgelöst", ausgeloest: "ausgelöst", unzureichende_daten: "unzureichende Daten",
  veraltete_daten: "veraltete Daten", nicht_unterstuetzt: "nicht unterstützt",
};

/**
 * Produktregel (gewaehlt, nicht von der SEC vorgegeben): Tage nach dem Ende der juengsten Periode, ab denen die Daten als
 * veraltet gelten, weil laut SEC-Fristen spaetestens dann ein neuerer Bericht vorliegen muesste.
 * Fristen: 10-Q 40-45 Tage, 10-K 60-90 Tage, 20-F 4 Monate nach Periodenende; dazu etwa eine Woche Puffer.
 *  quartal          140 = naechstes Quartal (91) + 45 + Puffer
 *  quartal_vor_fy   190 = juengstes Quartal ist das letzte vor dem Geschaeftsjahresende; der naechste Wert kommt erst
 *                         mit dem 10-K: 91 + 90 + Puffer
 *  jahr             455 = naechstes Geschaeftsjahr (365) + 90 (10-K)
 *  jahr_20f         495 = 365 + 120 (20-F/40-F) + Puffer
 */
export const STALE_DAYS = { quartal: 140, quartal_vor_fy: 190, jahr: 455, jahr_20f: 495 } as const;

const FOREIGN_ANNUAL = /^(20-F|40-F)/;

/** Welche Grenze gilt fuer diese Periode? Ohne erkennbares Geschaeftsjahresende gilt die strengere Quartalsgrenze. */
export function staleLimit(period: Period, anchor: { end: string }, anchorForms: string[], fiscalYearEnds: string[]): { days: number; rule: keyof typeof STALE_DAYS } {
  if (period === "jahr") return anchorForms.some((f) => FOREIGN_ANNUAL.test(f)) ? { days: STALE_DAYS.jahr_20f, rule: "jahr_20f" } : { days: STALE_DAYS.jahr, rule: "jahr" };
  // Liegt ein bekanntes Geschaeftsjahresende (+/- ganze Jahre) etwa ein Quartal nach dem Anker?
  const expectedNext = Date.parse(`${addDays(anchor.end, 91)}T00:00:00Z`);
  const beforeFy = fiscalYearEnds.some((fy) => {
    const diff = Math.abs(expectedNext - Date.parse(`${fy}T00:00:00Z`)) / 86400000;
    const mod = diff % 365.25;
    return Math.min(mod, 365.25 - mod) <= 10;
  });
  return beforeFy ? { days: STALE_DAYS.quartal_vor_fy, rule: "quartal_vor_fy" } : { days: STALE_DAYS.quartal, rule: "quartal" };
}

export const SUPPORTED: Record<MetricKey, string | null> = {
  operating_margin: null, revenue_growth_yoy: null, fcf_margin: null, free_cash_flow: null, revenue: null,
  net_debt_to_ocf: "Nettoverschuldung ÷ operativer Cashflow wird automatisch noch nicht geprüft: Finanzschulden sind in den SEC-Daten zu uneinheitlich erfasst.",
};

/** Belegter Eingangswert (kompakt fuer die Speicherung). */
export interface Evidence {
  quantity: string;
  concept: string;
  unit: string;
  start: string;
  end: string;
  value: number;
  accn: string;
  form: string;
  filed: string;
  url: string;
  /** Rechenweg bei abgeleiteten Quartalen */
  derivation?: string;
  /** Fruehere, abweichende Meldungen fuer denselben Zeitraum */
  revisedFrom?: { value: number; filed: string; form: string }[];
}

export interface PeriodResult {
  start: string;
  end: string;
  /** null = nicht berechenbar (Grund in note) */
  value: number | null;
  unit: string;
  met: boolean | null;
  note?: string;
  inputs: Evidence[];
}

export interface CriterionResult {
  criterionId: string;
  criterion: MeasurableCriterion;
  status: AutoStatus;
  sentence: string;
  /** Neueste Periode zuerst */
  periods: PeriodResult[];
  calculation: string;
  evalVersion: string;
}

const FCF_SCOPE = "Abgezogen wird nur das SEC-Konzept „Zahlungen für Sachanlagen“ (PaymentsToAcquirePropertyPlantAndEquipment bzw. IFRS PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities). Separat gemeldete Zahlungen (z. B. für immaterielle Werte oder Software, Tilgung von Finanzierungsleasing) werden nicht abgezogen; ob aktivierte Software im Sachanlagen-Posten steckt, hängt von der Bilanzierung des Unternehmens ab.";

const CALC: Record<MetricKey, string> = {
  operating_margin: "Operatives Ergebnis ÷ Umsatz × 100 (gleiche Periode, gleiche Währung). Ergebnis in %.",
  revenue_growth_yoy: "(Umsatz ÷ Umsatz derselben Periode des Vorjahres − 1) × 100, beide Werte mit demselben SEC-Konzept. Relative Veränderung in %.",
  fcf_margin: "(Operativer Cashflow − Zahlungen für Sachanlagen) ÷ Umsatz × 100. Ergebnis in %. " + FCF_SCOPE,
  free_cash_flow: "Operativer Cashflow − Zahlungen für Sachanlagen, in Millionen der Berichtswährung. " + FCF_SCOPE,
  revenue: "Umsatz in Millionen der Berichtswährung.",
  net_debt_to_ocf: "–",
};

const NEEDS: Record<MetricKey, Quantity[]> = {
  operating_margin: ["revenue", "operatingIncome"],
  revenue_growth_yoy: ["revenue"],
  fcf_margin: ["operatingCashFlow", "capex", "revenue"],
  free_cash_flow: ["operatingCashFlow", "capex"],
  revenue: ["revenue"],
  net_debt_to_ocf: [],
};

const fmtDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const fmtNum = (n: number, digits = 1) => n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const periodText = (p: { start: string; end: string }) => `${fmtDate(p.start)}–${fmtDate(p.end)}`;

function evidence(v: PeriodValue, cik: string): Evidence {
  const e: Evidence = {
    quantity: QUANTITY_LABEL[v.quantity], concept: v.concept, unit: v.unit, start: v.start, end: v.end, value: v.value,
    accn: v.source.accn, form: v.source.form, filed: v.source.filed, url: filingIndexUrl(cik, v.source.accn),
  };
  if (v.derived) {
    e.derivation = `${v.derived.formula}: ${fmtNum(v.derived.minuend.value / 1e6)} − ${fmtNum(v.derived.subtrahend.value / 1e6)} Mio. (Quellen ${v.derived.minuend.source.form} vom ${fmtDate(v.derived.minuend.source.filed)} und ${v.derived.subtrahend.source.form} vom ${fmtDate(v.derived.subtrahend.source.filed)})`;
  }
  if (v.revisions.length) e.revisedFrom = v.revisions.map((r) => ({ value: r.value, filed: r.source.filed, form: r.source.form }));
  return e;
}

function compare(value: number, k: MeasurableCriterion): boolean {
  switch (k.operator) {
    case "<": return value < k.threshold;
    case "<=": return value <= k.threshold;
    case ">": return value > k.threshold;
    case ">=": return value >= k.threshold;
  }
}

const key = (p: { start: string; end: string }) => `${p.start}|${p.end}`;

/** Berechnet den Kennzahlwert einer Periode aus den belegten Werten. */
function computePeriod(metric: MetricKey, period: { start: string; end: string }, list: (q: Quantity) => PeriodValue[], cik: string): PeriodResult {
  const find = (q: Quantity) => list(q).find((v) => key(v) === key(period));
  const base: PeriodResult = { start: period.start, end: period.end, value: null, unit: "", met: null, inputs: [] };
  const inputs: PeriodValue[] = [];
  for (const q of NEEDS[metric]) {
    const v = find(q);
    if (!v) return { ...base, note: `${QUANTITY_LABEL[q]} für ${periodText(period)} ist in den SEC-Daten nicht gemeldet.`, inputs: inputs.map((x) => evidence(x, cik)) };
    inputs.push(v);
  }
  const units = new Set(inputs.map((v) => v.unit));
  if (units.size > 1) return { ...base, note: `Unterschiedliche Währungen (${[...units].join(", ")}) - keine Berechnung.`, inputs: inputs.map((x) => evidence(x, cik)) };
  const cur = inputs[0].unit;
  const ev = inputs.map((x) => evidence(x, cik));
  const byQ = (q: Quantity) => inputs.find((v) => v.quantity === q)!.value;

  switch (metric) {
    case "revenue":
      return { ...base, value: byQ("revenue") / 1e6, unit: `Mio. ${cur}`, inputs: ev };
    case "free_cash_flow":
      return { ...base, value: (byQ("operatingCashFlow") - byQ("capex")) / 1e6, unit: `Mio. ${cur}`, inputs: ev };
    case "operating_margin":
    case "fcf_margin": {
      const rev = byQ("revenue");
      if (rev <= 0) return { ...base, note: "Umsatz ist null oder negativ - keine Marge berechenbar.", inputs: ev };
      const num = metric === "operating_margin" ? byQ("operatingIncome") : byQ("operatingCashFlow") - byQ("capex");
      return { ...base, value: (num / rev) * 100, unit: "%", inputs: ev };
    }
    case "revenue_growth_yoy": {
      const current = inputs[0];
      const prior = list("revenue").find((v) => {
        const gap = days(v.end, current.end) - 1;
        return gap >= 357 && gap <= 372 && Math.abs(days(v.start, v.end) - days(current.start, current.end)) <= 14;
      });
      if (!prior) return { ...base, note: `Umsatz der Vorjahresperiode (bis ca. ${fmtDate(addDays(current.end, -364))}) ist nicht gemeldet.`, inputs: ev };
      const evAll = [...ev, evidence(prior, cik)];
      if (prior.concept !== current.concept) return { ...base, note: `Vorjahresumsatz nutzt ein anderes SEC-Konzept (${prior.concept} statt ${current.concept}) - nicht vergleichbar.`, inputs: evAll };
      if (prior.unit !== current.unit) return { ...base, note: "Vorjahresumsatz in anderer Währung - nicht vergleichbar.", inputs: evAll };
      if (prior.value <= 0) return { ...base, note: "Umsatz der Vorjahresperiode ist null oder negativ - keine Wachstumsrate berechenbar.", inputs: evAll };
      return { ...base, value: (current.value / prior.value - 1) * 100, unit: "%", inputs: evAll };
    }
    default:
      return { ...base, note: "Nicht unterstützt.", inputs: ev };
  }
}

function fmtValue(v: number, unit: string) {
  return unit === "%" ? `${fmtNum(v)} %` : `${fmtNum(v, 0)} ${unit}`;
}

/** Abstand zur Schwelle: bei %-Kennzahlen in Prozentpunkten. */
function distance(v: number, k: MeasurableCriterion, unit: string) {
  const d = v - k.threshold;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  return unit === "%" ? `${sign}${fmtNum(Math.abs(d))} Prozentpunkte zur Schwelle` : `${sign}${fmtNum(Math.abs(d), 0)} ${unit} zur Schwelle`;
}

export function evaluateCriterion(k: MeasurableCriterion, facts: NormalizedFacts, today: string): CriterionResult {
  const out = (status: AutoStatus, sentence: string, periods: PeriodResult[] = []): CriterionResult =>
    ({ criterionId: k.id, criterion: { ...k }, status, sentence, periods, calculation: CALC[k.metric], evalVersion: EVAL_VERSION });

  const unsupported = SUPPORTED[k.metric];
  if (unsupported !== null) return out("nicht_unterstuetzt", unsupported);
  const needs = NEEDS[k.metric];
  const list = (q: Quantity) => (k.period === "quartal" ? facts.series[q].quarters : facts.series[q].years);

  // Alle gemeldeten Perioden der benoetigten Groessen - daraus Anker und Kette
  const all = new Map<string, { start: string; end: string }>();
  for (const q of needs) for (const v of list(q)) all.set(key(v), { start: v.start, end: v.end });
  const periods = [...all.values()].sort((a, b) => a.end.localeCompare(b.end) || a.start.localeCompare(b.start));
  const kind = k.period === "quartal" ? "Quartalswerte" : "Geschäftsjahreswerte";
  if (periods.length === 0) {
    const units = needs.flatMap((q) => facts.series[q].unsupportedUnits);
    return out("unzureichende_daten", `Keine ${kind} für ${needs.map((q) => QUANTITY_LABEL[q]).join(", ")} in den SEC-Daten${units.length ? ` (nur nicht unterstützte Einheiten: ${[...new Set(units)].join(", ")})` : ""}.`);
  }

  const anchor = periods.at(-1)!;
  const chain: { start: string; end: string }[] = [anchor];
  let gap: string | null = null;
  while (chain.length < k.consecutive) {
    const next = chain[chain.length - 1];
    const prev = [...periods].reverse().find((p) => p.end < next.start && isConsecutive(p, next));
    if (!prev) { gap = `Die Periode vor ${periodText(next)} fehlt in den SEC-Daten - Perioden werden nicht übersprungen.`; break; }
    chain.push(prev);
  }

  const results = chain.map((p) => {
    const r = computePeriod(k.metric, p, list, facts.cik);
    return r.value === null ? r : { ...r, met: compare(r.value, k) };
  });

  const known = results.filter((r) => r.met !== null);
  const missing = results.filter((r) => r.met === null);
  const anyFalse = known.some((r) => r.met === false);
  const complete = !gap && missing.length === 0 && results.length === k.consecutive;
  const ageDays = days(anchor.end, today) - 1;
  const anchorForms = needs.flatMap((q) => list(q).filter((v) => key(v) === key(anchor)).map((v) => v.source.form));
  const fyEnds = [...new Set(needs.flatMap((q) => facts.series[q].years.map((v) => v.end)))];
  const limit = staleLimit(k.period, anchor, anchorForms, fyEnds);
  const stale = ageDays > limit.days;

  const cond = describeCriterion(k);
  const latest = results[0];
  const latestText = latest.value !== null
    ? `Zuletzt ${fmtValue(latest.value, latest.unit)} (${periodText(latest)}, ${distance(latest.value, k, latest.unit)})`
    : `Für ${periodText(latest)}: ${latest.note}`;

  let status: AutoStatus;
  let sentence: string;
  if (anyFalse) {
    const f = known.find((r) => r.met === false)!;
    status = "nicht_ausgeloest";
    sentence = `Nicht ausgelöst: „${cond}“ ist in ${periodText(f)} nicht erfüllt (${fmtValue(f.value!, f.unit)}). ${latestText}.`;
  } else if (complete) {
    status = "ausgeloest";
    sentence = `Ausgelöst: „${cond}“ ist in ${k.consecutive === 1 ? "der jüngsten gemeldeten Periode" : `allen ${k.consecutive} aufeinanderfolgenden Perioden bis ${fmtDate(anchor.end)}`} erfüllt. ${latestText}.`;
  } else {
    status = "unzureichende_daten";
    const reasons = [...missing.map((r) => r.note!), ...(gap ? [gap] : [])];
    sentence = `Unzureichende Daten: ${reasons.join(" ")}${known.length ? ` Berechenbar waren ${known.length} von ${k.consecutive} Perioden, alle erfüllen die Bedingung.` : ""}`;
  }
  const staleText = `Die jüngste gemeldete Periode endete am ${fmtDate(anchor.end)} (vor ${ageDays} Tagen, Grenze ${limit.days} Tage); ein neuerer Bericht wäre fällig, liegt in den SEC-Daten aber nicht vor.`;
  if (stale && status !== "unzureichende_daten") {
    sentence = `Veraltete Daten: ${staleText} Stand dieser Daten – ${sentence}`;
    status = "veraltete_daten";
  } else if (stale) {
    sentence = `${sentence} Zudem sind die Daten veraltet: ${staleText}`;
  }
  return out(status, sentence, results);
}

/** Welche Kriterien sind grundsaetzlich automatisch pruefbar (unabhaengig von den Daten)? */
export function supportedCount(criteria: MeasurableCriterion[]): number {
  return criteria.filter((k) => SUPPORTED[k.metric] === null).length;
}

/** "Pruefbar" = Ergebnis ist ausgeloest oder nicht ausgeloest (inkl. veraltet mit Wert). */
export function isDecided(r: CriterionResult): boolean {
  return r.status === "ausgeloest" || r.status === "nicht_ausgeloest";
}
