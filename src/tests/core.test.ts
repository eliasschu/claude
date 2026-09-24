import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, formatDateOnly, formatDateTimeVienna, zonedWallTimeToUtc } from "../lib/core/time.ts";
import { decodeEntities, safeHttpUrl, toPlainText } from "../lib/core/sanitize.ts";
import { isStale } from "../lib/core/meta.ts";

describe("Zeitzone Wien", () => {
  test("unterscheidet Winter- und Sommerzeit an der Umstellung am 29.03.2026", () => {
    assert.match(formatDateTimeVienna("2026-03-29T00:30:00Z"), /01:30/);
    assert.match(formatDateTimeVienna("2026-03-29T00:30:00Z"), /MEZ|GMT\+1/);
    assert.match(formatDateTimeVienna("2026-03-29T01:30:00Z"), /03:30/);
    assert.match(formatDateTimeVienna("2026-03-29T01:30:00Z"), /MESZ|GMT\+2/);
  });

  test("Fed-Entscheidung 28.10.2026 14:00 New York entspricht 19:00 Wien", () => {
    const utc = zonedWallTimeToUtc(2026, 10, 28, 14, 0, "America/New_York");
    assert.equal(utc.toISOString(), "2026-10-28T18:00:00.000Z");
    assert.match(formatDateTimeVienna(utc), /19:00/);
  });

  test("Fed-Entscheidung 09.12.2026 14:00 New York entspricht 20:00 Wien", () => {
    const utc = zonedWallTimeToUtc(2026, 12, 9, 14, 0, "America/New_York");
    assert.equal(utc.toISOString(), "2026-12-09T19:00:00.000Z");
    assert.match(formatDateTimeVienna(utc), /20:00/);
  });

  test("Tageswerte werden nicht verschoben, Meldeverzug wird korrekt gezählt", () => {
    assert.equal(formatDateOnly("2026-09-18"), "18.09.2026");
    assert.equal(daysBetween("2026-07-01", "2026-08-15"), 45);
  });
});

describe("Veraltet-Erkennung", () => {
  test("erkennt fehlende und zu alte Zeitpunkte", () => {
    const now = Date.parse("2026-09-22T12:00:00Z");
    assert.equal(isStale(null, 1000, now), true);
    assert.equal(isStale("2026-09-22T11:50:00Z", 30 * 60000, now), false);
    assert.equal(isStale("2026-09-22T10:00:00Z", 30 * 60000, now), true);
    assert.equal(isStale("2026-09-21", 5 * 86400000, now), false);
  });
});

describe("Bereinigung fremder Inhalte", () => {
  test("entfernt Skripte, Tags und Kommentare", () => {
    assert.equal(toPlainText(`<p>Zins <b>bleibt</b></p><script>alert(1)</script><!-- x --><img src=x onerror=alert(1)>`), "Zins bleibt");
  });
  test("lässt doppelt kodiertes Markup nicht durch", () => {
    assert.ok(!toPlainText("&lt;script&gt;alert(1)&lt;/script&gt;Text").includes("<"));
  });
  test("löst Entitäten auf", () => {
    assert.equal(decodeEntities("Zinsschritt &amp; Ausblick &#8211; EZB"), "Zinsschritt & Ausblick – EZB");
  });
  test("erlaubt nur http(s)-Links", () => {
    assert.equal(safeHttpUrl("javascript:alert(1)"), null);
    assert.equal(safeHttpUrl("data:text/html,x"), null);
    assert.equal(safeHttpUrl("https://www.ecb.europa.eu/x.html"), "https://www.ecb.europa.eu/x.html");
  });
  test("kürzt lange Texte an der Wortgrenze", () => {
    const t = toPlainText("Wort ".repeat(200), 50);
    assert.ok(t.length <= 52 && t.endsWith("…"));
  });
});
