import { MARKETS, type MarketDefinition } from "../../config/markets.ts";
import type { DataMeta, FailureReason } from "../core/meta.ts";
import { getBrent, getEurUsd, getUs10y, type DailySeries } from "../sources/macro.ts";
import { getCryptoSnapshot } from "./crypto.ts";

export interface MarketCard {
  def: MarketDefinition; status: "ok" | "unavailable";
  value: number | null; changeAbs: number | null; changePct: number | null;
  /** Nur bei Renditen: Veraenderung in Basispunkten. */
  changeBp: number | null;
  changeLabel: string; spark: number[]; sparkLabel: string; meta: DataMeta | null; tradingNote: string;
  failure?: { reason: FailureReason; message: string };
}

export function cardFromDaily(def: MarketDefinition, series: DailySeries, meta: DataMeta, tradingNote: string): MarketCard {
  const last = series.points.at(-1)!;
  const prev = series.points.at(-2);
  const isYield = def.kind === "rendite";
  return {
    def, status: "ok", value: last.value,
    changeAbs: prev ? last.value - prev.value : null,
    changePct: prev && !isYield ? (last.value / prev.value - 1) * 100 : null,
    changeBp: prev && isYield ? Math.round((last.value - prev.value) * 100) : null,
    changeLabel: prev ? `gegenüber dem Vorwert vom ${prev.date.split("-").reverse().join(".")}` : "kein Vorwert",
    spark: series.points.slice(-30).map((p) => p.value), sparkLabel: "letzte 30 Tageswerte",
    meta, tradingNote,
  };
}

const unavailable = (def: MarketDefinition, reason: FailureReason, message: string): MarketCard => ({
  def, status: "unavailable", value: null, changeAbs: null, changePct: null, changeBp: null,
  changeLabel: "", spark: [], sparkLabel: "", meta: null, tradingNote: "", failure: { reason, message },
});

export async function getMarketCard(def: MarketDefinition): Promise<MarketCard> {
  if (def.source === null) return unavailable(def, "not_configured", def.missingNote ?? "Keine Quelle verbunden.");
  if (def.source === "coingecko") {
    const snap = await getCryptoSnapshot();
    if (!snap.ok) return unavailable(def, snap.reason, snap.message);
    const row = snap.data.rows.find((r) => r.id === def.coinId);
    if (!row || row.price === null) return unavailable(def, "not_found", "Wert nicht im Datensatz des Anbieters.");
    const pct = row.change24h;
    return {
      def, status: "ok", value: row.price,
      changeAbs: pct !== null ? row.price - row.price / (1 + pct / 100) : null,
      changePct: pct, changeBp: null, changeLabel: "über 24 Stunden (rollierend)",
      spark: row.sparkline7d, sparkLabel: "letzte 7 Tage",
      meta: { ...snap.data.meta, observedAt: row.lastUpdated, sourceUrl: `https://www.coingecko.com/en/coins/${row.id}` },
      tradingNote: "Handel rund um die Uhr",
    };
  }
  const load = def.source === "ecb" ? getEurUsd : def.source === "treasury" ? getUs10y : def.source === "eia" ? getBrent : null;
  if (!load) return unavailable(def, "not_configured", "Keine Quelle verbunden.");
  const r = await load();
  if (!r.ok) return unavailable(def, r.reason, r.message);
  const note = def.source === "ecb" ? "Referenzkurs an TARGET-Geschäftstagen" : def.source === "treasury" ? "Tageswert an US-Geschäftstagen" : "Tageswert, verzögert veröffentlicht";
  return cardFromDaily(def, r.data, r.meta, note);
}

export async function getMarketOverview(): Promise<MarketCard[]> {
  const cards: MarketCard[] = [];
  for (const def of MARKETS) cards.push(await getMarketCard(def));
  return cards;
}

export async function getMarketSeries(def: MarketDefinition): Promise<{ series: DailySeries; meta: DataMeta } | null> {
  const load = def.source === "ecb" ? getEurUsd : def.source === "treasury" ? getUs10y : def.source === "eia" ? getBrent : null;
  if (!load) return null;
  const r = await load();
  return r.ok ? { series: r.data, meta: r.meta } : null;
}
