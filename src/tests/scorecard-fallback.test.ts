import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildFinancials, financialMetrics } from "../lib/finance/fundamentals.ts";
import { buildScorecard } from "../lib/finance/stock-scorecard.ts";
import type { AnnualValue } from "../lib/sources/parsers/sec.ts";

/** Erfundene Jahreszahlen (Mio. USD) - keine echten Unternehmen. */
const ends = ["2023-12-31", "2024-12-31", "2025-12-31"];
const series = (values: (number | null)[], unit = "USD"): AnnualValue[] =>
  values.map((v, i) => (v === null ? null : { end: ends[i], value: v, unit, form: "10-K", filed: `${ends[i].slice(0, 4)}-02-15`, accession: `acc-${i}` }))
    .filter((x): x is AnnualValue => x !== null);

const dim = (card: ReturnType<typeof buildScorecard>, key: string) => card.dimensions.find((d) => d.key === key)!;

describe("Scorecard-Ersatzkennzahlen", () => {
  test("negatives Eigenkapital: Kapitalrendite (ROIC) statt Eigenkapitalrendite", () => {
    const f = buildFinancials({
      revenue: series([1000, 1100, 1200]), operatingIncome: series([250, 280, 300]), netIncome: series([180, 200, 220]),
      operatingCashFlow: series([260, 290, 310]), capex: series([40, 40, 50]), cash: series([100, 100, 100]),
      debtTotal: series([1500, 1500, 1500]), equity: series([-200, -250, -300]), dilutedShares: series([100, 100, 100], "shares"),
    }, "us-gaap");
    const m = financialMetrics(f);
    assert.equal(m.roe, null);
    assert.equal(Math.round(m.roic! * 1000) / 1000, 0.25, "300 ÷ (1500 − 300)");
    const p = dim(buildScorecard(f, m, { sic: "7372" }), "profitabilitaet");
    assert.notEqual(p.score, null);
    assert.ok(p.metrics.some((x) => /ROIC/.test(x.label)));
  });

  test("negatives eingesetztes Kapital: kein ROIC, nichts erfunden", () => {
    const f = buildFinancials({
      revenue: series([100, 100, 100]), operatingIncome: series([10, 10, 10]), debtTotal: series([50, 50, 50]), equity: series([-80, -80, -80]),
    }, "us-gaap");
    assert.equal(financialMetrics(f).roic, null);
  });

  test("Bank: Profitabilität aus ROE/ROA, Bilanz aus Eigenkapitalquote (keine leere Bilanz-Dimension)", () => {
    const f = buildFinancials({
      revenue: series([150, 160, 170]), netIncome: series([40, 45, 50]),
      equity: series([280, 300, 320]), assets: series([3800, 3900, 4000]), dilutedShares: series([3, 3, 3], "shares"),
    }, "us-gaap");
    const m = financialMetrics(f);
    assert.equal(m.equityRatio, 0.08);
    const card = buildScorecard(f, m, { sic: "6021" });
    assert.equal(dim(card, "bilanz").score, 50, "8 % zwischen 4 % und 12 %");
    assert.equal(dim(card, "bilanz").unavailableReason, undefined);
    assert.notEqual(dim(card, "profitabilitaet").score, null);
    assert.ok(card.fundamental, "Fundamental-Score auch ohne Kurse");
  });

  test("ohne Live-Kurse: kein Gesamtwert, aber Fundamental-Score aus SEC-Jahreszahlen", () => {
    const f = buildFinancials({
      revenue: series([1000, 1100, 1200]), operatingIncome: series([200, 220, 240]), netIncome: series([150, 160, 170]),
      operatingCashFlow: series([220, 240, 260]), capex: series([40, 40, 40]), cash: series([300, 300, 300]),
      debtTotal: series([100, 100, 100]), equity: series([800, 850, 900]), epsDiluted: series([1.5, 1.6, 1.7], "USD/shares"),
      dilutedShares: series([100, 100, 100], "shares"),
    }, "us-gaap");
    const card = buildScorecard(f, financialMetrics(f), { sic: "7372" });
    assert.equal(card.overall, null, "Bewertung, Momentum und Stabilität brauchen Kurse");
    assert.deepEqual(card.fundamental?.dimensions, ["wachstum", "profitabilitaet", "bilanz"]);
    assert.ok(card.fundamental!.score >= 0 && card.fundamental!.score <= 100);
  });

  test("zu wenige Jahreszahlen: auch kein Fundamental-Score", () => {
    const f = buildFinancials({ revenue: series([null, null, 100]) }, "us-gaap");
    assert.equal(buildScorecard(f, financialMetrics(f), { sic: "7372" }).fundamental, null);
  });
});
