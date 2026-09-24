import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TRANSACTION_CODES } from "../lib/sources/parsers/sec.ts";
import { usBusinessDaysBetween, usFederalHolidays } from "../lib/core/us-business-days.ts";
import { assessMateriality } from "../lib/finance/insider-materiality.ts";
import { formatInsiderName, shortRole } from "../lib/finance/insider-names.ts";

describe("Transaktionscodes", () => {
  test("jeder Code hat eine eigene Kategorie, kein Sammelbecken ausser bei J", () => {
    assert.equal(TRANSACTION_CODES.P.category, "kauf");
    assert.equal(TRANSACTION_CODES.S.category, "verkauf");
    assert.equal(TRANSACTION_CODES.A.category, "zuteilung");
    assert.equal(TRANSACTION_CODES.M.category, "ausuebung");
    assert.equal(TRANSACTION_CODES.F.category, "steuereinbehalt");
    assert.equal(TRANSACTION_CODES.G.category, "schenkung");
    assert.equal(TRANSACTION_CODES.D.category, "rueckgabe");
    assert.equal(TRANSACTION_CODES.W.category, "erbfall");
    assert.equal(TRANSACTION_CODES.J.category, "sonstige");
    const sonstige = Object.values(TRANSACTION_CODES).filter((c) => c.category === "sonstige");
    assert.equal(sonstige.length, 1, "nur der SEC-eigene Restcode J darf 'sonstige' sein");
  });
});

describe("US-Geschäftstage", () => {
  test("Wochenende zaehlt nicht", () => {
    // Freitag 2026-09-18 -> Montag 2026-09-21: nur der Montag ist ein Geschaeftstag
    assert.equal(usBusinessDaysBetween("2026-09-18", "2026-09-21"), 1);
  });
  test("Feiertag zaehlt nicht - Thanksgiving 2026 faellt auf Donnerstag 26.11.", () => {
    const holidays = usFederalHolidays(2026);
    assert.ok(holidays.has("2026-11-26"));
    // Mittwoch 25.11. -> Freitag 27.11.: Do 26.11. (Feiertag) zaehlt nicht, nur Fr 27.11.
    assert.equal(usBusinessDaysBetween("2026-11-25", "2026-11-27"), 1);
  });
  test("auf Samstag fallender Feiertag wird auf Freitag vorgezogen", () => {
    // Unabhaengigkeitstag 2026 faellt auf einen Samstag (04.07.2026)
    const holidays = usFederalHolidays(2026);
    assert.ok(holidays.has("2026-07-03"));
    assert.ok(!holidays.has("2026-07-04"));
  });
  test("liefert null bei fehlenden oder unsinnigen Daten", () => {
    assert.equal(usBusinessDaysBetween("2026-09-20", "2026-09-10"), null);
  });
});

describe("Namen und Rollen", () => {
  test("formt 'NACHNAME VORNAME' in lesbare Form um", () => {
    assert.equal(formatInsiderName("STEVENS MARK A"), "Mark A Stevens");
  });
  test("bekannte Fuehrungskraefte behalten ihren oeffentlichen Namen", () => {
    assert.equal(formatInsiderName("HUANG JEN HSUN"), "Jensen Huang");
  });
  test("Name mit Komma wird korrekt umgestellt", () => {
    assert.equal(formatInsiderName("Stevens, Mark A"), "Mark A Stevens");
  });
  test("erkennt CEO aus der Amtsbezeichnung", () => {
    assert.equal(shortRole(["Führungskraft: Chief Executive Officer"]), "CEO");
  });
  test("faellt bei unbekannter Rolle auf 'Führungskraft' zurueck", () => {
    assert.equal(shortRole(["Führungskraft: Head of Something"]), "Führungskraft");
  });
});

describe("Aussagekraft", () => {
  test("Kauf am offenen Markt ohne Plan ist hoch", () => {
    const r = assessMateriality({ category: "kauf", table: "direkt", plan10b51: false, value: 10_000, shareOfHolding: null, inBuyCluster: false });
    assert.equal(r.level, "hoch");
  });
  test("Kauf nach Plan ist nur gering", () => {
    const r = assessMateriality({ category: "kauf", table: "direkt", plan10b51: true, value: 10_000, shareOfHolding: null, inBuyCluster: false });
    assert.equal(r.level, "gering");
  });
  test("Cluster-Kauf ist immer hoch, auch mit Plan", () => {
    const r = assessMateriality({ category: "kauf", table: "direkt", plan10b51: true, value: 100, shareOfHolding: null, inBuyCluster: true });
    assert.equal(r.level, "hoch");
  });
  test("grosser Verkauf ohne Plan ist mittel", () => {
    const r = assessMateriality({ category: "verkauf", table: "direkt", plan10b51: null, value: 2_000_000, shareOfHolding: null, inBuyCluster: false });
    assert.equal(r.level, "mittel");
  });
  test("kleiner Verkauf nach Plan ist gering", () => {
    const r = assessMateriality({ category: "verkauf", table: "direkt", plan10b51: true, value: 5_000_000, shareOfHolding: null, inBuyCluster: false });
    assert.equal(r.level, "gering");
  });
  test("Verkauf ab 5 Prozent des Bestands ist auch ohne grossen Betrag mittel", () => {
    const r = assessMateriality({ category: "verkauf", table: "direkt", plan10b51: false, value: 1000, shareOfHolding: 0.08, inBuyCluster: false });
    assert.equal(r.level, "mittel");
  });
  test("Zuteilung, Ausuebung, Steuereinbehalt, Schenkung und Erbfall sind nie aussagekraeftig", () => {
    for (const category of ["zuteilung", "ausuebung", "steuereinbehalt", "schenkung", "erbfall"] as const) {
      const r = assessMateriality({ category, table: "direkt", plan10b51: null, value: 5_000_000, shareOfHolding: 0.5, inBuyCluster: false });
      assert.equal(r.level, "keine");
    }
  });
});
