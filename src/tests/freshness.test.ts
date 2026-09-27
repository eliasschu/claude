import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { classifyFreshness, formatAge, type FreshnessInput } from "../lib/core/freshness.ts";
import { toUiMeta } from "../lib/data/types.ts";

const NOW = Date.parse("2026-09-22T15:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function input(over: Partial<FreshnessInput>): FreshnessInput {
  return { sourceId: "twelvedata", observedAt: ago(30_000), observedPrecision: "minute", stale: false, ...over };
}

describe("Aktualitätsklassen", () => {
  test("vergibt ohne Streaming-Quelle nie LIVE", () => {
    assert.equal(classifyFreshness(input({ observedAt: ago(1_000) }), NOW).cls, "under_1_min");
    assert.equal(classifyFreshness(input({ observedAt: ago(1_000), cadence: "stream" }), NOW).cls, "live");
  });

  test("stuft Intraday-Kurse nach gemessenem Alter ein", () => {
    assert.equal(classifyFreshness(input({ observedAt: ago(59_000) }), NOW).cls, "under_1_min");
    assert.equal(classifyFreshness(input({ observedAt: ago(5 * 60_000) }), NOW).cls, "delayed_15_min");
    assert.equal(classifyFreshness(input({ observedAt: ago(15 * 60_000) }), NOW).cls, "delayed_15_min");
  });

  test("nennt einen alten Kurs bei offener Börse veraltet, bei geschlossener Börse Schlusskurs", () => {
    const old = ago(3 * 3600_000);
    const open = classifyFreshness(input({ observedAt: old, sessionClosed: false }), NOW);
    assert.equal(open.cls, "stale");
    assert.match(open.reason, /geöffnet/);
    assert.equal(classifyFreshness(input({ observedAt: old, sessionClosed: true }), NOW).cls, "end_of_day");
    assert.equal(classifyFreshness(input({ observedAt: old, sessionClosed: null }), NOW).cls, "stale");
  });

  test("behauptet bei nur tagesgenauem Zeitpunkt keine Minutenaktualität", () => {
    const r = classifyFreshness(input({ observedAt: ago(10_000), observedPrecision: "day" }), NOW);
    assert.equal(r.cls, "unknown");
  });

  test("übernimmt die Veraltet-Markierung der Quelle vorrangig", () => {
    const r = classifyFreshness(input({ stale: true, staleReason: "Letzter erfolgreicher Abruf" }), NOW);
    assert.equal(r.cls, "stale");
    assert.equal(r.reason, "Letzter erfolgreicher Abruf");
  });

  test("fehlender oder zukünftiger Zeitpunkt ergibt UNKNOWN", () => {
    assert.equal(classifyFreshness(input({ observedAt: null }), NOW).cls, "unknown");
    assert.equal(classifyFreshness(input({ observedAt: "kaputt" }), NOW).cls, "unknown");
    const future = classifyFreshness(input({ observedAt: new Date(NOW + 10 * 60_000).toISOString() }), NOW);
    assert.equal(future.cls, "unknown");
    assert.match(future.reason, /Zukunft/);
    // Kleine Uhrabweichung wird toleriert.
    assert.equal(classifyFreshness(input({ observedAt: new Date(NOW + 30_000).toISOString() }), NOW).cls, "under_1_min");
  });

  test("Quellen mit festem Takt behalten ihre Klasse unabhängig vom Alter", () => {
    assert.equal(classifyFreshness(input({ sourceId: "ecb", observedAt: "2026-09-21", observedPrecision: "day" }), NOW).cls, "daily");
    assert.equal(classifyFreshness(input({ sourceId: "sec", observedAt: "2026-06-30", observedPrecision: "day", cadence: "quarterly" }), NOW).cls, "quarterly");
    assert.equal(classifyFreshness(input({ sourceId: "sec", observedAt: "2025-12-31", observedPrecision: "day", cadence: "annual" }), NOW).cls, "annual");
    assert.equal(classifyFreshness(input({ sourceId: "fed-press", observedAt: ago(86400_000) }), NOW).cls, "event");
    assert.equal(classifyFreshness(input({ observedAt: "2026-09-21", observedPrecision: "day", cadence: "end_of_day" }), NOW).cls, "end_of_day");
  });

  test("Altersangabe", () => {
    assert.equal(formatAge(12_000), "12 Sek.");
    assert.equal(formatAge(5 * 60_000), "5 Min.");
    assert.equal(formatAge(3 * 3600_000), "3 Std.");
    assert.equal(formatAge(null), null);
  });
});

describe("Anzeige-Metadaten", () => {
  test("übernimmt den Datenzeitpunkt, nicht den Abrufzeitpunkt, und keine Qualitätsnote", () => {
    const ui = toUiMeta({
      sourceId: "coingecko", source: "CoinGecko", observedAt: ago(20_000), observedPrecision: "minute",
      fetchedAt: new Date(NOW).toISOString(), freshness: "", stale: false,
    }, NOW);
    assert.equal(ui.asOf, ago(20_000));
    assert.equal(ui.freshness.cls, "under_1_min");
    assert.equal("quality" in ui, false);
  });
});
