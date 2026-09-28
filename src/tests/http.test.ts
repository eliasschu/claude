import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { __resetHttpState, fetchSource, parseJson, SourceError } from "../lib/core/http.ts";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
  __resetHttpState();
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function stub(responses: (() => Promise<Response>)[]) {
  let i = 0;
  const calls = { count: 0 };
  globalThis.fetch = (async () => {
    calls.count++;
    const next = responses[Math.min(i++, responses.length - 1)];
    return next();
  }) as typeof fetch;
  return calls;
}

describe("Abrufschicht", () => {
  test("dataCache: false umgeht den Next-Datencache (2-MB-Grenze), nutzt aber den Prozessspeicher", async () => {
    const inits: RequestInit[] = [];
    globalThis.fetch = (async (_u: string, init: RequestInit) => { inits.push(init); return json({ big: true }); }) as unknown as typeof fetch;
    const opts = { sourceId: "sec" as const, url: "https://x/gross", revalidate: 900, dataCache: false, parse: parseJson };
    await fetchSource(opts);
    await fetchSource(opts);
    assert.equal(inits.length, 1, "zweiter Aufruf aus dem Prozessspeicher");
    assert.equal(inits[0].cache, "no-store");
    assert.equal((inits[0] as { next?: unknown }).next, undefined);
  });

  test("wiederholt bei 503 und liefert dann das Ergebnis", async () => {
    const calls = stub([async () => json({}, 503), async () => json({ a: 1 }, 200, { date: "Tue, 22 Sep 2026 10:00:00 GMT" })]);
    const r = await fetchSource({ sourceId: "ecb", url: "https://x/1", revalidate: 60, parse: parseJson, retries: 1 });
    assert.deepEqual(r.value, { a: 1 });
    assert.equal(r.fetchedAt, "2026-09-22T10:00:00.000Z");
    assert.equal(r.stale, false);
    assert.equal(calls.count, 2);
  });

  test("wiederholt nicht bei 404", async () => {
    const calls = stub([async () => json({}, 404)]);
    await assert.rejects(
      fetchSource({ sourceId: "sec", url: "https://x/2", revalidate: 60, parse: parseJson, retries: 2 }),
      (e: SourceError) => e.reason === "not_found",
    );
    assert.equal(calls.count, 1);
  });

  test("zeigt bei Ausfall den letzten guten Stand, ausdrücklich als veraltet", async () => {
    stub([async () => json({ v: 1 })]);
    await fetchSource({ sourceId: "ecb", url: "https://x/3", revalidate: 60, parse: parseJson, retries: 0 });
    stub([async () => { throw new TypeError("offline"); }]);
    // revalidate 0: der Zwischenspeicher gilt als abgelaufen, es wird neu abgerufen - und das schlaegt fehl
    const r = await fetchSource({ sourceId: "ecb", url: "https://x/3", revalidate: 0, parse: parseJson, retries: 0 });
    assert.deepEqual(r.value, { v: 1 });
    assert.equal(r.stale, true);
    assert.match(r.staleReason!, /Letzter erfolgreicher Abruf/);
  });

  test("wirft ohne früheren Stand einen Fehler statt Ersatzwerte zu liefern", async () => {
    stub([async () => { throw new TypeError("offline"); }]);
    await assert.rejects(
      fetchSource({ sourceId: "ecb", url: "https://x/4", revalidate: 60, parse: parseJson, retries: 0 }),
      (e: unknown) => e instanceof SourceError,
    );
  });

  test("meldet 429 als Abruflimit", async () => {
    stub([async () => json({}, 429, { "retry-after": "0" })]);
    await assert.rejects(
      fetchSource({ sourceId: "coingecko", url: "https://x/5", revalidate: 60, parse: parseJson, retries: 1 }),
      (e: SourceError) => e.reason === "rate_limited",
    );
  });

  test("meldet ungültige Antworten ohne Wiederholung", async () => {
    const calls = stub([async () => new Response("kein json", { status: 200 })]);
    await assert.rejects(
      fetchSource({ sourceId: "sec", url: "https://x/6", revalidate: 60, parse: parseJson, retries: 2 }),
      (e: SourceError) => e.reason === "invalid",
    );
    assert.equal(calls.count, 1);
  });

  test("hält den Mindestabstand zwischen Abrufen derselben Quelle ein", async () => {
    stub([async () => json({ ok: true })]);
    const started = Date.now();
    await Promise.all([1, 2, 3].map((n) =>
      fetchSource({ sourceId: "sec", url: `https://x/thr${n}`, revalidate: 60, parse: parseJson, retries: 0, minIntervalMs: 120 })));
    assert.ok(Date.now() - started >= 240, "drei Abrufe brauchen mindestens zwei Wartezeiten");
  });
});

describe("Zwischenspeicher vor der Drosselung", () => {
  test("frische Antwort kommt ohne Netzabruf und ohne Wartezeit zurück", async () => {
    const { fetchSource, parseJson, __resetHttpState } = await import("../lib/core/http.ts");
    __resetHttpState();
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { calls += 1; return new Response(JSON.stringify({ n: calls }), { status: 200 }); }) as typeof fetch;
    try {
      const opts = { sourceId: "twelvedata" as const, url: "https://example.test/cache", revalidate: 60, parse: parseJson, minIntervalMs: 5000 };
      const first = await fetchSource(opts);
      const started = Date.now();
      const second = await fetchSource(opts);
      assert.equal(calls, 1);
      assert.deepEqual(second.value, first.value);
      assert.ok(Date.now() - started < 200, "keine Drosselungspause bei frischem Treffer");
      const fresh = await fetchSource({ ...opts, noStore: true, minIntervalMs: 0 });
      assert.equal(calls, 2, "noStore umgeht den Zwischenspeicher");
      assert.ok(fresh);
    } finally {
      globalThis.fetch = original;
      __resetHttpState();
    }
  });
});
