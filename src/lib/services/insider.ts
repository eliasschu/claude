import { daysBetween } from "../core/time.ts";
import { getCompany, getForm4, getTickerIndex } from "../sources/sec.ts";
import type { InsiderCategory } from "../sources/parsers/sec.ts";

export interface InsiderRow {
  id: string; ticker: string; issuerName: string; owner: string; roles: string[];
  table: "direkt" | "derivativ"; security: string; transactionDate: string | null;
  code: string; codeLabel: string; category: InsiderCategory;
  shares: number | null; price: number | null;
  /** Nur wenn Stueckzahl und Preis gemeldet sind – sonst kein Betrag. */
  value: number | null;
  acquired: boolean | null; sharesAfter: number | null; ownership: "direkt" | "indirekt" | null;
  filingDate: string;
  /** Tage zwischen Handel und Veroeffentlichung. */
  delayDays: number | null;
  /** Tage zwischen Veroeffentlichung und heute – wie alt die Information ist. */
  ageDays: number | null;
  amendment: boolean; plan10b51: boolean | null; documentUrl: string;
}

export interface InsiderCluster { ticker: string; issuerName: string; owners: string[] }

export interface InsiderResult { rows: InsiderRow[]; clusters: InsiderCluster[]; issues: { ticker: string; message: string }[]; fetchedAt: string | null }

/** Findet Unternehmen, bei denen mehrere verschiedene Insider am offenen Markt gekauft haben. */
export function findClusters(rows: InsiderRow[], today: string, windowDays = 30): InsiderCluster[] {
  const byCompany = new Map<string, { issuerName: string; owners: Set<string> }>();
  for (const r of rows) {
    if (r.category !== "kauf" || r.table !== "direkt" || !r.transactionDate) continue;
    if ((daysBetween(r.transactionDate, today) ?? 999) > windowDays) continue;
    const e = byCompany.get(r.ticker) ?? { issuerName: r.issuerName, owners: new Set<string>() };
    e.owners.add(r.owner);
    byCompany.set(r.ticker, e);
  }
  return [...byCompany.entries()].filter(([, v]) => v.owners.size >= 2).map(([ticker, v]) => ({ ticker, issuerName: v.issuerName, owners: [...v.owners] }));
}

export async function getInsiderActivity(tickers: string[], days = 90, perCompany = 10, now = new Date()): Promise<InsiderResult> {
  const issues: InsiderResult["issues"] = [];
  const rows: InsiderRow[] = [];
  let fetchedAt: string | null = null;
  const today = now.toISOString().slice(0, 10);
  const index = await getTickerIndex();
  if (!index.ok) return { rows, clusters: [], issues: [{ ticker: "–", message: index.message }], fetchedAt };
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);

  for (const ticker of [...new Set(tickers.map((t) => t.toUpperCase()))]) {
    const listing = index.data.byTicker.get(ticker);
    if (!listing) { issues.push({ ticker, message: "Kein bei der SEC registriertes Wertpapier." }); continue; }
    const company = await getCompany(listing.cik);
    if (!company.ok) { issues.push({ ticker, message: company.message }); continue; }
    fetchedAt = company.meta.fetchedAt;
    const filings = company.data.filings.filter((f) => (f.form === "4" || f.form === "4/A") && f.filingDate >= cutoff).slice(0, perCompany);
    for (const f of filings) {
      try {
        const doc = await getForm4(listing.cik, f.accession, f.primaryDocument, f.filingDate, f.form);
        if (!doc) continue;
        const owner = doc.owners.map((o) => o.name).join(", ") || "Unbekannt";
        const roles = [...new Set(doc.owners.flatMap((o) => o.roles))];
        doc.transactions.forEach((t, i) => rows.push({
          id: `${f.accession}-${i}`, ticker, issuerName: doc.issuerName || company.data.name, owner, roles,
          table: t.table, security: t.security, transactionDate: t.date, code: t.code, codeLabel: t.codeLabel,
          category: t.category, shares: t.shares, price: t.price,
          value: t.shares !== null && t.price !== null ? t.shares * t.price : null,
          acquired: t.acquired, sharesAfter: t.sharesAfter, ownership: t.ownership,
          filingDate: f.filingDate,
          delayDays: t.date ? daysBetween(t.date, f.filingDate) : null,
          ageDays: daysBetween(f.filingDate, today),
          amendment: f.form === "4/A", plan10b51: doc.plan10b51, documentUrl: doc.documentUrl,
        }));
      } catch (error) {
        issues.push({ ticker, message: error instanceof Error ? error.message : "Meldung nicht lesbar" });
        break;
      }
    }
  }
  rows.sort((a, b) => (b.filingDate + (b.transactionDate ?? "")).localeCompare(a.filingDate + (a.transactionDate ?? "")));
  return { rows, clusters: findClusters(rows, today), issues, fetchedAt };
}
