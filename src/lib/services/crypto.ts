import { fail, ok, type DataMeta, type Result } from "../core/meta.ts";
import { getCategoryList, getCategoryMembers, getCoinChart, getCoinDetail, getTopCoins } from "../sources/coingecko.ts";
import type { CoinDetail, CoinRow, SeriesPoint } from "../sources/parsers/coingecko.ts";
import { assessCoin, coinProfile, cryptoMetrics, type CoinProfile, type CoinTag, type CryptoAssessment, type CryptoMetrics } from "../finance/crypto.ts";
import { rankRows, type PageResult, type SortDir, type SortKey } from "../finance/ranking.ts";

const TAG_CATEGORIES: Record<CoinTag, string> = { stablecoin: "stablecoins", wrapped: "wrapped-tokens", "liquid-staking": "liquid-staking-tokens" };

export const FILTERS = {
  alle: { label: "Alle", category: null },
  "ohne-stablecoins": { label: "Ohne Stablecoins", category: null },
  "layer-1": { label: "Layer 1", category: "layer-1" },
  defi: { label: "DeFi", category: "decentralized-finance-defi" },
  infrastruktur: { label: "Infrastruktur", category: "infrastructure" },
  meme: { label: "Meme-Token", category: "meme-token" },
} as const;
export type FilterKey = keyof typeof FILTERS;

export interface CryptoSnapshot {
  stand: string; rows: CoinRow[]; tags: Map<string, CoinTag[]>; meta: DataMeta;
  availableFilters: FilterKey[]; observedFrom: string | null; observedTo: string | null;
}

const snapshots = new Map<string, CryptoSnapshot>();

/** Fester Datenstand fuer das Blaettern; neue Daten ergeben einen neuen Stand. */
export async function getCryptoSnapshot(stand?: string): Promise<Result<CryptoSnapshot & { replaced: boolean }>> {
  if (stand && snapshots.has(stand)) return ok({ ...snapshots.get(stand)!, replaced: false }, snapshots.get(stand)!.meta);
  const top = await getTopCoins(500);
  if (!top.ok) return top;
  const id = `${Date.parse(top.meta.fetchedAt).toString(36)}-${top.data.rows.length}`;
  const existing = snapshots.get(id);
  if (existing) return ok({ ...existing, replaced: !!stand && stand !== id }, existing.meta);

  const list = await getCategoryList();
  const known = list.ok ? list.data : null;
  const tags = new Map<string, CoinTag[]>();
  for (const [tag, category] of Object.entries(TAG_CATEGORIES) as [CoinTag, string][]) {
    if (known && !known.has(category)) continue;
    const members = await getCategoryMembers(category);
    if (!members.ok) continue;
    for (const coinId of members.data) tags.set(coinId, [...(tags.get(coinId) ?? []), tag]);
  }
  const availableFilters = (Object.keys(FILTERS) as FilterKey[]).filter((k) => {
    if (k === "ohne-stablecoins") return [...tags.values()].some((t) => t.includes("stablecoin"));
    const c = FILTERS[k].category;
    return c === null || (known ? known.has(c) : false);
  });
  const snapshot: CryptoSnapshot = { stand: id, rows: top.data.rows, tags, meta: top.meta, availableFilters, observedFrom: top.data.observedFrom, observedTo: top.data.observedTo };
  snapshots.set(id, snapshot);
  for (const key of [...snapshots.keys()].slice(0, Math.max(0, snapshots.size - 4))) snapshots.delete(key);
  return ok({ ...snapshot, replaced: !!stand && stand !== id }, top.meta);
}

export interface RankingParams { page: number; q: string; filter: FilterKey; sort: SortKey; dir: SortDir; stand?: string }
export interface CryptoRankingRow { row: CoinRow; tags: CoinTag[]; profile: CoinProfile }

export async function getCryptoRanking(p: RankingParams): Promise<Result<{ page: PageResult<CryptoRankingRow>; snapshot: CryptoSnapshot; replaced: boolean; filterNote?: string }>> {
  const snap = await getCryptoSnapshot(p.stand);
  if (!snap.ok) return snap;
  const s = snap.data;
  let members: Set<string> | null = null;
  let filterNote: string | undefined;
  const cat = FILTERS[p.filter]?.category ?? null;
  if (cat) {
    const m = await getCategoryMembers(cat);
    if (m.ok) { members = m.data; filterNote = "Kategoriezuordnung laut CoinGecko; berücksichtigt sind die 250 größten Werte der Kategorie."; }
    else filterNote = `Filter derzeit nicht verfügbar: ${m.message}`;
  }
  const rows: CryptoRankingRow[] = s.rows.map((row) => {
    const tags = s.tags.get(row.id) ?? [];
    return { row, tags, profile: coinProfile(row, tags) };
  });
  const page = rankRows({
    rows, query: p.q, page: p.page, sort: p.sort, dir: p.dir,
    filter: (r) => (p.filter === "ohne-stablecoins" ? !r.tags.includes("stablecoin") : members ? members.has(r.row.id) : true),
    getText: (r) => `${r.row.name} ${r.row.symbol} ${r.row.id}`,
    getValue: (r, k) => (k === "marketCap" ? r.row.marketCap : k === "change24h" ? r.row.change24h : k === "change7d" ? r.row.change7d : r.row.volume24h),
  });
  return ok({ page, snapshot: s, replaced: snap.data.replaced, filterNote }, s.meta);
}

export interface CryptoDetailView {
  detail: CoinDetail; detailMeta: DataMeta; tags: CoinTag[];
  charts: { intraday: SeriesPoint[] | null; hourly: SeriesPoint[] | null; daily: SeriesPoint[] | null };
  chartIssues: string[]; metrics: CryptoMetrics; assessment: CryptoAssessment;
}

export async function getCryptoDetail(id: string): Promise<Result<CryptoDetailView>> {
  const detail = await getCoinDetail(id);
  if (!detail.ok) return detail;
  const intraday = await getCoinChart(id, 1);
  const hourly = await getCoinChart(id, 90);
  const daily = await getCoinChart(id, 365);
  const snap = await getCryptoSnapshot();
  const d = detail.data;
  const tags: CoinTag[] = snap.ok
    ? snap.data.tags.get(id) ?? []
    : d.categories.some((c) => /stablecoin/i.test(c)) ? ["stablecoin"] : [];
  const metrics = cryptoMetrics({
    daily: daily.ok ? daily.data.map((p) => p[1]) : [],
    marketCap: d.marketCapEur, fdv: d.fdvEur, volume24h: d.volume24hEur, circulating: d.circulatingSupply,
    maxSupply: d.maxSupply.kind === "begrenzt" ? d.maxSupply.value : null,
    priceUsd: d.priceUsd, isStablecoin: tags.includes("stablecoin"),
  });
  return ok({
    detail: d, detailMeta: detail.meta, tags,
    charts: { intraday: intraday.ok ? intraday.data : null, hourly: hourly.ok ? hourly.data : null, daily: daily.ok ? daily.data : null },
    chartIssues: [intraday, hourly, daily].filter((c) => !c.ok).map((c) => (c.ok ? "" : c.message)),
    metrics, assessment: assessCoin(metrics, tags),
  }, detail.meta);
}

export { fail as cryptoFail };
