/**
 * Kleine, geteilte Oberflaechen-Typen. Die einzelnen Seiten sprechen sonst
 * direkt mit den echten Diensten unter `lib/services/*` – es gibt keine
 * zusaetzliche Demo-Abstraktionsschicht mehr.
 */

import type { DataMeta as CoreDataMeta } from "../core/meta.ts";
import { classifyFreshness, type Freshness, type FreshnessInput } from "../core/freshness.ts";
import { APP_TIMEZONE } from "../core/time.ts";
import type { NewsResult } from "../services/news.ts";

/**
 * Anzeige-Herkunftszeile. Traegt die echten Zeitangaben und die daraus
 * abgeleitete Aktualitaetsklasse - keine zusaetzliche, unbelegte
 * "Qualitaetsnote".
 */
export interface UiDataMeta {
  /** Eingaben fuer die Aktualitaetsklasse; der Browser rechnet das Alter beim Ansehen neu. */
  freshnessInput: FreshnessInput;
  /** Einstufung zum Zeitpunkt der Serverdarstellung. */
  freshness: Freshness;
  asOf: string | null;
  timezone: string;
  source: string;
  sourceUrl?: string;
}

/** Rechnet die echten Anbieter-Metadaten in die Anzeigeform um. */
export function toUiMeta(meta: CoreDataMeta, now = Date.now()): UiDataMeta {
  const freshnessInput: FreshnessInput = {
    sourceId: meta.sourceId, observedAt: meta.observedAt, observedPrecision: meta.observedPrecision,
    stale: meta.stale, staleReason: meta.staleReason, cadence: meta.cadence, sessionClosed: meta.sessionClosed,
  };
  return {
    freshnessInput,
    freshness: classifyFreshness(freshnessInput, now),
    asOf: meta.observedAt,
    timezone: APP_TIMEZONE,
    source: meta.source,
    sourceUrl: meta.sourceUrl,
  };
}

export interface Candle {
  date: string;
  close: number;
}

/**
 * Fasst die Quellen eines Nachrichtenabrufs zu einer Herkunftszeile zusammen.
 * Meldungen gelten ab Veroeffentlichung; "Stand" ist die juengste Meldung.
 */
export function newsToUiMeta(result: NewsResult, now = Date.now()): UiDataMeta {
  const ok = result.sources.filter((s) => s.ok && s.fetchedAt);
  const failed = result.sources.filter((s) => !s.ok);
  const latestItem = result.items.map((i) => i.publishedAt).filter((t): t is string => !!t).sort().at(-1) ?? null;
  const names = result.sources.map((s) => s.name).join(", ");
  const freshnessInput: FreshnessInput = {
    sourceId: result.sources[0]?.sourceId ?? "sec-press",
    observedAt: ok.length === 0 ? null : latestItem,
    observedPrecision: "minute",
    stale: ok.length > 0 && ok.every((s) => s.stale),
    staleReason: "Alle Quellen liefern derzeit nur den letzten erfolgreich abgerufenen Stand.",
    cadence: "event",
  };
  return {
    freshnessInput,
    freshness: classifyFreshness(freshnessInput, now),
    asOf: freshnessInput.observedAt,
    timezone: APP_TIMEZONE,
    source: failed.length > 0 ? `${names} (${failed.length} Quelle${failed.length === 1 ? "" : "n"} derzeit nicht erreichbar)` : names,
  };
}
