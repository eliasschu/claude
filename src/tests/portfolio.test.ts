import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { concentration, parseGermanNumber, sanitizeStoredPortfolio, summarizePosition, totalsByCurrency, type Position } from "../lib/finance/portfolio.ts";
import { PAGE_SIZE, rankRows } from "../lib/finance/ranking.ts";
import { annualizedReturnPct, maxDrawdownPct, outperformancePp, rebaseTo100, totalReturnPct } from "../lib/finance/performance.ts";

const stock = { kind: "stock" as const, key: "AAA", symbol: "AAA", name: "A Corp", currency: "USD" };
const coin = { kind: "crypto" as const, key: "bitcoin", symbol: "BTC", name: "Bitcoin", currency: "EUR" };
let n = 0;
const lot = (quantity: number | null, price: number | null) => ({ id: `l${n++}`, quantity, price, addedAt: "2026-09-22T00:00:00Z" });

describe("Zahleneingabe im deutschen Format", () => {
  for (const [input, value] of [["0,5", 0.5], ["1.234,56", 1234.56], ["1.000", 1000], ["12", 12], ["0.25", 0.25], ["  3,75 ", 3.75]] as [string, number][]) {
    test(`${input} ergibt ${value}`, () => assert.equal(parseGermanNumber(input).value, value));
  }
  test("leere Eingabe bedeutet 'Angabe fehlt', nicht 0", () => {
    assert.deepEqual(parseGermanNumber(""), { ok: true, value: null });
  });
  for (const bad of ["-1", "0", "abc", "1,2,3", "1.23.4"]) {
    test(`verhindert ungültige Eingabe ${bad}`, () => assert.equal(parseGermanNumber(bad).ok, false));
  }
  test("begrenzt Nachkommastellen", () => assert.equal(parseGermanNumber("1,123", 2).ok, false));
});

describe("Positionen", () => {
  test("ohne Stückzahl und Kaufpreis wird nichts berechnet und nichts als 0 gewertet", () => {
    const s = summarizePosition({ id: "1", instrument: stock, lots: [lot(null, null)] }, null);
    assert.equal(s.quantity, null);
    assert.equal(s.invested, null);
    assert.equal(s.profit, null);
    assert.deepEqual(s.missing, ["Stückzahl", "Kaufpreis", "aktueller Kurs"]);
  });
  test("nur Stückzahl: Positionswert ja, Gewinn nein", () => {
    const s = summarizePosition({ id: "1", instrument: coin, lots: [lot(2, null)] }, 100);
    assert.equal(s.currentValue, 200);
    assert.equal(s.profit, null);
    assert.deepEqual(s.missing, ["Kaufpreis"]);
  });
  test("mehrere vollständige Käufe ergeben Durchschnittspreis und Gewinn", () => {
    const s = summarizePosition({ id: "1", instrument: coin, lots: [lot(1, 100), lot(3, 200)] }, 250);
    assert.equal(s.averagePrice, 175);
    assert.equal(s.invested, 700);
    assert.equal(s.currentValue, 1000);
    assert.equal(s.profit, 300);
    assert.ok(Math.abs(s.profitPct! - 42.857) < 0.01);
  });
  test("ein unvollständiger Kauf verhindert die Gewinnberechnung", () => {
    const s = summarizePosition({ id: "1", instrument: coin, lots: [lot(1, 100), lot(1, null)] }, 250);
    assert.equal(s.invested, 100);
    assert.equal(s.investedIncomplete, true);
    assert.equal(s.profit, null);
  });
  test("summiert je Währung und nur vollständige Positionen", () => {
    const a: Position = { id: "a", instrument: coin, lots: [lot(1, 100)] };
    const b: Position = { id: "b", instrument: stock, lots: [lot(10, 5)] };
    const c: Position = { id: "c", instrument: coin, lots: [lot(null, null)] };
    assert.deepEqual(totalsByCurrency([
      { position: a, summary: summarizePosition(a, 120) },
      { position: b, summary: summarizePosition(b, null) },
      { position: c, summary: summarizePosition(c, 120) },
    ]), [
      { currency: "EUR", invested: 100, currentValue: 120, profit: 20, counted: 1, excluded: 1 },
      { currency: "USD", invested: 0, currentValue: 0, profit: 0, counted: 0, excluded: 1 },
    ]);
  });
  test("verwirft beschädigte gespeicherte Einträge", () => {
    const clean = sanitizeStoredPortfolio([{ instrument: { kind: "stock", key: "AAA", currency: "USD" }, lots: [{ quantity: -3, price: "x" }] }, { foo: 1 }, "x"]);
    assert.equal(clean.length, 1);
    assert.equal(clean[0].lots[0].quantity, null);
    assert.equal(clean[0].lots[0].price, null);
  });
});

describe("Klumpenrisiko", () => {
  test("berechnet Anteile je Gruppe und lässt nicht bewertbare Positionen außen vor", () => {
    const p = (name: string, qty: number | null) => ({ id: name, instrument: { ...coin, key: name, name }, lots: [lot(qty, 10)] });
    const a = p("A", 3), b = p("B", 1), c = p("C", null);
    const r = concentration([
      { position: a, summary: summarizePosition(a, 100), group: "Halbleiter" },
      { position: b, summary: summarizePosition(b, 100), group: "Halbleiter" },
      { position: c, summary: summarizePosition(c, 100), group: "Konsum" },
    ], "EUR");
    assert.equal(r.entries[0].label, "Halbleiter");
    assert.equal(r.entries[0].sharePct, 100);
    assert.equal(r.coveredPositions, 2);
    assert.equal(r.ignoredPositions, 1);
  });
  test("ohne Zuordnung entsteht eine eigene Gruppe statt einer falschen Zuweisung", () => {
    const a = { id: "a", instrument: coin, lots: [lot(1, 10)] };
    const r = concentration([{ position: a, summary: summarizePosition(a, 50), group: null }], "EUR");
    assert.equal(r.entries[0].label, "Ohne Zuordnung");
  });
});

describe("Ranglisten", () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: `c${i + 1}`, name: i === 150 ? "Besonderer Name" : `Coin ${i + 1}`, cap: 1000 - i, change: i === 200 ? null : (i % 7) - 3, stable: i % 50 === 0 }));
  const base = {
    rows, query: "", filter: () => true, sort: "marketCap" as const, dir: "desc" as const, page: 1,
    getValue: (r: (typeof rows)[number], k: string) => (k === "marketCap" ? r.cap : r.change),
    getText: (r: (typeof rows)[number]) => `${r.name} ${r.id}`,
  };
  test("führt globale Ränge über Seiten fort", () => {
    const p2 = rankRows({ ...base, page: 2 });
    assert.equal(p2.items[0].sizeRank, 101);
    assert.equal(p2.pages, 3);
    assert.equal(p2.total, 250);
    assert.equal(p2.from, 101);
    assert.equal(rankRows({ ...base, page: 3 }).items.length, 50);
    assert.equal(PAGE_SIZE, 100);
  });
  test("sucht im gesamten Datensatz, nicht nur auf der sichtbaren Seite", () => {
    const r = rankRows({ ...base, query: "besonderer" });
    assert.equal(r.total, 1);
    assert.equal(r.items[0].sizeRank, 151);
  });
  test("Filter verändern Treffer- und Seitenzahl", () => {
    const r = rankRows({ ...base, filter: (row) => !row.stable });
    assert.equal(r.total, 245);
    assert.equal(r.pages, 3);
  });
  test("andere Sortierung behält den Größenrang, fehlende Werte ans Ende", () => {
    const last = rankRows({ ...base, sort: "change24h", dir: "desc", page: 3 }).items.at(-1)!;
    assert.equal(last.item.id, "c201");
    const first = rankRows({ ...base, sort: "change24h", dir: "desc" }).items[0];
    assert.equal(first.position, 1);
    assert.notEqual(first.sizeRank, 1);
  });
  test("ungültige Seitenzahl wird begrenzt, es wird nicht aufgefüllt", () => {
    assert.equal(rankRows({ ...base, page: 99 }).page, 3);
    const leer = rankRows({ ...base, query: "gibt es nicht" });
    assert.equal(leer.total, 0);
    assert.equal(leer.pages, 1);
    assert.equal(leer.from, 0);
  });
});

describe("Renditen", () => {
  test("Gesamtrendite, Annualisierung und größter Rückgang", () => {
    assert.ok(Math.abs(totalReturnPct([100, 110, 121])! - 21) < 1e-9);
    assert.ok(Math.abs(annualizedReturnPct(21, 2)! - 10) < 1e-9);
    assert.equal(annualizedReturnPct(-100, 3), null);
    assert.ok(Math.abs(maxDrawdownPct([100, 120, 90, 130, 117])! + 25) < 1e-9);
  });
  test("Unterschiede in Prozentpunkten, Normierung auf 100", () => {
    assert.equal(outperformancePp(18, 12), 6);
    assert.deepEqual(rebaseTo100([50, 75, 100]), [100, 150, 200]);
  });
});
