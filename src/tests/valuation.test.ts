import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  cagr, classifyAgainstBand, discountedCashFlow, discountToModelPct, growthPath, impliedGrowth,
  scoreFromRange, sensitivityGrid, upsideToModelPct, type DcfInputs,
} from "../lib/finance/valuation.ts";
import { formatBp, formatCompact, formatPercent, formatPp, formatPrice, formatShare } from "../lib/finance/format.ts";

const base: DcfInputs = { freeCashFlow: 100, shares: 10, netDebt: 0, growth: 0, terminalGrowth: 0, discountRate: 0.1, years: 5, fade: false };

describe("Abschlag und Potenzial sind verschiedene Größen", () => {
  test("Beispiel aus dem Auftrag: Kurs 512,70, Modellwert 602,94", () => {
    assert.ok(Math.abs(discountToModelPct(602.94, 512.7)! - 14.966) < 0.01);
    assert.ok(Math.abs(upsideToModelPct(602.94, 512.7)! - 17.601) < 0.01);
  });
  test("Kurs über Modellwert ergibt negative Werte", () => {
    assert.equal(discountToModelPct(100, 125), -25);
    assert.equal(upsideToModelPct(100, 125), -20);
  });
  test("ohne gültige Werte kein Ergebnis", () => {
    assert.equal(discountToModelPct(0, 10), null);
    assert.equal(upsideToModelPct(10, 0), null);
  });
});

describe("DCF", () => {
  test("entspricht bei null Wachstum der ewigen Rente FCF ÷ r", () => {
    const r = discountedCashFlow(base)!;
    assert.ok(Math.abs(r.enterpriseValue - 1000) < 1e-6);
    assert.ok(Math.abs(r.perShare - 100) < 1e-6);
  });
  test("zieht Nettoverschuldung ab und addiert Nettoliquidität", () => {
    assert.ok(Math.abs(discountedCashFlow({ ...base, netDebt: 200 })!.perShare - 80) < 1e-6);
    assert.ok(Math.abs(discountedCashFlow({ ...base, netDebt: -200 })!.perShare - 120) < 1e-6);
  });
  test("rechnet ein Jahr mit Endwert exakt nach", () => {
    const r = discountedCashFlow({ ...base, years: 1, growth: 0.1, terminalGrowth: 0.02 })!;
    const erwartet = 110 / 1.1 + (110 * 1.02) / 0.08 / 1.1;
    assert.ok(Math.abs(r.enterpriseValue - erwartet) < 1e-6);
  });
  test("Wachstumsabbau ist konservativer als konstantes Wachstum", () => {
    const konstant = discountedCashFlow({ ...base, years: 10, growth: 0.15, terminalGrowth: 0.025, discountRate: 0.09 })!;
    const abbau = discountedCashFlow({ ...base, years: 10, growth: 0.15, terminalGrowth: 0.025, discountRate: 0.09, fade: true })!;
    assert.ok(abbau.perShare < konstant.perShare);
    assert.ok(Math.abs(abbau.growthPath[0] - 0.15) < 1e-9);
    assert.ok(Math.abs(abbau.growthPath[9] - 0.025) < 1e-9);
  });
  test("ist nicht definiert bei negativem Cashflow, r ≤ g oder negativem Eigenkapital", () => {
    assert.equal(discountedCashFlow({ ...base, freeCashFlow: -1 }), null);
    assert.equal(discountedCashFlow({ ...base, terminalGrowth: 0.1 }), null);
    assert.equal(discountedCashFlow({ ...base, netDebt: 5000 }), null);
  });
  test("höherer Diskontsatz senkt den Wert", () => {
    const cells = sensitivityGrid({ ...base, terminalGrowth: 0.02 }, [0.05], [0.08, 0.12]);
    assert.ok(cells[0].perShare! > cells[1].perShare!);
  });
  test("ohne Abbau bleibt der Wachstumspfad konstant", () => {
    assert.deepEqual(growthPath(0.1, 0.02, 3, false), [0.1, 0.1, 0.1]);
  });
});

describe("Eingepreistes Wachstum (Reverse-DCF)", () => {
  const inputs = { freeCashFlow: 100, shares: 10, netDebt: 0, terminalGrowth: 0.025, discountRate: 0.09, years: 10, fade: true };
  test("findet das Wachstum, das genau den Kurs ergibt", () => {
    const ziel = discountedCashFlow({ ...inputs, growth: 0.12 })!.perShare;
    const g = impliedGrowth(inputs, ziel)!;
    assert.ok(Math.abs(g - 0.12) < 0.001, `erwartet 12 %, erhalten ${(g * 100).toFixed(2)} %`);
  });
  test("höherer Kurs setzt höheres Wachstum voraus", () => {
    const a = impliedGrowth(inputs, 150)!;
    const b = impliedGrowth(inputs, 250)!;
    assert.ok(b > a);
  });
  test("liefert null, wenn der Kurs außerhalb des durchsuchten Bereichs liegt", () => {
    assert.equal(impliedGrowth(inputs, 5), null);
    assert.equal(impliedGrowth(inputs, 5_000_000), null);
    assert.equal(impliedGrowth(inputs, 0), null);
  });
});

describe("Einordnung gegenüber dem Bewertungsband", () => {
  test("ordnet nach Lage des Kurses ein", () => {
    assert.equal(classifyAgainstBand(80, 90, 130), "Bewertung erscheint attraktiv");
    assert.equal(classifyAgainstBand(90, 90, 130), "Eher fair bewertet");
    assert.equal(classifyAgainstBand(131, 90, 130), "Hohe Erwartungen eingepreist");
  });
  test("ohne Kurs oder Band keine Einordnung", () => {
    assert.equal(classifyAgainstBand(null, 90, 130), "Datenlage unzureichend");
    assert.equal(classifyAgainstBand(100, null, 130), "Datenlage unzureichend");
  });
});

describe("Hilfsfunktionen und Formatierung", () => {
  test("CAGR", () => {
    assert.ok(Math.abs(cagr(100, 121, 2)! - 0.1) < 1e-9);
    assert.equal(cagr(-1, 121, 2), null);
  });
  test("scoreFromRange in beide Richtungen", () => {
    assert.equal(scoreFromRange(0, 4, 0), 100);
    assert.equal(scoreFromRange(4, 4, 0), 0);
    assert.equal(scoreFromRange(10, 0, 5), 100);
  });
  test("deutsche Formate, Prozent und Prozentpunkte getrennt", () => {
    assert.equal(formatPercent(1.5), "+1,50 %");
    assert.equal(formatPp(-6), "-6,0 Pp.");
    assert.equal(formatBp(12), "+12 Bp.");
    assert.equal(formatShare(0.315), "31,5 %");
    assert.equal(formatCompact(1_234_000_000, "EUR"), "1,23 Mrd. €");
    assert.match(formatPrice(182.5, "USD"), /182,50/);
    assert.equal(formatPrice(null), "–");
  });
});
