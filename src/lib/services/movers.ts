import { STOCK_MOVER_UNIVERSE } from "../../config/movers.ts";
import { findListing } from "./stocks.ts";
import { getStockQuote } from "../sources/twelvedata.ts";
import { getCryptoSnapshot } from "./crypto.ts";
import type { DataMeta } from "../core/meta.ts";

export interface MoverRow {
  kind: "aktie" | "krypto";
  symbol: string;
  name: string;
  href: string;
  price: number;
  currency: string;
  changePct: number;
  volume: number | null;
  /** Tagesvolumen als Vielfaches der Marktkapitalisierung – nur bei Krypto sinnvoll, sonst null. */
  volumeShareOfMarketCap: number | null;
}

export interface MoversResult {
  rows: MoverRow[];
  meta: DataMeta | null;
  stockIssues: string[];
}

/**
 * Groesste Bewegungen ueber die kuratierte Aktienauswahl (siehe config/movers.ts)
 * und die vollstaendige CoinGecko-Top-500-Kryptoliste, gemeinsam nach
 * Betrag der Tagesveraenderung sortiert.
 */
export async function getTopMovers(limit = 20): Promise<MoversResult> {
  const rows: MoverRow[] = [];
  const stockIssues: string[] = [];
  let meta: DataMeta | null = null;

  for (const ticker of STOCK_MOVER_UNIVERSE) {
    const [listing, quote] = await Promise.all([findListing(ticker), getStockQuote(ticker)]);
    if (!quote.ok) { stockIssues.push(`${ticker}: ${quote.message}`); continue; }
    if (!meta || Date.parse(quote.meta.fetchedAt) > Date.parse(meta.fetchedAt)) meta = quote.meta;
    if (quote.data.price === null || quote.data.changePct === null) continue;
    rows.push({
      kind: "aktie",
      symbol: ticker,
      name: listing.ok ? listing.data.name : ticker,
      href: `/aktie/${ticker}`,
      price: quote.data.price,
      currency: quote.data.currency ?? "USD",
      changePct: quote.data.changePct,
      volume: quote.data.volume,
      volumeShareOfMarketCap: null,
    });
  }

  const snap = await getCryptoSnapshot();
  if (snap.ok) {
    if (!meta || Date.parse(snap.data.meta.fetchedAt) > Date.parse(meta.fetchedAt)) meta = snap.data.meta;
    const stableIds = new Set(
      [...snap.data.tags.entries()].filter(([, tags]) => tags.includes("stablecoin")).map(([id]) => id),
    );
    for (const row of snap.data.rows) {
      if (stableIds.has(row.id) || row.price === null || row.change24h === null) continue;
      rows.push({
        kind: "krypto",
        symbol: row.symbol,
        name: row.name,
        href: `/krypto/${row.id}`,
        price: row.price,
        currency: "EUR",
        changePct: row.change24h,
        volume: row.volume24h,
        volumeShareOfMarketCap: row.marketCap && row.volume24h ? (row.volume24h / row.marketCap) * 100 : null,
      });
    }
  } else {
    stockIssues.push(`Krypto: ${snap.message}`);
  }

  rows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  return { rows: rows.slice(0, limit), meta, stockIssues };
}
