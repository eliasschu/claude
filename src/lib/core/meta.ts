/**
 * Herkunftsangaben. Drei Zeitpunkte werden streng getrennt und nie
 * gegeneinander ausgetauscht:
 *   observedAt  – Zeitpunkt des Kurses, Messwerts oder Ereignisses
 *   publishedAt – Veroeffentlichung durch die Quelle
 *   fetchedAt   – letzter erfolgreicher Abruf durch Finanzwelt
 * Ein frischer Abruf macht einen alten Kurs nicht aktuell.
 */

export type SourceId =
  | "coingecko" | "sec" | "ecb" | "ecb-press" | "fed-press" | "sec-press"
  | "treasury" | "eia" | "twelvedata" | "calendar";

export type ObservedPrecision = "minute" | "day";

export interface DataMeta {
  sourceId: SourceId;
  source: string;
  sourceUrl?: string;
  observedAt: string | null;
  observedPrecision: ObservedPrecision;
  publishedAt?: string | null;
  fetchedAt: string;
  /** Aktualitaet laut Anbieter, z. B. "Tageswert" oder "15 Minuten verzoegert". */
  freshness: string;
  stale: boolean;
  staleReason?: string;
  /** Pflicht-Namensnennung, falls vorgeschrieben. */
  attribution?: string;
  /** Version der angewandten Berechnung, falls abgeleitet. */
  calcVersion?: string;
}

export type FailureReason = "not_configured" | "unavailable" | "rate_limited" | "not_found" | "invalid";

export type Result<T> =
  | { ok: true; data: T; meta: DataMeta }
  | { ok: false; reason: FailureReason; message: string; sourceId: SourceId };

export const ok = <T>(data: T, meta: DataMeta): Result<T> => ({ ok: true, data, meta });
export const fail = <T = never>(sourceId: SourceId, reason: FailureReason, message: string): Result<T> =>
  ({ ok: false, reason, message, sourceId });

export const FAILURE_TEXT: Record<FailureReason, string> = {
  not_configured: "Datenquelle ist nicht eingerichtet",
  unavailable: "Datenquelle derzeit nicht erreichbar",
  rate_limited: "Abruflimit der Datenquelle erreicht",
  not_found: "Kein Eintrag bei der Datenquelle",
  invalid: "Antwort der Datenquelle war unvollständig",
};

/** Ist der Datenzeitpunkt aelter, als fuer diese Datenart ueblich? */
export function isStale(observedAt: string | null, maxAgeMs: number, now = Date.now()): boolean {
  if (!observedAt) return true;
  const t = Date.parse(observedAt.length === 10 ? `${observedAt}T00:00:00Z` : observedAt);
  return Number.isNaN(t) ? true : now - t > maxAgeMs;
}
