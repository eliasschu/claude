/**
 * Automatische Kriterienpruefung mit ERFUNDENEN SEC-Daten (Beispiel AG, CIK 999999). Keine Live-Ergebnisse.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanyFacts, isConsecutive, type CompanyFactsJson, type RawFact } from "../lib/finance/sec-facts.ts";
import { evaluateCriterion, STALE_DAYS } from "../lib/thesis/criteria-eval.ts";
import { buildRun } from "../lib/thesis/auto-check.ts";
import {
  addAutoCheck, addReview, createThesis, current, exportJson, latestAutoResults, parseImport, planImport, saveVersion,
  type MeasurableCriterion, type ThesisContent,
} from "../lib/thesis/model.ts";

let n = 0;
const f = (start: string, end: string, val: number, filed: string, form = "10-Q"): RawFact =>
  ({ start, end, val, filed, form, accn: `0000999999-26-${String(++n).padStart(6, "0")}` });

type Facts = Record<string, RawFact[]>;
function company(gaap: Facts, units = "USD", ifrs: Facts = {}): CompanyFactsJson {
  const wrap = (x: Facts) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { units: { [units]: v } }]));
  return { cik: 999999, entityName: "Beispiel AG (fiktiv)", facts: { "us-gaap": wrap(gaap), "ifrs-full": wrap(ifrs) } };
}

const REV = "RevenueFromContractWithCustomerExcludingAssessedTax";
const OI = "OperatingIncomeLoss";
const OCF = "NetCashProvidedByUsedInOperatingActivities";
const CAPEX = "PaymentsToAcquirePropertyPlantAndEquipment";

// Kalenderjahr 2025 + Q1/Q2 2026; Umsatz und Ergebnis als Einzelquartale
const Q = [
  ["2025-01-01", "2025-03-31", "2025-05-01"], ["2025-04-01", "2025-06-30", "2025-08-01"], ["2025-07-01", "2025-09-30", "2025-11-01"],
  ["2025-10-01", "2025-12-31", "2026-02-10"], ["2026-01-01", "2026-03-31", "2026-05-01"], ["2026-04-01", "2026-06-30", "2026-08-01"],
] as const;
const quarters = (vals: number[]) => vals.map((v, i) => f(Q[i][0], Q[i][1], v, Q[i][2], i === 3 ? "10-K" : "10-Q"));
const TODAY = "2026-09-28";

const k = (over: Partial<MeasurableCriterion>): MeasurableCriterion =>
  ({ id: "k1", metric: "operating_margin", operator: "<", threshold: 20, period: "quartal", consecutive: 2, ...over });

describe("Normalisierung", () => {
  test("gleicher Zeitraum mehrfach gemeldet: zuletzt eingereichter Wert gilt, frühere bleiben als Anpassung sichtbar", () => {
    const facts = normalizeCompanyFacts(company({ [REV]: [f("2026-04-01", "2026-06-30", 100, "2026-08-01"), f("2026-04-01", "2026-06-30", 95, "2026-11-01", "10-Q/A")] }));
    const q = facts.series.revenue.quarters;
    assert.equal(q.length, 1);
    assert.equal(q[0].value, 95);
    assert.equal(q[0].source.form, "10-Q/A");
    assert.deepEqual(q[0].revisions.map((r) => r.value), [100]);
  });

  test("kumulierte Cashflows: Einzelquartale nur aus Werten mit gleichem Beginn, Rechenweg vermerkt", () => {
    const facts = normalizeCompanyFacts(company({ [OCF]: [
      f("2025-01-01", "2025-03-31", 10, "2025-05-01"), f("2025-01-01", "2025-06-30", 25, "2025-08-01"),
      f("2025-01-01", "2025-09-30", 45, "2025-11-01"), f("2025-01-01", "2025-12-31", 70, "2026-02-10", "10-K"),
    ] }));
    const q = facts.series.operatingCashFlow.quarters;
    assert.deepEqual(q.map((x) => [x.start, x.end, x.value]), [
      ["2025-01-01", "2025-03-31", 10], ["2025-07-01", "2025-09-30", 20], ["2025-04-01", "2025-06-30", 15], ["2025-10-01", "2025-12-31", 25],
    ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
    const q4 = q.find((x) => x.end === "2025-12-31")!;
    assert.match(q4.derived!.formula, /01\.01\.2025–31\.12\.2025 minus 01\.01\.2025–30\.09\.2025/);
    assert.equal(facts.series.operatingCashFlow.years.length, 1, "Geschäftsjahr bleibt getrennt");
  });

  test("kein Ableiten aus Werten mit unterschiedlichem Beginn; direkt gemeldete Quartale haben Vorrang", () => {
    const facts = normalizeCompanyFacts(company({ [OCF]: [
      f("2025-01-01", "2025-03-31", 10, "2025-05-01"), f("2025-02-01", "2025-06-30", 25, "2025-08-01"),
      f("2025-01-01", "2025-09-30", 45, "2025-11-01"), f("2025-07-01", "2025-09-30", 19, "2025-11-01"),
    ] }));
    const q = facts.series.operatingCashFlow.quarters;
    assert.equal(q.find((x) => x.end === "2025-06-30"), undefined, "5-Monats-Zeitraum wird nicht verwendet");
    assert.equal(q.find((x) => x.end === "2025-09-30")!.value, 19);
  });

  test("Nicht-Währungseinheiten werden nicht verwendet und benannt", () => {
    const facts = normalizeCompanyFacts(company({ [REV]: quarters([1, 2]) }, "USD/shares"));
    assert.equal(facts.series.revenue.quarters.length, 0);
    const r = evaluateCriterion(k({ metric: "revenue", operator: "<", threshold: 1, consecutive: 1 }), facts, TODAY);
    assert.equal(r.status, "unzureichende_daten");
    assert.match(r.sentence, /USD\/shares/);
  });

  test("Aufeinanderfolge: Folgetag bis 7 Tage Abstand (52/53-Wochen-Jahre), keine Überlappung", () => {
    assert.ok(isConsecutive({ end: "2025-03-31" }, { start: "2025-04-01" }));
    assert.ok(isConsecutive({ end: "2025-03-29" }, { start: "2025-04-05" }));
    assert.ok(!isConsecutive({ end: "2025-03-31" }, { start: "2025-03-31" }));
    assert.ok(!isConsecutive({ end: "2025-03-31" }, { start: "2025-07-01" }));
  });
});

const marginFacts = (rev: number[], oi: number[]) => normalizeCompanyFacts(company({ [REV]: quarters(rev), [OI]: quarters(oi) }));

describe("Operative Marge", () => {
  test("ausgelöst nur, wenn alle geforderten aufeinanderfolgenden Quartale die Bedingung erfüllen", () => {
    const facts = marginFacts([100, 100, 100, 100, 100, 100], [30, 30, 30, 30, 15, 18]);
    const r = evaluateCriterion(k({}), facts, "2026-08-15");
    assert.equal(r.status, "ausgeloest");
    assert.deepEqual(r.periods.map((p) => [p.end, p.value]), [["2026-06-30", 18], ["2026-03-31", 15]]);
    assert.match(r.sentence, /Prozentpunkte/);
    assert.equal(r.periods[0].inputs.length, 2);
    assert.equal(r.periods[0].inputs[0].concept, `us-gaap:${REV}`);
    assert.match(r.periods[0].inputs[0].url, /edgar\/data\/999999\/0000999999/);
  });

  test("eine erfüllte, eine nicht erfüllte Periode: nicht ausgelöst", () => {
    const r = evaluateCriterion(k({}), marginFacts([100, 100, 100, 100, 100, 100], [30, 30, 30, 30, 25, 18]), "2026-08-15");
    assert.equal(r.status, "nicht_ausgeloest");
    assert.match(r.sentence, /01\.01\.2026–31\.03\.2026 nicht erfüllt/);
  });

  test("Grenzwerte: genau 20 % ist nicht „unter 20“, aber „höchstens 20“", () => {
    const facts = marginFacts([100, 100, 100, 100, 100, 100], [20, 20, 20, 20, 20, 20]);
    assert.equal(evaluateCriterion(k({ consecutive: 1 }), facts, "2026-08-15").status, "nicht_ausgeloest");
    assert.equal(evaluateCriterion(k({ operator: "<=", consecutive: 1 }), facts, "2026-08-15").status, "ausgeloest");
    assert.equal(evaluateCriterion(k({ operator: ">=", consecutive: 1 }), facts, "2026-08-15").status, "ausgeloest");
    assert.equal(evaluateCriterion(k({ operator: ">", consecutive: 1 }), facts, "2026-08-15").status, "nicht_ausgeloest");
  });

  test("fehlendes Quartal wird nie übersprungen", () => {
    const rev = quarters([100, 100, 100, 100, 100, 100]).filter((_, i) => i !== 4);
    const oi = quarters([10, 10, 10, 10, 10, 10]).filter((_, i) => i !== 4);
    const r = evaluateCriterion(k({}), normalizeCompanyFacts(company({ [REV]: rev, [OI]: oi })), "2026-08-15");
    assert.equal(r.status, "unzureichende_daten");
    assert.match(r.sentence, /Periode vor 01\.04\.2026–30\.06\.2026 fehlt/);
    assert.equal(r.periods.length, 1, "nicht auf Q4 2025 ausgewichen");
  });

  test("fehlendes operatives Ergebnis in der jüngsten Periode: unzureichend, nicht null", () => {
    const facts = normalizeCompanyFacts(company({ [REV]: quarters([100, 100, 100, 100, 100, 100]), [OI]: quarters([10, 10, 10, 10, 10]) }));
    const r = evaluateCriterion(k({ consecutive: 1 }), facts, "2026-08-15");
    assert.equal(r.status, "unzureichende_daten");
    assert.equal(r.periods[0].value, null);
    assert.match(r.sentence, /Operatives Ergebnis für 01\.04\.2026–30\.06\.2026 ist in den SEC-Daten nicht gemeldet/);
  });

  test("Umsatz null: keine Marge", () => {
    const r = evaluateCriterion(k({ consecutive: 1 }), marginFacts([100, 100, 100, 100, 100, 0], [1, 1, 1, 1, 1, -5]), "2026-08-15");
    assert.equal(r.status, "unzureichende_daten");
    assert.match(r.sentence, /keine Marge/);
  });

  test("veraltet richtet sich nach dem Periodenende, nicht nach dem Abruf", () => {
    const facts = marginFacts([100, 100, 100, 100, 100, 100], [10, 10, 10, 10, 10, 10]);
    assert.equal(evaluateCriterion(k({}), facts, "2026-11-17").status, "ausgeloest", `${STALE_DAYS.quartal} Tage nach Quartalsende noch aktuell`);
    const r = evaluateCriterion(k({}), facts, "2026-11-18");
    assert.equal(r.status, "veraltete_daten");
    assert.match(r.sentence, /30\.06\.2026 \(vor 141 Tagen, Grenze 140 Tage\).*Ausgelöst/);
  });

  test("Veraltet-Grenze berücksichtigt den Jahresbericht: letztes Quartal vor Geschäftsjahresende 190 Tage", () => {
    // Q3 2025 endet 30.09.2025, Geschäftsjahr endet 31.12. (Jahreswert 2024 bekannt) - Q4 kommt erst mit dem 10-K
    const rev = [...quarters([100, 100, 100]), f("2024-01-01", "2024-12-31", 400, "2025-02-10", "10-K")];
    const oi = [...quarters([10, 10, 10]), f("2024-01-01", "2024-12-31", 40, "2025-02-10", "10-K")];
    const facts = normalizeCompanyFacts(company({ [REV]: rev, [OI]: oi }));
    assert.equal(evaluateCriterion(k({}), facts, "2026-03-15").status, "ausgeloest", "166 Tage nach Q3: 10-K darf noch ausstehen");
    const r = evaluateCriterion(k({}), facts, "2026-04-09");
    assert.equal(r.status, "veraltete_daten");
    assert.match(r.sentence, /Grenze 190 Tage/);
    // Ohne bekanntes Geschäftsjahresende gilt die strengere Grenze
    assert.equal(evaluateCriterion(k({}), marginFacts([100, 100, 100], [10, 10, 10]), "2026-03-15").status, "veraltete_daten");
  });

  test("Jahreswerte: 10-K 455 Tage, 20-F 495 Tage", () => {
    const mk = (form: string) => normalizeCompanyFacts(company({
      [REV]: [f("2024-01-01", "2024-12-31", 400, "2025-04-20", form)], [OI]: [f("2024-01-01", "2024-12-31", 40, "2025-04-20", form)],
    }));
    const kj = k({ period: "jahr", consecutive: 1 });
    assert.equal(evaluateCriterion(kj, mk("10-K"), "2026-04-15").status, "veraltete_daten");
    assert.equal(evaluateCriterion(kj, mk("20-F"), "2026-04-15").status, "ausgeloest");
    assert.equal(evaluateCriterion(kj, mk("20-F"), "2026-05-15").status, "veraltete_daten");
  });

  test("ein frischer Abruf macht alte Zahlen nicht frisch", () => {
    const facts = marginFacts([100, 100, 100, 100, 100], [10, 10, 10, 10, 10]);
    const t = createThesis({ ticker: "BSPL", companyName: "Beispiel AG", stance: "besitzen", reason: "Test", expectations: "", counterArguments: "",
      changeMyMind: "", horizonMonths: null, nextReviewDate: null, criteria: [k({})], checkpoints: [] }, "2026-09-01T00:00:00.000Z", "t");
    const run = buildRun(t, { ok: true, ticker: "BSPL", facts, fetchedAt: "2026-09-28T08:00:00.000Z", stale: false, staleReason: null, sourceUrl: null },
      "2026-09-28T08:00:01.000Z", "2026-09-28", "r");
    assert.equal(run.results[0].status, "veraltete_daten", "Q1 2026 endete vor 180 Tagen - Abrufzeit spielt keine Rolle");
  });

  test("Quartals- und Jahreswerte werden nie gemischt", () => {
    const facts = normalizeCompanyFacts(company({
      [REV]: [f("2024-01-01", "2024-12-31", 400, "2025-02-10", "10-K"), f("2025-01-01", "2025-12-31", 400, "2026-02-10", "10-K")],
      [OI]: [f("2024-01-01", "2024-12-31", 40, "2025-02-10", "10-K"), f("2025-01-01", "2025-12-31", 40, "2026-02-10", "10-K")],
    }));
    const quarterly = evaluateCriterion(k({ consecutive: 1 }), facts, "2026-03-01");
    assert.equal(quarterly.status, "unzureichende_daten");
    const yearly = evaluateCriterion(k({ period: "jahr" }), facts, "2026-03-01");
    assert.equal(yearly.status, "ausgeloest");
    assert.deepEqual(yearly.periods.map((p) => p.end), ["2025-12-31", "2024-12-31"]);
  });

  test("abweichendes Geschäftsjahr (52/53 Wochen, Ende September)", () => {
    const facts = normalizeCompanyFacts(company({
      [REV]: [f("2024-09-29", "2024-12-28", 100, "2025-01-31"), f("2024-12-29", "2025-03-29", 100, "2025-05-02")],
      [OI]: [f("2024-09-29", "2024-12-28", 30, "2025-01-31"), f("2024-09-29", "2025-03-29", 45, "2025-05-02")],
    }));
    const r = evaluateCriterion(k({}), facts, "2025-05-10");
    assert.equal(r.status, "nicht_ausgeloest");
    assert.deepEqual(r.periods.map((p) => [p.end, p.value]), [["2025-03-29", 15], ["2024-12-28", 30]]);
    assert.ok(r.periods[0].inputs.find((e) => e.derivation), "Q2-Ergebnis aus 6M − 3M abgeleitet");
  });
});

describe("Umsatzwachstum ggü. Vorjahresperiode", () => {
  test("relative Veränderung in %, gleiche Periode des Vorjahres", () => {
    const facts = normalizeCompanyFacts(company({ [REV]: [...quarters([100, 100, 100, 100, 100, 88]), f("2024-04-01", "2024-06-30", 90, "2024-08-01")] }));
    const r = evaluateCriterion(k({ metric: "revenue_growth_yoy", operator: "<", threshold: 0, consecutive: 2 }), facts, "2026-08-15");
    assert.equal(r.status, "nicht_ausgeloest", "Q1 2026: 100 vs. 100 = 0 %, nicht < 0");
    assert.equal(Math.round(r.periods[0].value! * 100) / 100, -12);
    assert.equal(r.periods[0].inputs.length, 2);
    const r2 = evaluateCriterion(k({ metric: "revenue_growth_yoy", operator: "<", threshold: 0, consecutive: 1 }), facts, "2026-08-15");
    assert.equal(r2.status, "ausgeloest");
    assert.match(r2.sentence, /-12,0 %.*−12,0 Prozentpunkte zur Schwelle/);
  });

  test("Basis null oder negativ: keine Wachstumsrate", () => {
    const facts = normalizeCompanyFacts(company({ [REV]: [f("2025-04-01", "2025-06-30", 0, "2025-08-01"), f("2026-04-01", "2026-06-30", 50, "2026-08-01")] }));
    const r = evaluateCriterion(k({ metric: "revenue_growth_yoy", operator: ">", threshold: 10, consecutive: 1 }), facts, "2026-08-15");
    assert.equal(r.status, "unzureichende_daten");
    assert.match(r.sentence, /keine Wachstumsrate/);
  });

  test("Vorjahr mit anderem SEC-Konzept: nicht vergleichbar", () => {
    const facts = normalizeCompanyFacts(company({ [REV]: [f("2026-04-01", "2026-06-30", 50, "2026-08-01")], Revenues: [f("2025-04-01", "2025-06-30", 40, "2025-08-01")] }));
    const r = evaluateCriterion(k({ metric: "revenue_growth_yoy", operator: ">", threshold: 10, consecutive: 1 }), facts, "2026-08-15");
    assert.equal(r.status, "unzureichende_daten");
    assert.match(r.sentence, /anderes SEC-Konzept/);
  });

  test("korrigierter Vorjahreswert wird verwendet", () => {
    const facts = normalizeCompanyFacts(company({ [REV]: [
      f("2025-04-01", "2025-06-30", 100, "2025-08-01"), f("2025-04-01", "2025-06-30", 80, "2026-08-01"), f("2026-04-01", "2026-06-30", 100, "2026-08-01"),
    ] }));
    const r = evaluateCriterion(k({ metric: "revenue_growth_yoy", operator: ">", threshold: 20, consecutive: 1 }), facts, "2026-08-15");
    assert.equal(r.status, "ausgeloest");
    assert.equal(r.periods[0].value, 25);
    assert.deepEqual(r.periods[0].inputs[1].revisedFrom?.map((x) => x.value), [100]);
  });
});

describe("Freier Cashflow", () => {
  const cf = (capex = true) => normalizeCompanyFacts(company({
    [REV]: quarters([100, 100, 100, 100]),
    [OCF]: [f("2025-01-01", "2025-03-31", 10, "2025-05-01"), f("2025-01-01", "2025-06-30", 25, "2025-08-01"),
      f("2025-01-01", "2025-09-30", 45, "2025-11-01"), f("2025-01-01", "2025-12-31", 70, "2026-02-10", "10-K")],
    ...(capex ? { [CAPEX]: [f("2025-01-01", "2025-03-31", 4, "2025-05-01"), f("2025-01-01", "2025-06-30", 9, "2025-08-01"),
      f("2025-01-01", "2025-09-30", 15, "2025-11-01"), f("2025-01-01", "2025-12-31", 30, "2026-02-10", "10-K")] } : {}),
  }));

  test("FCF = OCF − Capex je Einzelquartal (aus kumulierten Werten)", () => {
    const r = evaluateCriterion(k({ metric: "free_cash_flow", operator: "<", threshold: 0.0000125, consecutive: 2 }), cf(), "2026-03-01");
    assert.deepEqual(r.periods.map((p) => [p.end, Math.round(p.value! * 1e6)]), [["2025-12-31", 10], ["2025-09-30", 14]]);
    assert.equal(r.status, "nicht_ausgeloest");
    assert.ok(r.periods[0].inputs.every((e) => e.derivation));
    const m = evaluateCriterion(k({ metric: "fcf_margin", operator: "<", threshold: 15, consecutive: 2 }), cf(), "2026-03-01");
    assert.deepEqual(m.periods.map((p) => Math.round(p.value! * 1e6) / 1e6), [10, 14]);
    assert.equal(m.status, "ausgeloest");
  });

  test("fehlende Investitionen: kein FCF, nicht als 0 gerechnet", () => {
    const r = evaluateCriterion(k({ metric: "free_cash_flow", operator: "<", threshold: 1000, consecutive: 1 }), cf(false), "2026-03-01");
    assert.equal(r.status, "unzureichende_daten");
    assert.match(r.sentence, /Investitionen in Sachanlagen/);
  });
});

test("Nettoverschuldung ÷ OCF: nicht unterstützt", () => {
  const r = evaluateCriterion(k({ metric: "net_debt_to_ocf", operator: ">", threshold: 3 }), marginFacts([1], [1]), TODAY);
  assert.equal(r.status, "nicht_unterstuetzt");
});

describe("Speicherung und Quellenausfall", () => {
  const content: ThesisContent = {
    ticker: "BSPL", companyName: "Beispiel AG", stance: "besitzen", reason: "Test", expectations: "", counterArguments: "", changeMyMind: "",
    horizonMonths: null, nextReviewDate: "2026-12-01", criteria: [k({}), k({ id: "k2", metric: "net_debt_to_ocf", operator: ">", threshold: 3 })], checkpoints: [],
  };
  const facts = marginFacts([100, 100, 100, 100, 100, 100], [30, 30, 30, 30, 15, 18]);
  const ok = { ok: true as const, ticker: "BSPL", facts, fetchedAt: "2026-09-28T08:00:00.000Z", stale: false, staleReason: null, sourceUrl: "https://data.sec.gov/…" };

  test("Prüflauf ändert weder Versionen noch manuelle Prüfungen oder Prüftermin", () => {
    let t = createThesis(content, "2026-09-01T00:00:00.000Z", "t1");
    t = addReview(t, { id: "r1", at: "", outcome: "beibehalten", note: "ok", assessments: [], nextReviewDate: "2026-11-01" }, "2026-09-10T00:00:00.000Z");
    const before = JSON.stringify({ v: t.versions, r: t.reviews });
    const t2 = addAutoCheck(t, buildRun(t, ok, "2026-09-28T09:00:00.000Z", "2026-08-15", "run1"));
    assert.equal(JSON.stringify({ v: t2.versions, r: t2.reviews }), before);
    assert.equal(t2.autoChecks!.length, 1);
    const res = latestAutoResults(t2);
    assert.equal(res.get("k1")!.result.status, "ausgeloest");
    assert.equal(res.get("k2")!.result.status, "nicht_unterstuetzt");
  });

  test("Abruffehler wird als eigener Lauf gespeichert; das frühere Ergebnis bleibt mit Alter sichtbar", () => {
    let t = createThesis(content, "2026-09-01T00:00:00.000Z", "t1");
    t = addAutoCheck(t, buildRun(t, ok, "2026-09-20T09:00:00.000Z", "2026-08-15", "run1"));
    t = addAutoCheck(t, buildRun(t, { ok: false, message: "Quelle antwortete mit 503" }, "2026-09-28T09:00:00.000Z", "2026-09-28", "run2"));
    const e = latestAutoResults(t).get("k1")!;
    assert.equal(e.run.id, "run1");
    assert.equal(e.failedAfter?.id, "run2");
    assert.equal(t.autoChecks![1].fetch.ok, false);
    assert.equal(t.autoChecks![1].results.length, 0, "Ausfall erzeugt keine Ergebnisse");
  });

  test("an Version gebunden; alte Ergebnisse bleiben nach Änderung erhalten", () => {
    let t = createThesis(content, "2026-09-01T00:00:00.000Z", "t1");
    const run = buildRun(t, ok, "2026-09-20T09:00:00.000Z", "2026-08-15", "run1");
    t = addAutoCheck(t, run);
    t = saveVersion(t, { ...content, criteria: [k({ threshold: 16 }), content.criteria[1]] }, "Schwelle angepasst", "2026-09-21T00:00:00.000Z");
    assert.throws(() => addAutoCheck(t, run), /inzwischen geändert/);
    const e = latestAutoResults(t).get("k1")!;
    assert.ok(e.olderVersion && e.criterionChanged);
    assert.equal(e.result.criterion.threshold, 20);
    t = addAutoCheck(t, buildRun(t, ok, "2026-09-22T09:00:00.000Z", "2026-08-15", "run2"));
    assert.equal(t.autoChecks!.length, 2);
    assert.equal(latestAutoResults(t).get("k1")!.result.status, "nicht_ausgeloest");
  });

  test("Export/Import behält Prüfläufe; zusätzlicher Lauf gilt als „erweitert“", () => {
    const t = createThesis(content, "2026-09-01T00:00:00.000Z", "t1");
    const t2 = addAutoCheck(t, buildRun(t, ok, "2026-09-20T09:00:00.000Z", "2026-08-15", "run1"));
    const parsed = parseImport(exportJson({ formatVersion: 1, theses: [t2] }, "2026-09-28T00:00:00.000Z"));
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.equal(parsed.theses[0].autoChecks!.length, 1);
    assert.equal(planImport({ formatVersion: 1, theses: [t] }, parsed.theses)[0].kind, "erweitert");
    const bad = JSON.parse(exportJson({ formatVersion: 1, theses: [t2] }, "x"));
    bad.theses[0].autoChecks[0].thesisVersion = 9;
    assert.equal(parseImport(JSON.stringify(bad)).ok, false);
    assert.equal(current(parsed.theses[0]).version, 1);
  });
});
