import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { archiveHref, formatDelay, lateDetection, messageStatus, parseArchiveFilters, sinceFor, timeline } from "../lib/bot/message-view.ts";
import type { ArchivedMessage, MessageLink } from "../lib/services/bot-feed.ts";

const base: ArchivedMessage = {
  message_id: "m1", kind: "insider_buy", ticker: "TST", issuer_cik: "42", issuer_name: "Test Corp", title: "t", relevance: "r",
  uncertainty: "u", counter_arguments: [], sources: [], selection: "s", value_usd: 1, traded_from: "2026-09-17", traded_to: "2026-09-17",
  published_at: "2026-09-18T21:00:00Z", received_at: "2026-09-18T21:10:00Z", detected_at: "2026-09-18T21:10:30Z",
  materiality: "hoch", amendment: false, rule_version: "insider-rules-1.1",
};
const link = (p: Partial<MessageLink>): MessageLink => ({ direction: "spaeter", relation: "erweitert", created_at: "", message_id: "x",
  kind: "insider_cluster", title: "", detected_at: "", amendment: false, ...p });

describe("Meldungsdetail: vier getrennte Zeitpunkte", () => {
  test("Reihenfolge und Abstände", () => {
    const t = timeline(base);
    assert.deepEqual(t.map((s) => s.key), ["gehandelt", "veroeffentlicht", "eingegangen", "erkannt"]);
    assert.match(t[2].sincePrevious!, /^10 Min\. nach Veröffentlichung$/);
    assert.match(t[3].sincePrevious!, /^1 Min\. nach Eingang$/);
    assert.equal(lateDetection(base), null);
  });

  test("ältere Meldung ohne Eingangszeit: wird als nicht erfasst gezeigt, nicht erfunden", () => {
    const t = timeline({ ...base, received_at: null, rule_version: "insider-rules-1.0" });
    assert.equal(t[2].at, null);
    assert.match(t[2].note!, /nicht erfasst/);
    assert.match(t[3].sincePrevious!, /nach Veröffentlichung/);
  });

  test("nachträglich erkannt (z. B. Rechner schlief) wird benannt", () => {
    const late = lateDetection({ ...base, detected_at: "2026-09-21T08:00:00Z" });
    assert.match(late!, /nicht zurückdatiert/);
    assert.equal(formatDelay(-5 * 60000), "−5 Min.");
    assert.equal(formatDelay(3 * 86400000), "3 Tage");
  });

  test("Status aus Verknüpfungen, Original bleibt Original", () => {
    assert.equal(messageStatus(base, []).label, "Original");
    assert.equal(messageStatus(base, [link({ relation: "berichtigt" })]).label, "Später berichtigt");
    assert.equal(messageStatus(base, [link({})]).label, "Später erweitert");
    assert.equal(messageStatus({ ...base, amendment: true }, [link({ direction: "frueher", relation: "berichtigt" })]).label, "Berichtigung");
  });
});

describe("Archivfilter", () => {
  test("gültige Werte werden übernommen, ungültige verworfen", () => {
    const f = parseArchiveFilters({ ticker: "aapl", art: "insider_sale", aussagekraft: "mittel", zeitraum: "30", seite: "3" });
    assert.deepEqual(f, { ticker: "AAPL", kind: "insider_sale", materiality: "mittel", period: "30", page: 3 });
    const bad = parseArchiveFilters({ ticker: "<script>", art: "x", aussagekraft: "sehr", zeitraum: "999", seite: "-4" });
    assert.deepEqual(bad, { ticker: undefined, kind: undefined, materiality: undefined, period: "alle", page: 1 });
  });

  test("Zeitraum und Links", () => {
    assert.equal(sinceFor("7", new Date("2026-09-28T00:00:00Z")), "2026-09-21T00:00:00.000Z");
    assert.equal(sinceFor("alle"), undefined);
    assert.equal(archiveHref({ ticker: "AAPL", period: "alle", page: 2 }), "/meldungen?ticker=AAPL&seite=2");
    assert.equal(archiveHref({ period: "alle" }), "/meldungen");
  });
});

describe("Handelsplan in archivierten Meldungen", () => {
  test("vier Zustände, ältere Speicherung ohne Zustand gilt als nicht sicher erfasst", async () => {
    const { planStatusOf, PLAN_LABEL } = await import("../lib/services/bot-feed.ts");
    assert.equal(planStatusOf({ plan_10b5_1: false, plan_status: "unknown" }), "unknown");
    assert.equal(planStatusOf({ plan_10b5_1: false, plan_status: "denied" }), "denied");
    assert.equal(planStatusOf({ plan_10b5_1: true }), "confirmed");
    assert.equal(planStatusOf({ plan_10b5_1: false }), "legacy_uncertain", "altes false ist kein belegtes Nein");
    assert.match(PLAN_LABEL.legacy_uncertain, /nicht sicher/);
  });
});
