import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildFinancials, financialMetrics, mergeSeries } from "../lib/finance/fundamentals.ts";
import { buildStockModel, impliedGrowthSentence } from "../lib/finance/stock-model.ts";
import { buildScorecard, MIN_DIMENSIONS_FOR_OVERALL } from "../lib/finance/stock-scorecard.ts";
import { buildSummary } from "../lib/finance/stock-summary.ts";
import { sectorProfile } from "../lib/finance/sectors.ts";
import type { AnnualValue } from "../lib/sources/parsers/sec.ts";

const ends = ["2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"];
const series = (values: (number | null)[], unit = "USD"): AnnualValue[] =>
  values.map((v, i) => (v === null ? null : { end: ends[i], value: v, unit, form: "10-K", filed: `${ends[i].slice(0, 4)}-02-15`, accession: `acc-${i}` }))
    .filter((x): x is AnnualValue => x !== null);

const healthy = () => buildFinancials({
  revenue: series([1000, 1100, 1210, 1331, 1464]),
  operatingIncome: series([200, 220, 250, 280, 310]),
  netIncome: series([150, 165, 185, 210, 230]),
  operatingCashFlow: series([220, 240, 260, 290, 320]),
  capex: series([40, 45, 50, 55, 60]),
  cash: series([300, 320, 350, 380, 400]),
  debtTotal: series([200, 200, 200, 200, 200]),
  equity: series([800, 850, 900, 950, 1000]),
  epsDiluted: series([1.5, 1.65, 1.85, 2.1, 2.3], "USD/shares"),
  dilutedShares: series([100, 100, 100, 100, 100], "shares"),
}, "us-gaap");

describe("Finanzzahlen aus Jahresabschlüssen", () => {
  test("berechnet freien Cashflow, Margen, Eigenkapitalrendite und Nettoliquidität", () => {
    const f = healthy();
    const m = financialMetrics(f);
    assert.equal(f.latest!.freeCashFlow, 260);
    assert.ok(Math.abs(m.revenueCagr! - 0.1) < 0.001);
    assert.ok(Math.abs(m.operatingMargin! - 310 / 1464) < 1e-9);
    assert.ok(Math.abs(m.roe! - 230 / 975) < 1e-9);
    assert.equal(m.netDebt, -200);
    assert.equal(f.coveragePct, 100);
  });
  test("lässt fehlende Größen leer statt sie zu ersetzen", () => {
    const f = buildFinancials({ revenue: series([100, 110]), netIncome: series([10, 11]) }, "us-gaap");
    const m = financialMetrics(f);
    assert.equal(f.latest!.freeCashFlow, null);
    assert.equal(m.netDebt, null);
    assert.ok(f.missing.includes("operatingCashFlow"));
    assert.ok(f.coveragePct < 50);
  });
  test("kennzeichnet unvollständige Schulden", () => {
    const f = buildFinancials({ revenue: series([100]), debtNoncurrent: series([50]) }, "us-gaap");
    assert.equal(f.latest!.debt, 50);
    assert.equal(f.latest!.debtIncomplete, true);
  });
  test("führt Tag-Wechsel zusammen, erste Reihe hat Vorrang", () => {
    const a = series([null, null, 1210, 1331, 1464]);
    const b = series([1000, 1100, 9999, null, null]);
    assert.deepEqual(mergeSeries([a, b]).map((v) => v.value), [1000, 1100, 1210, 1331, 1464]);
  });
  test("erkennt Verwässerung über die Jahre", () => {
    const f = buildFinancials({ revenue: series([100, 110, 120, 130]), dilutedShares: series([100, 103, 106, 109], "shares") }, "us-gaap");
    const m = financialMetrics(f);
    assert.ok(Math.abs(m.shareCountChange! - 0.09) < 0.001);
    assert.equal(m.shareCountYears, 3);
  });
});

describe("Branchenlogik", () => {
  test("ordnet SIC-Codes den passenden Profilen zu", () => {
    assert.equal(sectorProfile("6021").key, "finanzen");
    assert.equal(sectorProfile("6798").key, "immobilien");
    assert.equal(sectorProfile("1311").key, "rohstoffe");
    assert.equal(sectorProfile("4911").key, "versorger");
    assert.equal(sectorProfile("7372").key, "standard");
    assert.equal(sectorProfile(null).key, "standard");
  });
  test("wendet das Cashflow-DCF bei Banken nicht an und begründet das", () => {
    const f = healthy();
    const model = buildStockModel(f, financialMetrics(f), { sic: "6021", sharesOutstanding: null, price: null });
    assert.equal(model.applicable, false);
    assert.match(model.reasons.join(" "), /Schulden Teil des Geschäftsmodells/);
    assert.equal(model.profile.key, "finanzen");
  });
  test("blendet die Bilanz-Dimension bei Finanzunternehmen aus", () => {
    const f = healthy();
    const card = buildScorecard(f, financialMetrics(f), { sic: "6021" });
    const bilanz = card.dimensions.find((d) => d.key === "bilanz")!;
    assert.equal(bilanz.score, null);
    assert.match(bilanz.unavailableReason!, /nicht aussagekräftig/);
  });
});

describe("Modellbewertung", () => {
  test("liefert ein geordnetes Band mit offengelegten Annahmen", () => {
    const f = healthy();
    const model = buildStockModel(f, financialMetrics(f), { sic: "7372", sharesOutstanding: null, price: null });
    assert.equal(model.applicable, true);
    assert.ok(model.band.bear! < model.band.base!);
    assert.ok(model.band.base! < model.band.bull!);
    assert.ok(model.assumptions.length >= 5);
    assert.equal(model.price.verdict, "Datenlage unzureichend");
    assert.equal(model.price.discountToBasePct, null);
  });
  test("berechnet Abschlag und Potenzial getrennt, sobald ein Kurs vorliegt", () => {
    const f = healthy();
    const model = buildStockModel(f, financialMetrics(f), { sic: "7372", sharesOutstanding: null, price: 10 });
    const base = model.band.base!;
    assert.ok(Math.abs(model.price.discountToBasePct! - ((base - 10) / base) * 100) < 1e-9);
    assert.ok(Math.abs(model.price.upsideToBasePct! - ((base - 10) / 10) * 100) < 1e-9);
    assert.notEqual(model.price.discountToBasePct, model.price.upsideToBasePct);
  });
  test("nennt das im Kurs eingepreiste Wachstum und vergleicht es mit der Historie", () => {
    const f = healthy();
    const m = financialMetrics(f);
    const model = buildStockModel(f, m, { sic: "7372", sharesOutstanding: null, price: model0Price(f, m) });
    assert.ok(model.price.impliedGrowth !== null);
    const satz = impliedGrowthSentence(model)!;
    assert.match(satz, /Damit der heutige Kurs aufgeht/);
    assert.match(satz, /historischen Wachstum|entspricht ungefähr/);
  });
  test("wendet das DCF bei negativem freien Cashflow nicht an", () => {
    const f = buildFinancials({ revenue: series([100, 110, 120]), operatingCashFlow: series([5, 5, 5]), capex: series([20, 20, 20]), cash: series([10, 10, 10]), debtTotal: series([0, 0, 0]), dilutedShares: series([10, 10, 10], "shares") }, "us-gaap");
    const model = buildStockModel(f, financialMetrics(f), { sic: "3711", sharesOutstanding: null, price: null });
    assert.equal(model.applicable, false);
    assert.match(model.reasons.join(" "), /nicht positiv/);
  });
});

function model0Price(f: ReturnType<typeof healthy>, m: ReturnType<typeof financialMetrics>): number {
  return buildStockModel(f, m, { sic: "7372", sharesOutstanding: null, price: null }).band.base!;
}

describe("Scorecard", () => {
  test("bildet ohne Kursdaten keinen Gesamtwert", () => {
    const f = healthy();
    const card = buildScorecard(f, financialMetrics(f), { sic: "7372" }, new Date("2026-09-23"));
    const available = card.dimensions.filter((d) => d.score !== null);
    assert.deepEqual(available.map((d) => d.key), ["wachstum", "profitabilitaet", "bilanz"]);
    assert.ok(available.length < MIN_DIMENSIONS_FOR_OVERALL);
    assert.equal(card.overall, null);
    assert.match(card.dimensions.find((d) => d.key === "bewertung")!.unavailableReason!, /Kursdaten/);
    assert.ok(Math.abs(card.dimensions.reduce((s, d) => s + d.weight, 0) - 1) < 1e-9);
  });
  test("bildet mit Kursdaten einen Gesamtwert", () => {
    const f = healthy();
    const card = buildScorecard(f, financialMetrics(f), { sic: "7372", valuationScore: 60, momentum3mPct: 5, volatilityPct: 25, maxDrawdownPct: -18 });
    assert.notEqual(card.overall, null);
    assert.match(card.overallNote, /6 von 7/);
  });
  test("nennt Stabilität statt Risiko und erklärt die Richtung", () => {
    const card = buildScorecard(healthy(), financialMetrics(healthy()), { volatilityPct: 20, maxDrawdownPct: -10 });
    const s = card.dimensions.find((d) => d.key === "stabilitaet")!;
    assert.equal(s.label, "Stabilität");
    assert.match(s.direction, /hohe Zahl ist gut/);
  });
  test("zeigt Warnsignale unabhängig vom Gesamtwert, inklusive Verwässerung", () => {
    const f = buildFinancials({
      revenue: series([100, 90]), equity: series([-10, -20]), netIncome: series([5, 4]),
      operatingCashFlow: series([5, 2]), capex: series([3, 6]), dilutedShares: series([100, 110], "shares"),
    }, "us-gaap");
    const card = buildScorecard(f, financialMetrics(f));
    const text = card.redFlags.join(" ");
    assert.match(text, /Negatives Eigenkapital/);
    assert.match(text, /Umsatzrückgang/);
    assert.match(text, /Negativer freier Cashflow/);
    assert.match(text, /Verwässerung/);
  });
  test("übersetzt Kennzahlen in Alltagssprache", () => {
    const card = buildScorecard(healthy(), financialMetrics(healthy()));
    const bilanz = card.dimensions.find((d) => d.key === "bilanz")!;
    assert.match(bilanz.metrics[0].plain!, /mehr Zahlungsmittel als Finanzschulden/);
  });
});

describe("Kurzfazit", () => {
  test("stellt höchstens drei Argumente je Seite mit Quelle und Zeitraum gegenüber", () => {
    const f = healthy();
    const m = financialMetrics(f);
    const s = buildSummary("Test AG", f, m, buildScorecard(f, m), buildStockModel(f, m, { sic: "7372", sharesOutstanding: null, price: null }));
    assert.ok(s.bull.length <= 3 && s.bull.length > 0);
    assert.ok(s.bull.every((a) => a.source.includes("SEC") && a.period.length > 0));
    assert.equal(s.headline, "Datenlage unzureichend");
  });
  test("füllt fehlende Gegenargumente nicht künstlich auf", () => {
    const f = healthy();
    const m = financialMetrics(f);
    const s = buildSummary("Test AG", f, m, buildScorecard(f, m), buildStockModel(f, m, { sic: "7372", sharesOutstanding: null, price: null }));
    assert.equal(s.bear.length, 0);
  });
  test("findet Gegenargumente, wenn die Zahlen sie hergeben", () => {
    const f = buildFinancials({
      revenue: series([100, 90]), operatingIncome: series([2, 1]), netIncome: series([1, 0.5]),
      operatingCashFlow: series([5, 2]), capex: series([3, 6]), cash: series([5, 5]), debtTotal: series([50, 50]),
      equity: series([20, 18]), dilutedShares: series([100, 110], "shares"),
    }, "us-gaap");
    const m = financialMetrics(f);
    const s = buildSummary("Schwach AG", f, m, buildScorecard(f, m), buildStockModel(f, m, { sic: "3711", sharesOutstanding: null, price: null }));
    assert.equal(s.bear.length, 3);
    assert.match(s.bear.map((b) => b.text).join(" "), /Umsatz ging zuletzt/);
  });
});
