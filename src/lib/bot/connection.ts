/**
 * Verbindungszustand zum Bot, wie ihn die Website anzeigt. Reine Funktion,
 * damit die Regeln testbar sind. Der Bot laeuft zunaechst lokal auf einem Mac:
 * Er erkennt nur, solange der Rechner eingeschaltet, wach und online ist.
 */

import type { ArchiveStatus, BotResult } from "./client.ts";

export type ConnectionState = "not_configured" | "unreachable" | "error" | "never_ran" | "stale" | "failing" | "ok";

/** Als veraltet gilt der Stand, wenn so viele planmaessige Abrufe hintereinander fehlen. */
export const STALE_AFTER_MISSED_RUNS = 3;

export interface Connection {
  state: ConnectionState;
  tone: "pos" | "warn" | "neg" | "neutral";
  headline: string;
  detail: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  /** Nur wenn true, stammen die Meldungen aus dem Archiv des Bots. */
  archiveAvailable: boolean;
}

const LIVE_NOTE = "Die Karten unten sind eine Live-Auswertung dieser Website, keine archivierten Bot-Erkennungen.";

function ago(iso: string, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  return h < 48 ? `vor ${h} Std.` : `vor ${Math.round(h / 24)} Tagen`;
}

export function botConnection(result: BotResult<ArchiveStatus>, now = new Date()): Connection {
  if (!result.ok) {
    const base = { lastSuccessAt: null, lastAttemptAt: null, archiveAvailable: false };
    if (result.reason === "not_configured") {
      return { ...base, state: "not_configured", tone: "neutral", headline: "Kein Bot verbunden",
        detail: `Diese Website ist mit keinem laufenden Bot verbunden. ${LIVE_NOTE}` };
    }
    if (result.reason === "unreachable") {
      return { ...base, state: "unreachable", tone: "neg", headline: "Bot nicht erreichbar",
        detail: `Der Bot antwortet nicht. Vermutlich ist der Rechner ausgeschaltet oder im Ruhezustand, oder Docker ist gestoppt. Solange gibt es keine neuen Erkennungen. ${LIVE_NOTE}` };
    }
    return { ...base, state: "error", tone: "neg", headline: "Bot meldet einen Fehler", detail: `${result.message}. ${LIVE_NOTE}` };
  }

  const s = result.value.data;
  const common = { lastSuccessAt: s.last_success_at, lastAttemptAt: s.last_attempt_at, archiveAvailable: true };
  if (!s.last_success_at) {
    return { ...common, state: "never_ran", tone: "warn", headline: "Bot verbunden, noch kein erfolgreicher Abruf",
      detail: s.last_attempt_error ? `Letzter Versuch fehlgeschlagen: ${s.last_attempt_error}.` : "Der erste Abruf läuft kurz nach dem Start." };
  }
  const staleMs = STALE_AFTER_MISSED_RUNS * s.interval_minutes * 60000;
  if (now.getTime() - Date.parse(s.last_success_at) > staleMs) {
    return { ...common, state: "stale", tone: "warn", headline: `Daten veraltet: letzter erfolgreicher Abruf ${ago(s.last_success_at, now)}`,
      detail: (s.last_attempt_ok === false && s.last_attempt_error
        ? `Die letzten Abrufe sind fehlgeschlagen: ${s.last_attempt_error}. `
        : "Der Bot hat in dieser Zeit nicht abgerufen, vermutlich weil der Rechner aus war oder geschlafen hat. ")
        + "Meldungen aus dieser Lücke werden beim nächsten erfolgreichen Abruf nachgeholt und tragen dann den späteren, tatsächlichen Erkennungszeitpunkt." };
  }
  if (s.last_attempt_ok === false) {
    return { ...common, state: "failing", tone: "warn", headline: "Letzter Abruf fehlgeschlagen",
      detail: `${s.last_attempt_error ?? "Unbekannter Fehler"}. Der letzte erfolgreiche Abruf war ${ago(s.last_success_at, now)}.` };
  }
  return { ...common, state: "ok", tone: "pos", headline: "Bot aktiv",
    detail: `Ruft alle ${s.interval_minutes} Minuten neue Meldungen ab, solange der Rechner wach ist.` };
}
