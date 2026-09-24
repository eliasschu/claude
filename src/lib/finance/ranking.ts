/**
 * Ranglisten: Suche, Filter, Sortierung und Seitenaufteilung ueber den
 * gesamten Datensatz eines festen Datenstands. Der Groessenrang bleibt bei
 * jeder anderen Sortierung als eigene Angabe erhalten.
 */

export type SortKey = "marketCap" | "change24h" | "change7d" | "volume24h";
export type SortDir = "asc" | "desc";

export const PAGE_SIZE = 100;

export interface RankedItem<T> { item: T; sizeRank: number; position: number }
export interface PageResult<T> { items: RankedItem<T>[]; page: number; pages: number; total: number; from: number; to: number }

export interface RankingInput<T> {
  rows: T[];
  query: string;
  filter: (row: T) => boolean;
  sort: SortKey;
  dir: SortDir;
  page: number;
  getValue: (row: T, key: SortKey) => number | null;
  getText: (row: T) => string;
}

export function normalizeQuery(q: string): string {
  return q.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();
}

export function rankRows<T>(input: RankingInput<T>): PageResult<T> {
  const sized = input.rows.map((item, index) => ({ item, sizeRank: index + 1 }));
  const q = normalizeQuery(input.query);
  const matched = sized.filter(({ item }) => input.filter(item) && (!q || normalizeQuery(input.getText(item)).includes(q)));

  const sorted =
    input.sort === "marketCap" && input.dir === "desc"
      ? matched
      : [...matched].sort((a, b) => {
          const va = input.getValue(a.item, input.sort);
          const vb = input.getValue(b.item, input.sort);
          // Fehlende Werte stehen immer am Ende, unabhaengig von der Richtung.
          if (va === null && vb === null) return a.sizeRank - b.sizeRank;
          if (va === null) return 1;
          if (vb === null) return -1;
          const diff = input.dir === "asc" ? va - vb : vb - va;
          return diff !== 0 ? diff : a.sizeRank - b.sizeRank;
        });

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(input.page) || 1), pages);
  const start = (page - 1) * PAGE_SIZE;
  const items = sorted.slice(start, start + PAGE_SIZE).map((r, i) => ({ ...r, position: start + i + 1 }));
  return { items, page, pages, total, from: total === 0 ? 0 : start + 1, to: start + items.length };
}
