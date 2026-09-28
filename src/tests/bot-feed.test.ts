import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FEED_RULES, selectBotMessages } from "../lib/services/bot-feed.ts";
import type { InsiderRow } from "../lib/services/insider.ts";
import { search } from "../lib/services/search.ts";
import { __resetHttpState } from "../lib/core/http.ts";
import { __resetTickerCache } from "../lib/sources/sec.ts";

let n = 0;
function row(p: Partial<InsiderRow>): InsiderRow {
  n += 1;
  return {
    id: `acc-${n}`, ticker: "TEST", issuerName: "Test Corp", owner: `Person ${n}`, role: "CEO", roles: ["CEO"],
    table: "direkt", security: "Stammaktie", transactionDate: "2026-09-20", code: "P", codeLabel: "Kauf",
    category: "kauf", shares: 1000, price: 100, value: 100_000, acquired: true, sharesAfter: 5000, ownership: "direkt",
    shareOfHolding: 0.25, fills: [], filingDate: "2026-09-22", delayDays: 2, ageDays: 3, amendment: false,
    plan10b51: false, documentUrl: `https://www.sec.gov/doc-${n}.xml`, materiality: "hoch",
    materialityReason: "Kauf am offenen Markt ohne erkennbaren Plan.", hidden: false, ...p,
  };
}
const fetchedAt = "2026-09-25T08:00:00.000Z";

describe("Bot-Meldungen: Auswahl nach festen Regeln", () => {
  test("jede Meldung beantwortet was, warum, wann und welche Unsicherheit - Zeiten getrennt", () => {
    const [m] = selectBotMessages({ rows: [row({})], clusters: [], fetchedAt });
    assert.ok(m.title.includes("kauft TEST-Aktien"));
    assert.ok(m.relevance.length > 20);
    assert.ok(m.uncertainty.length > 20);
    assert.equal(m.tradedFrom, "2026-09-20");
    assert.equal(m.publishedAt, "2026-09-22");
    assert.equal(m.detectedAt, fetchedAt);
    assert.equal(m.sources.length, 1);
  });

  test("ohne passende Ereignisse keine Meldung - nichts wird aufgefuellt", () => {
    const rows = [
      row({ materiality: "gering" }),
      row({ category: "zuteilung" as InsiderRow["category"], materiality: "keine" }),
      row({ ageDays: FEED_RULES.maxAgeDays + 1 }),
      row({ hidden: true }),
      row({ table: "derivativ" }),
    ];
    assert.deepEqual(selectBotMessages({ rows, clusters: [], fetchedAt }), []);
  });

  test("hoechstens limit Meldungen, Rangfolge Cluster > Kauf > Verkauf, dann Betrag", () => {
    const rows = [
      row({ ticker: "AAA", category: "verkauf", materiality: "mittel", value: 9_000_000 }),
      row({ ticker: "BBB", value: 50_000 }),
      row({ ticker: "CCC", value: 2_000_000 }),
      row({ ticker: "DDD", owner: "A", value: 10_000 }),
      row({ ticker: "DDD", owner: "B", value: 10_000 }),
      ...Array.from({ length: 6 }, (_, i) => row({ ticker: `X${i}`, value: 1000 + i })),
    ];
    const out = selectBotMessages({ rows, clusters: [{ ticker: "DDD", issuerName: "D Corp", owners: ["A", "B"] }], fetchedAt });
    assert.equal(out.length, FEED_RULES.limit);
    assert.deepEqual(out.map((m) => m.ticker).slice(0, 3), ["DDD", "CCC", "BBB"]);
    assert.equal(out[0].kind, "insider_cluster");
    assert.equal(out[0].value, 20_000);
    assert.ok(!out.some((m) => m.ticker === "AAA"), "Verkauf rangiert hinter allen Kaeufen");
  });

  test("Cluster wird zu einer Meldung je Unternehmen, Einzelzeilen derselben Person werden zusammengefasst", () => {
    const rows = [
      row({ ticker: "EEE", owner: "A", transactionDate: "2026-09-18" }),
      row({ ticker: "EEE", owner: "B", transactionDate: "2026-09-20" }),
      row({ ticker: "FFF", owner: "C", value: 1000, filingDate: "2026-09-21" }),
      row({ ticker: "FFF", owner: "C", value: 2000, filingDate: "2026-09-23" }),
    ];
    const out = selectBotMessages({ rows, clusters: [{ ticker: "EEE", issuerName: "E Corp", owners: ["A", "B"] }], fetchedAt });
    assert.equal(out.length, 2);
    const cluster = out.find((m) => m.ticker === "EEE")!;
    assert.equal(cluster.tradedFrom, "2026-09-18");
    assert.equal(cluster.tradedTo, "2026-09-20");
    assert.equal(cluster.sources.length, 2);
    const single = out.find((m) => m.ticker === "FFF")!;
    assert.equal(single.value, 3000);
    assert.equal(single.publishedAt, "2026-09-23");
  });

  test("unbekannter Handelsplan wird als Unsicherheit genannt", () => {
    const [m] = selectBotMessages({ rows: [row({ plan10b51: null })], clusters: [], fetchedAt });
    assert.match(m.uncertainty, /10b5-1/);
  });
});

describe("Aktiensuche", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    __resetHttpState();
    __resetTickerCache();
  });

  function mockSec() {
    process.env.SEC_EDGAR_USER_AGENT = "Finanzwelt Test test@example.org";
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("company_tickers_exchange.json")) {
        return new Response(JSON.stringify({ fields: ["cik", "name", "ticker", "exchange"], data: [
          [1, "Alphabet Inc.", "GOOGL", "Nasdaq"], [1, "Alphabet Inc.", "GOOG", "Nasdaq"], [2, "Apple Inc.", "AAPL", "Nasdaq"],
          [3, "Applied Materials Inc", "AMAT", "Nasdaq"], [4, "Berkshire Hathaway Inc", "BRK-B", "NYSE"],
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("nicht gefunden", { status: 404 });
    }) as typeof fetch;
    return calls;
  }

  test("nur Aktien: Treffer nach Firmenname und Kuerzel, mit Boerse, ohne Kryptoabruf", async () => {
    const calls = mockSec();
    const byName = await search("alphabet", 10, "stock");
    assert.deepEqual(byName.hits.map((h) => h.symbol).sort(), ["GOOG", "GOOGL"]);
    assert.ok(byName.hits.every((h) => h.kind === "stock" && h.exchange === "Nasdaq"));
    const byTicker = await search("AAPL", 10, "stock");
    assert.equal(byTicker.hits[0].symbol, "AAPL");
    assert.ok(!calls.some((u) => u.includes("coingecko")), "Aktiensuche fragt keine Kryptoquelle ab");
  });

  test("Namensanfang findet aehnliche Titel, das Kuerzel unterscheidet sie", async () => {
    mockSec();
    const r = await search("appl", 10, "stock");
    assert.deepEqual(r.hits.map((h) => h.symbol), ["AAPL", "AMAT"]);
  });

  test("Quellenausfall wird als Hinweis gemeldet statt als leeres Ergebnis verschwiegen", async () => {
    process.env.SEC_EDGAR_USER_AGENT = "Finanzwelt Test test@example.org";
    globalThis.fetch = (async () => new Response("kaputt", { status: 503 })) as typeof fetch;
    const r = await search("apple", 10, "stock");
    assert.equal(r.hits.length, 0);
    assert.equal(r.issues.length, 1);
  });
});

describe("Meldungsarchiv der Bot-API", () => {
  const base = {
    issuer_cik: "42", issuer_name: "Test Corp", relevance: "r", uncertainty: "u", counter_arguments: [],
    sources: [{ label: "SEC Form 4", url: "https://www.sec.gov/x/" }], selection: "s", traded_from: "2026-09-20", traded_to: "2026-09-20",
  };
  const now = new Date("2026-09-28T12:00:00Z");

  test("gleiche Regeln wie live, aber fester Erkennungszeitpunkt aus dem Archiv", async () => {
    const { fromArchive } = await import("../lib/services/bot-feed.ts");
    const out = fromArchive([
      { ...base, message_id: "a", kind: "insider_sale", ticker: "AAA", title: "Verkauf", value_usd: 9e6, published_at: "2026-09-25T21:00:00Z", detected_at: "2026-09-25T21:30:00Z" },
      { ...base, message_id: "b", kind: "insider_cluster", ticker: "BBB", title: "Cluster", value_usd: 1e4, published_at: "2026-09-24T21:00:00Z", detected_at: "2026-09-24T21:30:00Z" },
      { ...base, message_id: "c", kind: "insider_buy", ticker: "CCC", title: "zu alt", value_usd: 1e7, published_at: "2026-09-01T21:00:00Z", detected_at: "2026-09-01T21:30:00Z" },
    ], now);
    assert.deepEqual(out.map((m) => m.id), ["b", "a"]);
    assert.equal(out[0].origin, "archiv");
    assert.equal(out[0].detectedAt, "2026-09-24T21:30:00Z");
  });
});
