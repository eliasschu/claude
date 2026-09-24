/** Zerleger fuer CoinGecko-Antworten. */

export interface CoinRow {
  id: string; symbol: string; name: string; imageUrl: string | null;
  price: number | null; marketCap: number | null; marketCapRank: number | null;
  /** Vollstaendig verwaesserte Bewertung – nie mit marketCap verwechseln. */
  fdv: number | null; volume24h: number | null;
  change1h: number | null; change24h: number | null; change7d: number | null;
  circulatingSupply: number | null; totalSupply: number | null; maxSupply: number | null;
  lastUpdated: string | null; sparkline7d: number[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
type Dict = Record<string, unknown>;
const dict = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/** Reduziert eine Reihe gleichmaessig auf hoechstens `max` Punkte. */
export function downsample(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const step = (values.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => values[Math.round(i * step)]);
}

export function normalizeCoinMarkets(raw: unknown): CoinRow[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: CoinRow[] = [];
  for (const item of raw as Dict[]) {
    if (!item || typeof item.id !== "string" || typeof item.name !== "string" || seen.has(item.id)) continue;
    seen.add(item.id);
    const spark = strListNumbers(dict(item.sparkline_in_7d).price);
    const cap = num(item.market_cap);
    rows.push({
      id: item.id,
      symbol: String(item.symbol ?? "").toUpperCase(),
      name: item.name,
      imageUrl: typeof item.image === "string" ? item.image : null,
      price: num(item.current_price),
      marketCap: cap !== null && cap > 0 ? cap : null,
      marketCapRank: num(item.market_cap_rank),
      fdv: num(item.fully_diluted_valuation),
      volume24h: num(item.total_volume),
      change1h: num(item.price_change_percentage_1h_in_currency),
      change24h: num(item.price_change_percentage_24h_in_currency),
      change7d: num(item.price_change_percentage_7d_in_currency),
      circulatingSupply: num(item.circulating_supply),
      totalSupply: num(item.total_supply),
      maxSupply: num(item.max_supply),
      lastUpdated: typeof item.last_updated === "string" ? item.last_updated : null,
      sparkline7d: downsample(spark, 48),
    });
  }
  return rows;
}

function strListNumbers(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : [];
}

export type SupplyCap = { kind: "begrenzt"; value: number } | { kind: "unbegrenzt" } | { kind: "nicht angegeben" };

export interface CoinDetail {
  id: string; symbol: string; name: string; imageUrl: string | null;
  description: string; descriptionLanguage: "de" | "en" | null; categories: string[];
  homepage: string[]; whitepaper: string | null; explorers: string[]; repositories: string[];
  genesisDate: string | null; contracts: { network: string; address: string }[];
  marketCapRank: number | null; priceEur: number | null; priceUsd: number | null;
  marketCapEur: number | null; fdvEur: number | null; volume24hEur: number | null;
  change1h: number | null; change24h: number | null; change7d: number | null;
  circulatingSupply: number | null; totalSupply: number | null; maxSupply: SupplyCap;
  athEur: number | null; athDate: string | null; lastUpdated: string | null;
}

export function normalizeCoinDetail(raw: unknown): CoinDetail | null {
  const r = dict(raw);
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  const md = dict(r.market_data);
  const links = dict(r.links);
  const desc = dict(r.description);
  const de = typeof desc.de === "string" ? desc.de.trim() : "";
  const en = typeof desc.en === "string" ? desc.en.trim() : "";
  const cur = (field: string, ccy: string) => num(dict(md[field])[ccy]);

  let maxSupply: SupplyCap = { kind: "nicht angegeben" };
  const max = num(md.max_supply);
  if (max !== null && max > 0) maxSupply = { kind: "begrenzt", value: max };
  else if (md.max_supply_infinite === true) maxSupply = { kind: "unbegrenzt" };

  return {
    id: r.id,
    symbol: String(r.symbol ?? "").toUpperCase(),
    name: r.name,
    imageUrl: typeof dict(r.image).large === "string" ? (dict(r.image).large as string) : null,
    description: de || en,
    descriptionLanguage: de ? "de" : en ? "en" : null,
    categories: strList(r.categories),
    homepage: strList(links.homepage),
    whitepaper: typeof links.whitepaper === "string" && links.whitepaper ? links.whitepaper : null,
    explorers: strList(links.blockchain_site),
    repositories: strList(dict(links.repos_url).github),
    genesisDate: typeof r.genesis_date === "string" ? r.genesis_date : null,
    contracts: Object.entries(dict(r.detail_platforms))
      .map(([network, v]) => ({ network, address: String(dict(v).contract_address ?? "") }))
      .filter((c) => c.network !== "" && c.address !== ""),
    marketCapRank: num(r.market_cap_rank),
    priceEur: cur("current_price", "eur"),
    priceUsd: cur("current_price", "usd"),
    marketCapEur: cur("market_cap", "eur"),
    fdvEur: cur("fully_diluted_valuation", "eur"),
    volume24hEur: cur("total_volume", "eur"),
    change1h: cur("price_change_percentage_1h_in_currency", "eur"),
    change24h: cur("price_change_percentage_24h_in_currency", "eur"),
    change7d: cur("price_change_percentage_7d_in_currency", "eur"),
    circulatingSupply: num(md.circulating_supply),
    totalSupply: num(md.total_supply),
    maxSupply,
    athEur: cur("ath", "eur"),
    athDate: typeof dict(md.ath_date).eur === "string" ? (dict(md.ath_date).eur as string) : null,
    lastUpdated: typeof md.last_updated === "string" ? md.last_updated : typeof r.last_updated === "string" ? r.last_updated : null,
  };
}

export type SeriesPoint = [number, number];

export function normalizeMarketChart(raw: unknown): SeriesPoint[] {
  const prices = dict(raw).prices;
  if (!Array.isArray(prices)) return [];
  return prices
    .filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [p[0], p[1]] as SeriesPoint)
    .sort((a, b) => a[0] - b[0]);
}
