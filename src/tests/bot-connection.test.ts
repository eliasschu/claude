import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { botConnection, STALE_AFTER_MISSED_RUNS } from "../lib/bot/connection.ts";
import type { ArchiveStatus, BotResult } from "../lib/bot/client.ts";

const now = new Date("2026-09-28T12:00:00Z");
const status = (p: Partial<ArchiveStatus>): BotResult<ArchiveStatus> => ({
  ok: true,
  value: {
    meta: { audience: "internal", mode: "paper", disclaimer: "", signal_strength_note: "", bot_version: "x", generated_at: now.toISOString() },
    data: {
      interval_minutes: 30, last_success_at: "2026-09-28T11:40:00Z", last_success_details: null, last_attempt_at: "2026-09-28T11:40:00Z",
      last_attempt_ok: true, last_attempt_error: null, scheduler_last_beat: "2026-09-28T11:59:00Z",
      archive: { messages: 3, first_detected: null, last_detected: null }, server_time: now.toISOString(), ...p,
    },
  },
});

describe("Verbindungszustand zum Bot", () => {
  test("nicht eingerichtet und nicht erreichbar: kein Archiv, Live-Auswertung ausdruecklich nicht als Bot-Erkennung", () => {
    const off = botConnection({ ok: false, reason: "not_configured", message: "x" }, now);
    assert.equal(off.state, "not_configured");
    assert.equal(off.archiveAvailable, false);
    const down = botConnection({ ok: false, reason: "unreachable", message: "x" }, now);
    assert.equal(down.state, "unreachable");
    assert.equal(down.tone, "neg");
    assert.match(down.detail, /Ruhezustand/);
    assert.match(down.detail, /keine archivierten Bot-Erkennungen/);
  });

  test("aktuell, solange weniger als drei Abrufe fehlen", () => {
    const c = botConnection(status({}), now);
    assert.equal(c.state, "ok");
    assert.equal(c.lastSuccessAt, "2026-09-28T11:40:00Z");
  });

  test("veraltet nach drei verpassten Abrufen - Archiv bleibt sichtbar, mit Warnung", () => {
    const old = new Date(now.getTime() - (STALE_AFTER_MISSED_RUNS * 30 + 1) * 60000).toISOString();
    const c = botConnection(status({ last_success_at: old, last_attempt_at: old }), now);
    assert.equal(c.state, "stale");
    assert.equal(c.archiveAvailable, true);
    assert.match(c.headline, /veraltet/);
    assert.match(c.detail, /späteren, tatsächlichen Erkennungszeitpunkt/);
    const failing = botConnection(status({ last_success_at: old, last_attempt_ok: false, last_attempt_error: "SEC nicht erreichbar (Internetverbindung prüfen)" }), now);
    assert.equal(failing.state, "stale");
    assert.match(failing.detail, /Internetverbindung/);
  });

  test("letzter Versuch fehlgeschlagen, letzter Erfolg noch frisch", () => {
    const c = botConnection(status({ last_attempt_at: "2026-09-28T11:55:00Z", last_attempt_ok: false, last_attempt_error: "SEC nicht erreichbar (unavailable)" }), now);
    assert.equal(c.state, "failing");
    assert.match(c.detail, /SEC nicht erreichbar/);
  });

  test("verbunden, aber noch nie erfolgreich abgerufen", () => {
    const c = botConnection(status({ last_success_at: null }), now);
    assert.equal(c.state, "never_ran");
  });
});
