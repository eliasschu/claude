import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { eventReturns, toDailyBars, usCloseTime, type DailyBar } from "../lib/finance/event-returns.ts";

// Handelstage: Do 24.09., Fr 25.09., Mo 28.09., Di 29.09., Mi 30.09. (2026)
const days = ["2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30"];
const stock: DailyBar[] = days.map((date, i) => ({ date, close: [100, 110, 99, 121, 132][i] }));
const NOW = Date.parse("2026-10-01T00:00:00Z");
const spy: DailyBar[] = days.map((date, i) => ({ date, close: [500, 505, 500, 510, 515][i] }));

describe("Kursverlauf nach einem Ereignis", () => {
  test("Handelsschluss 16:00 New York, Sommerzeit berücksichtigt", () => {
    assert.equal(new Date(usCloseTime("2026-09-25")).toISOString(), "2026-09-25T20:00:00.000Z");
    assert.equal(new Date(usCloseTime("2026-12-04")).toISOString(), "2026-12-04T21:00:00.000Z");
  });

  test("Meldung nach Börsenschluss am Freitag: Ausgangspunkt ist der Schluss am Montag, nicht der Freitag", () => {
    const r = eventReturns(stock, spy, "2026-09-25T21:30:00Z", undefined, NOW);
    assert.ok(r.ok);
    assert.equal(r.base.date, "2026-09-28");
    assert.equal(r.rows[0].endDate, "2026-09-29");
    assert.ok(Math.abs(r.rows[0].stockPct! - (121 / 99 - 1) * 100) < 1e-9);
    assert.ok(Math.abs(r.rows[0].benchPct! - 2) < 1e-9);
    assert.ok(Math.abs(r.rows[0].excessPp! - ((121 / 99 - 1) * 100 - 2)) < 1e-9);
  });

  test("Meldung während des Handels: Ausgangspunkt ist der Schluss desselben Tages", () => {
    const r = eventReturns(stock, spy, "2026-09-25T15:00:00Z", undefined, NOW);
    assert.ok(r.ok && r.base.date === "2026-09-25");
  });

  test("nicht erreichte Horizonte bleiben leer statt geschätzt; bis heute zählt Handelstage", () => {
    const r = eventReturns(stock, spy, "2026-09-25T21:30:00Z", [1, 5], NOW);
    assert.ok(r.ok);
    assert.equal(r.rows[1].status, "noch_nicht_erreicht");
    assert.equal(r.rows[1].stockPct, null);
    assert.equal(r.latest.tradingDays, 2);
    assert.equal(r.latest.endDate, "2026-09-30");
  });

  test("fehlender Vergleichstag ergibt keinen Vergleich, keine Lücke wird übersprungen", () => {
    const r = eventReturns(stock, spy.filter((b) => b.date !== "2026-09-29"), "2026-09-25T21:30:00Z", undefined, NOW);
    assert.ok(r.ok);
    assert.equal(r.rows[0].benchPct, null);
    assert.equal(r.rows[0].excessPp, null);
    assert.ok(r.rows[0].stockPct !== null);
  });

  test("ohne Handelsschluss nach dem Ereignis oder ohne Daten: ehrliche Begründung", () => {
    const r1 = eventReturns(stock, spy, "2026-10-01T12:00:00Z", undefined, Date.parse("2026-10-02T00:00:00Z"));
    assert.ok(!r1.ok && /noch keinen Handelsschluss/.test(r1.reason));
    const r2 = eventReturns([], null, "2026-09-25T12:00:00Z");
    assert.ok(!r2.ok);
    const r3 = eventReturns(stock, null, "2026-08-01T12:00:00Z", undefined, NOW);
    assert.ok(!r3.ok && /beginnt erst nach/.test(r3.reason));
  });

  test("der heutige Balken zählt vor Handelsschluss nicht als Schlusskurs", () => {
    const beforeClose = Date.parse("2026-09-30T18:00:00Z"); // 14:00 New York
    const r = eventReturns(stock, spy, "2026-09-25T21:30:00Z", [1, 5], beforeClose);
    assert.ok(r.ok);
    assert.equal(r.latest.endDate, "2026-09-29");
  });

  test("Twelve-Data-Punkte (UTC-Mittag) werden zu Handelstagen", () => {
    const bars = toDailyBars([[Date.parse("2026-09-25T12:00:00Z"), 110], [Date.parse("2026-09-24T12:00:00Z"), 100], [Date.parse("2026-09-28T12:00:00Z"), 0]]);
    assert.deepEqual(bars, [{ date: "2026-09-24", close: 100 }, { date: "2026-09-25", close: 110 }]);
  });
});
