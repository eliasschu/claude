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
    const r = await fetchSource({ sourceId: "ecb", url: "https://x/3", revalidate: 60, parse: parseJson, retries: 0 });
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
