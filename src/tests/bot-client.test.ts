import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { bot } from "../lib/bot/client.ts";

afterEach(() => {
  delete process.env.BOT_API_URL;
  delete process.env.BOT_API_TOKEN;
});

describe("Bot-API-Client", () => {
  test("ohne Konfiguration ehrlich nicht verfügbar", async () => {
    const r = await bot.status(async () => { throw new Error("darf nicht aufgerufen werden"); });
    assert.equal(r.ok, false);
  });

  test("sendet das Token nur serverseitig als Bearer und liest den Umschlag", async () => {
    process.env.BOT_API_URL = "http://api:8000/";
    process.env.BOT_API_TOKEN = "geheim";
    let seen: { url: string; auth: string | null } | null = null;
    const r = await bot.signals({ decision: "WATCH", limit: 5 }, async (url, init) => {
      seen = { url, auth: new Headers(init?.headers).get("authorization") };
      return new Response(JSON.stringify({ data: [], meta: { audience: "internal", mode: "paper" } }), { status: 200 });
    });
    assert.deepEqual(seen, { url: "http://api:8000/signals?decision=WATCH&limit=5", auth: "Bearer geheim" });
    assert.equal(r.ok && r.value.meta.audience, "internal");
  });

  test("Fehlerstatus wird weitergegeben, nicht verschluckt", async () => {
    process.env.BOT_API_URL = "http://api:8000";
    process.env.BOT_API_TOKEN = "x";
    const r = await bot.status(async () => new Response("nein", { status: 401 }));
    assert.deepEqual(r, { ok: false, reason: "http", status: 401, message: "Bot-API antwortete mit 401" });
  });
});
