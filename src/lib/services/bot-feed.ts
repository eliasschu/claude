/**
 * Bot-Meldungen fuer die Startseite.
 *
 * Heute oeffentlich: Erkennung aus SEC-Insidermeldungen (Form 4) fuer die
 * Beobachtungsliste. Auswahl und Reihenfolge folgen festen, hier sichtbaren
 * Regeln - keine redaktionelle Auswahl, keine Beispiel- oder Demodaten.
 * Signale der internen Marktsignal-Engine (services/quant) erscheinen hier
 * bewusst NICHT, solange sie nur im Research-/Paper-Betrieb laufen.
 */

import type { InsiderCluster, InsiderResult, InsiderRow } from "./insider.ts";
import { daysBetween } from "../core/time.ts";
import { formatCompact } from "../finance/format.ts";

export type BotMessageKind = "insider_cluster" | "insider_buy" | "insider_sale";

export const MESSAGE_KIND_LABEL: Record<BotMessageKind, string> = {
  insider_cluster: "Mehrere Insider kaufen",
  insider_buy: "Insiderkauf",
  insider_sale: "Insiderverkauf",
};

export interface BotMessage {
  id: string;
  kind: BotMessageKind;
  ticker: string;
  issuerName: string;
  /** Was ist passiert? */
  title: string;
  /** Warum ist es relevant? */
  relevance: string;
  /** Welche Unsicherheit besteht? */
  uncertainty: string;
  /** Handelstag(e) laut Meldung - nicht der Veroeffentlichungszeitpunkt. */
  tradedFrom: string | null;
  tradedTo: string | null;
  /** Veroeffentlichung bei der SEC (Tagesgenauigkeit). */
  publishedAt: string;
  /** archiv: erster Erkennungszeitpunkt aus dem unveraenderlichen Meldungsarchiv. live: Zeitpunkt des Datenabrufs dieser Seite. */
  detectedAt: string | null;
  origin: "archiv" | "live";
  value: number | null;
  sources: { label: string; url: string }[];
  /** Offengelegter Auswahlgrund, keine Wahrscheinlichkeit. */
  selection: string;
}

export const FEED_RULES = {
  /** Nur Meldungen, die hoechstens so viele Tage alt sind (Veroeffentlichung). */
  maxAgeDays: 14,
  /** Hoechstens so viele Karten. */
  limit: 5,
  /** Rangfolge der Arten; bei Gleichstand zaehlt der Betrag, dann die Aktualitaet. */
  kindRank: { insider_cluster: 3, insider_buy: 2, insider_sale: 1 } as Record<BotMessageKind, number>,
};

const UNCERTAINTY = {
  buy: "Ein Insiderkauf zeigt, wie eine Person mit Einblick handelt, nicht, wie sich der Kurs entwickelt. Der Grund muss nicht gemeldet werden. Die Einordnung beruht auf den Formular-Codes und Fußnoten der Meldung.",
  sale: "Verkäufe haben häufig persönliche Gründe (Steuern, Streuung, Liquidität) und sind deshalb weniger aussagekräftig als Käufe. Ein Grund muss nicht gemeldet werden.",
  cluster: "Mehrere Käufe in kurzer Zeit sind auffälliger als ein einzelner, belegen aber keine Kursentwicklung. Die Personen können sich abgesprochen haben oder aus ähnlichen persönlichen Gründen handeln.",
  planUnknown: " Ob ein vorab festgelegter Handelsplan (Rule 10b5-1) besteht, geht aus der Meldung nicht hervor.",
};

const pct = (v: number) => `${(v * 100).toFixed(0)}\u00a0%`;
/** Betrag ohne Zeilenumbruch zwischen Zahl, Einheit und Waehrung. */
const money = (v: number) => formatCompact(v, "USD").replace(/ /g, "\u00a0");

function tradeRange(rows: InsiderRow[]): { from: string | null; to: string | null } {
  const dates = rows.map((r) => r.transactionDate).filter((d): d is string => !!d).sort();
  return { from: dates[0] ?? null, to: dates.at(-1) ?? null };
}

function sumValue(rows: InsiderRow[]): number | null {
  const withValue = rows.filter((r) => r.value !== null);
  return withValue.length ? withValue.reduce((s, r) => s + r.value!, 0) : null;
}

function uniqueSources(rows: InsiderRow[]): { label: string; url: string }[] {
  const seen = new Set<string>();
  const out: { label: string; url: string }[] = [];
  for (const r of rows) {
    if (seen.has(r.documentUrl)) continue;
    seen.add(r.documentUrl);
    out.push({ label: `SEC Form ${r.amendment ? "4/A" : "4"} · ${r.owner}`, url: r.documentUrl });
  }
  return out;
}

function clusterMessage(c: InsiderCluster, rows: InsiderRow[], detectedAt: string | null): BotMessage {
  const { from, to } = tradeRange(rows);
  const value = sumValue(rows);
  const span = from && to ? daysBetween(from, to) ?? 0 : 0;
  const publishedAt = rows.map((r) => r.filingDate).sort().at(-1)!;
  const noPlan = rows.every((r) => r.plan10b51 !== true);
  return {
    id: `cluster-${c.ticker}-${from ?? publishedAt}`,
    kind: "insider_cluster",
    ticker: c.ticker,
    issuerName: c.issuerName,
    title: `${c.owners.length} Insider von ${c.issuerName} kaufen innerhalb von ${span + 1} ${span === 0 ? "Tag" : "Tagen"}${value !== null ? ` für zusammen ${money(value)}` : ""}`,
    relevance: `Käufe am offenen Markt durch ${c.owners.join(", ")}.${noPlan ? " Keine der Meldungen verweist auf einen vorab festgelegten Plan." : ""} Mehrere Personen mit Einblick in dasselbe Unternehmen setzen eigenes Geld ein.`,
    uncertainty: UNCERTAINTY.cluster,
    tradedFrom: from, tradedTo: to, publishedAt, detectedAt, origin: "live", value,
    sources: uniqueSources(rows),
    selection: `Mehrere Insider (${c.owners.length}) mit Käufen innerhalb von 14 Tagen.`,
  };
}

function singleMessage(rows: InsiderRow[], detectedAt: string | null): BotMessage {
  const first = rows[0];
  const buy = first.category === "kauf";
  const { from, to } = tradeRange(rows);
  const value = sumValue(rows);
  const publishedAt = rows.map((r) => r.filingDate).sort().at(-1)!;
  const share = rows.length === 1 ? first.shareOfHolding : null;
  const planUnknown = rows.some((r) => r.plan10b51 === null);
  const relevanceParts = [first.materialityReason];
  if (share !== null && share >= 0.05) relevanceParts.push(`Das entspricht ${pct(share)} des zuvor gemeldeten Bestands der Person.`);
  if (first.sharesAfter !== null) relevanceParts.push(`Danach hält die Person ${formatCompact(first.sharesAfter)} Aktien.`);
  return {
    id: `${buy ? "buy" : "sale"}-${first.ticker}-${first.owner}-${publishedAt}`,
    kind: buy ? "insider_buy" : "insider_sale",
    ticker: first.ticker,
    issuerName: first.issuerName,
    title: `${first.owner} (${first.role}) ${buy ? "kauft" : "verkauft"} ${first.ticker}-Aktien${value !== null ? ` für ${money(value)}` : ""}`,
    relevance: relevanceParts.join(" "),
    uncertainty: (buy ? UNCERTAINTY.buy : UNCERTAINTY.sale) + (planUnknown ? UNCERTAINTY.planUnknown : ""),
    tradedFrom: from, tradedTo: to, publishedAt, detectedAt, origin: "live", value,
    sources: uniqueSources(rows),
    selection: `Aussagekraft ${first.materiality} nach den Insider-Regeln.`,
  };
}

/**
 * Waehlt hoechstens `limit` aktuelle Meldungen nach festen Regeln:
 *  1. Nur Kaeufe/Verkaeufe am offenen Markt mit Aussagekraft "hoch" oder "mittel",
 *     veroeffentlicht in den letzten `maxAgeDays` Tagen.
 *  2. Cluster-Kaeufe werden zu EINER Meldung je Unternehmen zusammengefasst.
 *  3. Mehrere Zeilen derselben Person, Firma und Richtung werden zusammengefasst.
 *  4. Rangfolge: Art (Cluster > Kauf > Verkauf), dann Betrag, dann Veroeffentlichung.
 * Gibt es weniger passende Ereignisse, kommen weniger Meldungen zurueck.
 */
export function selectBotMessages(activity: Pick<InsiderResult, "rows" | "clusters" | "fetchedAt">, limit = FEED_RULES.limit): BotMessage[] {
  const eligible = activity.rows.filter((r) =>
    !r.hidden
    && r.table === "direkt"
    && (r.category === "kauf" || r.category === "verkauf")
    && (r.materiality === "hoch" || r.materiality === "mittel")
    && r.ageDays !== null && r.ageDays <= FEED_RULES.maxAgeDays);

  const messages: BotMessage[] = [];
  const used = new Set<InsiderRow>();

  for (const c of activity.clusters) {
    const members = eligible.filter((r) => r.ticker === c.ticker && r.category === "kauf" && c.owners.includes(r.owner));
    if (new Set(members.map((m) => m.owner)).size < 2) continue;
    members.forEach((m) => used.add(m));
    messages.push(clusterMessage(c, members, activity.fetchedAt));
  }

  const groups = new Map<string, InsiderRow[]>();
  for (const r of eligible) {
    if (used.has(r)) continue;
    const key = `${r.ticker}|${r.owner}|${r.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  for (const rows of groups.values()) messages.push(singleMessage(rows, activity.fetchedAt));

  return rankMessages(messages, limit);
}

/** Rangfolge: Art (Cluster > Kauf > Verkauf), dann Betrag, dann Veroeffentlichung. */
export function rankMessages(messages: BotMessage[], limit = FEED_RULES.limit): BotMessage[] {
  return [...messages]
    .sort((a, b) =>
      FEED_RULES.kindRank[b.kind] - FEED_RULES.kindRank[a.kind]
      || (b.value ?? 0) - (a.value ?? 0)
      || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}

/** Eine Zeile aus dem Meldungsarchiv der Bot-API (GET /messages). */
export interface ArchivedMessage {
  message_id: string; kind: BotMessageKind; ticker: string | null; issuer_cik: string; issuer_name: string | null;
  title: string; relevance: string; uncertainty: string; counter_arguments: string[];
  sources: { label: string; url: string }[]; selection: string; value_usd: number | null;
  traded_from: string | null; traded_to: string | null; published_at: string; detected_at: string;
}

/**
 * Meldungen aus dem Archiv: dieselben Auswahlregeln (Alter nach Veroeffentlichung, Rangfolge, Limit),
 * aber mit festem, erstem Erkennungszeitpunkt.
 */
export function fromArchive(rows: ArchivedMessage[], now = new Date(), limit = FEED_RULES.limit): BotMessage[] {
  const cutoff = now.getTime() - FEED_RULES.maxAgeDays * 86400000;
  const known = new Set<BotMessageKind>(["insider_cluster", "insider_buy", "insider_sale"]);
  return rankMessages(rows
    .filter((r) => known.has(r.kind) && Date.parse(r.published_at) >= cutoff)
    .map((r) => ({
      id: r.message_id, kind: r.kind, ticker: r.ticker ?? r.issuer_cik, issuerName: r.issuer_name ?? `CIK ${r.issuer_cik}`,
      title: r.title, relevance: r.relevance, uncertainty: r.uncertainty,
      tradedFrom: r.traded_from, tradedTo: r.traded_to, publishedAt: r.published_at, detectedAt: r.detected_at,
      origin: "archiv" as const, value: r.value_usd, sources: r.sources, selection: r.selection,
    })), limit);
}
