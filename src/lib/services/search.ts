import { MARKETS } from "../../config/markets.ts";
import { getTickerIndex } from "../sources/sec.ts";
import { normalizeQuery } from "../finance/ranking.ts";
import { getCryptoSnapshot } from "./crypto.ts";

export interface SearchHit {
  kind: "stock" | "crypto" | "market"; key: string; label: string; sublabel: string; href: string;
  currency?: string; symbol?: string; exchange?: string | null;
}

export type SearchScope = "all" | "stock";

export async function search(query: string, limit = 12, scope: SearchScope = "all"): Promise<{ hits: SearchHit[]; issues: string[] }> {
  const q = normalizeQuery(query);
  const issues: string[] = [];
  if (!q) return { hits: [], issues };
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  const hits: { hit: SearchHit; rank: number }[] = [];

  for (const m of scope === "all" ? MARKETS : []) {
    const text = normalizeQuery(`${m.name} ${m.fullName}`);
    if (text.includes(q) || words.some((w) => w.length > 3 && text.includes(w))) {
      hits.push({ rank: 1, hit: { kind: "market", key: m.slug, label: m.fullName, sublabel: m.source ? "Markt" : "Markt · keine Quelle verbunden", href: m.coinId ? `/krypto/${m.coinId}` : m.source ? `/#markt-${m.slug}` : "/datenquellen" } });
    }
  }

  const index = await getTickerIndex();
  if (!index.ok) issues.push(`Aktiensuche: ${index.message}`);
  else {
    for (const l of index.data.list) {
      const t = l.ticker.toLowerCase();
      const name = normalizeQuery(l.name);
      let rank = -1;
      if (t === q || words.includes(t)) rank = 0;
      else if (name.startsWith(q)) rank = 2;
      else if (q.length >= 3 && name.includes(q)) rank = 3;
      else if (words.length > 0 && words.every((w) => name.split(/[\s.,]+/).some((p) => p.startsWith(w))) && words.some((w) => w.length > 3)) rank = 4;
      if (rank >= 0) hits.push({ rank, hit: { kind: "stock", key: l.ticker, label: l.name, sublabel: `Aktie · ${l.ticker} · ${l.exchange ?? "Börse unbekannt"}`, href: `/aktie/${l.ticker}`, currency: "USD", symbol: l.ticker, exchange: l.exchange } });
      if (hits.length > 400) break;
    }
  }

  const snap = scope === "all" ? await getCryptoSnapshot() : null;
  if (snap && !snap.ok) issues.push(`Kryptosuche: ${snap.message}`);
  else if (snap) {
    for (const r of snap.data.rows) {
      const sym = r.symbol.toLowerCase();
      const name = normalizeQuery(r.name);
      let rank = -1;
      if (sym === q || words.includes(sym)) rank = 0.5;
      else if (name.startsWith(q)) rank = 2;
      else if (words.some((w) => w.length > 3 && name.includes(w))) rank = 4;
      if (rank >= 0) hits.push({ rank: rank + (r.marketCapRank ?? 500) / 10000, hit: { kind: "crypto", key: r.id, label: r.name, sublabel: `Krypto · ${r.symbol}`, href: `/krypto/${r.id}`, currency: "EUR", symbol: r.symbol } });
    }
  }

  hits.sort((a, b) => a.rank - b.rank);
  const seen = new Set<string>();
  return { hits: hits.filter(({ hit }) => (seen.has(hit.href) ? false : (seen.add(hit.href), true))).slice(0, limit).map((h) => h.hit), issues };
}
