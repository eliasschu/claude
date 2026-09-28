/**
 * Kursverlauf nach einem Ereignis - reine Funktionen, keine Datenbeschaffung.
 *
 * Ausgangspunkt ist der ERSTE Tagesschlusskurs, der NACH dem Ereigniszeitpunkt feststand
 * (US-Handelsschluss 16:00 New York). Wer eine Meldung um 17:30 New York sieht, konnte
 * fruehestens zum Schluss des naechsten Handelstags handeln - frueher anzusetzen waere
 * ein Blick in die Zukunft. Horizonte zaehlen Handelstage (Balken), nicht Kalendertage.
 * Ein spaeterer Kursverlauf belegt keine Ursache.
 */

import { zonedWallTimeToUtc } from "../core/time.ts";

export interface DailyBar { date: string; close: number }

export interface HorizonRow {
  horizon: number;
  status: "ok" | "noch_nicht_erreicht";
  endDate: string | null;
  stockPct: number | null;
  /** null, wenn die Vergleichsreihe fuer Start- oder Enddatum fehlt. */
  benchPct: number | null;
  /** Differenz in Prozentpunkten (Aktie minus Vergleich). */
  excessPp: number | null;
}

export type EventReturns =
  | { ok: true; base: DailyBar; rows: HorizonRow[]; latest: HorizonRow & { tradingDays: number } }
  | { ok: false; reason: string };

export const DEFAULT_HORIZONS = [1, 5, 20];

/** Zeitpunkt, an dem der Schlusskurs eines US-Handelstags feststand (16:00 New York, UTC-Millisekunden). */
export function usCloseTime(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return zonedWallTimeToUtc(y, m, d, 16, 0, "America/New_York").getTime();
}

/** Tagesbalken aus [Zeitstempel, Schluss]-Paaren; der Tag ergibt sich aus dem UTC-Datum des Zeitstempels. */
export function toDailyBars(points: [number, number][]): DailyBar[] {
  return points
    .filter(([, c]) => Number.isFinite(c) && c > 0)
    .map(([t, close]) => ({ date: new Date(t).toISOString().slice(0, 10), close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function pct(from: number, to: number) {
  return (to / from - 1) * 100;
}

export function eventReturns(stock: DailyBar[], bench: DailyBar[] | null, eventIso: string, horizons = DEFAULT_HORIZONS,
  now = Date.now()): EventReturns {
  // Der Tagesbalken von heute ist bis Handelsschluss kein Schlusskurs (Anbieter liefern dort den laufenden Kurs).
  const closed = (b: DailyBar) => usCloseTime(b.date) <= now;
  stock = stock.filter(closed);
  bench = bench ? bench.filter(closed) : null;
  const event = Date.parse(eventIso);
  if (!Number.isFinite(event)) return { ok: false, reason: "Kein gültiger Ereigniszeitpunkt." };
  if (stock.length === 0) return { ok: false, reason: "Keine Kursdaten." };
  if (usCloseTime(stock[0].date) > event + 7 * 86400000) {
    return { ok: false, reason: "Die Kursreihe beginnt erst nach dem Ereignis; ein Ausgangspunkt ist nicht belegbar." };
  }
  const i = stock.findIndex((b) => usCloseTime(b.date) > event);
  if (i < 0) return { ok: false, reason: "Seit dem Ereignis gab es noch keinen Handelsschluss." };
  const base = stock[i];
  const benchByDate = new Map((bench ?? []).map((b) => [b.date, b.close]));
  const benchBase = benchByDate.get(base.date);

  const row = (end: DailyBar | undefined, horizon: number): HorizonRow => {
    if (!end) return { horizon, status: "noch_nicht_erreicht", endDate: null, stockPct: null, benchPct: null, excessPp: null };
    const stockPct = pct(base.close, end.close);
    const benchEnd = benchByDate.get(end.date);
    const benchPct = benchBase !== undefined && benchEnd !== undefined ? pct(benchBase, benchEnd) : null;
    return { horizon, status: "ok", endDate: end.date, stockPct, benchPct, excessPp: benchPct === null ? null : stockPct - benchPct };
  };

  const last = stock.length - 1;
  return {
    ok: true,
    base,
    rows: horizons.map((h) => row(stock[i + h], h)),
    latest: { ...row(last > i ? stock[last] : undefined, last - i), tradingDays: last - i },
  };
}
