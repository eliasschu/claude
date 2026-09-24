import { daysBetween } from "../core/time.ts";
import { usBusinessDaysBetween } from "../core/us-business-days.ts";
import { getCompany, getForm4, getTickerIndex } from "../sources/sec.ts";
import type { InsiderCategory, InsiderTransaction } from "../sources/parsers/sec.ts";
import { formatInsiderName, shortRole } from "../finance/insider-names.ts";
import { assessMateriality, MATERIALITY_THRESHOLDS, type Materiality } from "../finance/insider-materiality.ts";

/** Kategorien ohne marktliche Aussage - werden gespeichert, aber nie in einer Liste angezeigt. */
const NEVER_LISTED: ReadonlySet<InsiderCategory> = new Set(["schenkung", "steuereinbehalt", "erbfall"]);

export interface InsiderFill { shares: number | null; price: number | null; date: string | null }

export interface InsiderRow {
  id: string; ticker: string; issuerName: string;
  owner: string; role: string; roles: string[];
  table: "direkt" | "derivativ"; security: string; transactionDate: string | null;
  code: string; codeLabel: string; category: InsiderCategory;
  shares: number | null; price: number | null;
  /** Nur wenn Stueckzahl und Preis gemeldet sind - sonst kein Betrag. */
  value: number | null;
  acquired: boolean | null; sharesAfter: number | null; ownership: "direkt" | "indirekt" | null;
  /** Anteil dieser Transaktion am Bestand vor der Transaktion (0-1), nur bei direkten Kaeufen/Verkaeufen. */
  shareOfHolding: number | null;
  /** Mehrere Teilausfuehrungen derselben Meldung, gleicher Code/Tag/Wertpapier - Summe steht oben, Details hier. */
  fills: InsiderFill[];
  filingDate: string;
  /** US-Geschaeftstage zwischen Handel und Veroeffentlichung. */
  delayDays: number | null;
  /** Tage zwischen Veroeffentlichung und heute - wie alt die Information ist. */
  ageDays: number | null;
  amendment: boolean; plan10b51: boolean | null; documentUrl: string;
  materiality: Materiality; materialityReason: string;
  /** Nie in einer Liste anzeigen (Schenkung, Steuereinbehalt, Erbfall). */
  hidden: boolean;
}

export interface InsiderCluster { ticker: string; issuerName: string; owners: string[] }

export interface InsiderResult { rows: InsiderRow[]; clusters: InsiderCluster[]; issues: { ticker: string; message: string }[]; fetchedAt: string | null }

/** Nur Zeilen, die auch angezeigt werden duerfen (keine Schenkung/Steuereinbehalt/Erbfall). */
export const visibleRows = (rows: InsiderRow[]): InsiderRow[] => rows.filter((r) => !r.hidden);

/**
 * Findet Unternehmen, bei denen mehrere verschiedene Insider am offenen Markt
 * gekauft haben - und zwar innerhalb eines gemeinsamen Zeitfensters
 * zueinander (nicht relativ zu heute; die Daten sind ueber den Abrufzeitraum
 * ohnehin schon aktuell).
 */
function findBuyClusterKeys(
  raw: { ticker: string; owner: string; category: InsiderCategory; table: "direkt" | "derivativ"; transactionDate: string | null }[],
): { clusters: InsiderCluster[]; ownerDates: Set<string> } {
  const ownerDates = new Set<string>();
  const byTicker = new Map<string, typeof raw>();
  for (const r of raw) {
    if (r.category !== "kauf" || r.table !== "direkt" || !r.transactionDate) continue;
    if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
    byTicker.get(r.ticker)!.push(r);
  }
  const clusters: InsiderCluster[] = [];
  for (const [ticker, group] of byTicker) {
    const sorted = [...group].sort((a, b) => (a.transactionDate ?? "").localeCompare(b.transactionDate ?? ""));
    const span = daysBetween(sorted[0].transactionDate!, sorted[sorted.length - 1].transactionDate!) ?? Infinity;
    const owners = new Set(sorted.map((g) => g.owner));
    if (span <= MATERIALITY_THRESHOLDS.clusterWindowDays && owners.size >= MATERIALITY_THRESHOLDS.clusterMinOwners) {
      clusters.push({ ticker, issuerName: "", owners: [...owners] });
      for (const g of sorted) ownerDates.add(`${g.ticker}|${g.owner}|${g.transactionDate}`);
    }
  }
  return { clusters, ownerDates };
}

function mergeFills(transactions: InsiderTransaction[]): (InsiderTransaction & { fills: InsiderFill[] })[] {
  const groups = new Map<string, InsiderTransaction[]>();
  for (const t of transactions) {
    const key = `${t.table}|${t.code}|${t.date}|${t.security}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return [...groups.values()].map((group) => {
    const totalShares = group.reduce((s, t) => s + (t.shares ?? 0), 0) || null;
    const withPrice = group.filter((t) => t.price !== null && t.shares !== null);
    const weightedPrice = withPrice.length
      ? withPrice.reduce((s, t) => s + t.price! * t.shares!, 0) / withPrice.reduce((s, t) => s + t.shares!, 0)
      : null;
    const last = group[group.length - 1];
    return {
      ...last,
      shares: group.some((t) => t.shares !== null) ? totalShares : null,
      price: weightedPrice,
      fills: group.map((t) => ({ shares: t.shares, price: t.price, date: t.date })),
    };
  });
}

export async function getInsiderActivity(tickers: string[], days = 90, perCompany = 10, now = new Date()): Promise<InsiderResult> {
  const issues: InsiderResult["issues"] = [];
  let fetchedAt: string | null = null;
  const today = now.toISOString().slice(0, 10);
  const index = await getTickerIndex();
  if (!index.ok) return { rows: [], clusters: [], issues: [{ ticker: "–", message: index.message }], fetchedAt };
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);

  const draft: (Omit<InsiderRow, "materiality" | "materialityReason" | "hidden"> & { issuerRaw: string })[] = [];

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
        const owner = doc.owners.map((o) => formatInsiderName(o.name)).join(", ") || "Unbekannt";
        const roles = [...new Set(doc.owners.flatMap((o) => o.roles))];

        // Form 4 meldet eine Optionsausuebung oft doppelt: einmal als Erloeschen des
        // Derivats, einmal als Zugang der zugrunde liegenden Aktien. Wir zeigen nur
        // die reale Aktienbewegung (direkte Tabelle).
        const directExerciseDates = new Set(
          doc.transactions.filter((t) => t.table === "direkt" && t.category === "ausuebung").map((t) => t.date),
        );
        const withoutDuplicateDerivatives = doc.transactions.filter(
          (t) => !(t.table === "derivativ" && t.category === "ausuebung" && directExerciseDates.has(t.date)),
        );
        const merged = mergeFills(withoutDuplicateDerivatives);

        merged.forEach((t, i) => {
          const sharesBefore = t.sharesAfter !== null && t.shares !== null
            ? (t.acquired ? t.sharesAfter - t.shares : t.sharesAfter + t.shares)
            : null;
          const shareOfHolding = t.table === "direkt" && sharesBefore && sharesBefore > 0 && t.shares !== null
            ? t.shares / sharesBefore
            : null;
          draft.push({
            id: `${f.accession}-${i}`, ticker, issuerName: doc.issuerName || company.data.name, issuerRaw: doc.issuerName || company.data.name,
            owner, role: shortRole(roles), roles,
            table: t.table, security: t.security, transactionDate: t.date, code: t.code, codeLabel: t.codeLabel,
            category: t.category, shares: t.shares, price: t.price,
            value: t.shares !== null && t.price !== null ? t.shares * t.price : null,
            acquired: t.acquired, sharesAfter: t.sharesAfter, ownership: t.ownership,
            shareOfHolding, fills: t.fills,
            filingDate: f.filingDate,
            delayDays: t.date ? usBusinessDaysBetween(t.date, f.filingDate) : null,
            ageDays: daysBetween(f.filingDate, today),
            amendment: f.form === "4/A", plan10b51: doc.plan10b51, documentUrl: doc.documentUrl,
          });
        });
      } catch (error) {
        issues.push({ ticker, message: error instanceof Error ? error.message : "Meldung nicht lesbar" });
        break;
      }
    }
  }

  const { clusters, ownerDates } = findBuyClusterKeys(draft);
  const clusterIssuers = new Map<string, string>();
  for (const r of draft) if (clusters.some((c) => c.ticker === r.ticker)) clusterIssuers.set(r.ticker, r.issuerName);
  for (const c of clusters) c.issuerName = clusterIssuers.get(c.ticker) ?? c.issuerName;

  const rows: InsiderRow[] = draft.map((r) => {
    const inBuyCluster = ownerDates.has(`${r.ticker}|${r.owner}|${r.transactionDate}`);
    const { level, reason } = assessMateriality({
      category: r.category, table: r.table, plan10b51: r.plan10b51, value: r.value, shareOfHolding: r.shareOfHolding, inBuyCluster,
    });
    return { ...r, materiality: level, materialityReason: reason, hidden: NEVER_LISTED.has(r.category) };
  });

  rows.sort((a, b) => (b.filingDate + (b.transactionDate ?? "")).localeCompare(a.filingDate + (a.transactionDate ?? "")));
  return { rows, clusters, issues, fetchedAt };
}
