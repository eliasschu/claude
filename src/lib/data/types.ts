/**
 * Kleine, geteilte Oberflaechen-Typen. Die einzelnen Seiten sprechen sonst
 * direkt mit den echten Diensten unter `lib/services/*` – es gibt keine
 * zusaetzliche Demo-Abstraktionsschicht mehr.
 */

import type { DataMeta as CoreDataMeta } from "../core/meta.ts";
import type { NewsResult } from "../services/news.ts";

/**
 * Anzeige-Herkunftszeile. `mode` und `quality` sind einfache, offengelegte
 * Ableitungen aus den echten Metadaten (Alter, Praezision) – keine
 * zusaetzliche, unbelegte Genauigkeitsangabe.
 */
export interface UiDataMeta {
  mode: "realtime" | "delayed" | "close";
  asOf: string | null;
  timezone: string;
  source: string;
  sourceUrl?: string;
  quality: number;
}

const REALTIME_SOURCES = new Set(["twelvedata", "coingecko"]);

/** Rechnet die echten Anbieter-Metadaten in die Anzeigeform um. */
export function toUiMeta(meta: CoreDataMeta): UiDataMeta {
  const quality = meta.stale ? 35 : meta.observedAt ? 90 : 55;
  return {
    mode: meta.stale ? "delayed" : REALTIME_SOURCES.has(meta.sourceId) ? "realtime" : "close",
    asOf: meta.observedAt ?? meta.fetchedAt,
    timezone: "Europe/Vienna",
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    quality,
  };
}

export interface Candle {
  date: string;
  close: number;
}

/** Fasst die Quellen eines Nachrichtenabrufs zu einer Herkunftszeile zusammen. */
export function newsToUiMeta(result: NewsResult): UiDataMeta {
  const ok = result.sources.filter((s) => s.ok && s.fetchedAt);
  const failed = result.sources.filter((s) => !s.ok);
  const latest = ok.map((s) => s.fetchedAt as string).sort().at(-1) ?? null;
  const names = result.sources.map((s) => s.name).join(", ");
  return {
    mode: "delayed",
    asOf: latest,
    timezone: "Europe/Vienna",
    source: failed.length > 0 ? `${names} (${failed.length} Quelle${failed.length === 1 ? "" : "n"} derzeit nicht erreichbar)` : names,
    quality: ok.length === 0 ? 20 : failed.length > 0 ? 55 : 85,
  };
}
