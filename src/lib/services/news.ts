import type { SourceId } from "../core/meta.ts";
import { getCompany, getTickerIndex } from "../sources/sec.ts";
import { getPressFeed, PRESS_FEEDS } from "../sources/press.ts";
import { filingsAsNews } from "./stocks.ts";

export type NewsCategory = "notenbanken" | "politik-regulierung" | "unternehmen";

export const CATEGORY_LABEL: Record<NewsCategory, string> = {
  notenbanken: "Notenbanken", "politik-regulierung": "Politik & Regulierung", unternehmen: "Unternehmen",
};

export interface NewsItem {
  id: string; title: string;
  /** Kurztext der Quelle in Originalsprache; keine eigene Zusammenfassung. */
  summary: string | null;
  url: string; publishedAt: string | null; precision: "minute" | "day";
  sourceId: SourceId; sourceName: string; category: NewsCategory;
  kind: "Behördenmeldung" | "Unternehmensmeldung";
  companies: { ticker: string; name: string }[];
  related: { title: string; url: string; sourceName: string }[];
}

export interface NewsResult {
  items: NewsItem[];
  sources: { sourceId: SourceId; name: string; ok: boolean; message?: string; fetchedAt?: string; stale?: boolean }[];
}

/** Buendelt Meldungen mit nahezu gleichem Titel innerhalb von 48 Stunden. */
export function clusterNews(items: NewsItem[]): NewsItem[] {
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9äöüß ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const out: NewsItem[] = [];
  for (const item of items) {
    const w = words(item.title);
    const match = out.find((o) => {
      if (!o.publishedAt || !item.publishedAt) return false;
      if (Math.abs(Date.parse(o.publishedAt) - Date.parse(item.publishedAt)) > 48 * 3600000) return false;
      const other = words(o.title);
      const inter = [...w].filter((x) => other.has(x)).length;
      const union = new Set([...w, ...other]).size;
      return union > 0 && inter / union >= 0.7;
    });
    if (match) match.related.push({ title: item.title, url: item.url, sourceName: item.sourceName });
    else out.push({ ...item, related: [...item.related] });
  }
  return out;
}

function pressCategory(sourceId: SourceId, categories: string[]): NewsCategory {
  if (sourceId === "ecb-press") return "notenbanken";
  if (sourceId === "fed-press") return categories.some((c) => /monetary/i.test(c)) ? "notenbanken" : "politik-regulierung";
  return "politik-regulierung";
}

export async function getNews(tickers: string[] = [], limit = 60): Promise<NewsResult> {
  const sources: NewsResult["sources"] = [];
  const items: NewsItem[] = [];

  for (const feed of PRESS_FEEDS) {
    const r = await getPressFeed(feed);
    if (!r.ok) { sources.push({ sourceId: feed.sourceId, name: feed.name, ok: false, message: r.message }); continue; }
    sources.push({ sourceId: feed.sourceId, name: feed.name, ok: true, fetchedAt: r.meta.fetchedAt, stale: r.meta.stale });
    for (const it of r.data.items) {
      items.push({
        id: `${feed.sourceId}:${it.guid}`, title: it.title, summary: it.summary, url: it.url,
        publishedAt: it.publishedAt, precision: "minute", sourceId: feed.sourceId, sourceName: feed.name,
        category: pressCategory(feed.sourceId, it.categories), kind: "Behördenmeldung", companies: [], related: [],
      });
    }
  }

  if (tickers.length) {
    const index = await getTickerIndex();
    if (!index.ok) sources.push({ sourceId: "sec", name: "SEC EDGAR – Pflichtmitteilungen", ok: false, message: index.message });
    else {
      let anyOk = false;
      let lastMessage: string | undefined;
      for (const ticker of [...new Set(tickers.map((t) => t.toUpperCase()))].slice(0, 20)) {
        const listing = index.data.byTicker.get(ticker);
        if (!listing) continue;
        const company = await getCompany(listing.cik);
        if (!company.ok) { lastMessage = company.message; continue; }
        anyOk = true;
        for (const f of filingsAsNews(company.data, 30, 6)) {
          items.push({
            id: `sec:${f.id}`, title: `${company.data.name}: ${f.title}`,
            summary: f.form === "8-K" ? `${f.formLabel}. Den vollständigen Inhalt enthält das verlinkte Originaldokument.` : `${f.formLabel}${f.reportDate ? ` für den Berichtszeitraum bis ${f.reportDate}` : ""}.`,
            url: f.url, publishedAt: `${f.filingDate}T00:00:00Z`, precision: "day",
            sourceId: "sec", sourceName: "SEC EDGAR", category: "unternehmen", kind: "Unternehmensmeldung",
            companies: [{ ticker, name: company.data.name }], related: [],
          });
        }
      }
      sources.push({ sourceId: "sec", name: "SEC EDGAR – Pflichtmitteilungen", ok: anyOk, message: anyOk ? undefined : lastMessage });
    }
  }

  items.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return { items: clusterNews(items).slice(0, limit), sources };
}

/** Allgemeine Einordnung je Kategorie – ausdruecklich nicht meldungsspezifisch. */
export const CATEGORY_CONTEXT: Record<NewsCategory, { why: string; affects: string[] }> = {
  notenbanken: {
    why: "Entscheidungen von Notenbanken beeinflussen die Zinserwartungen. Diese wirken auf Anleiherenditen, Wechselkurse und die Bewertung von Aktien, weil künftige Gewinne mit Zinsen abgezinst werden.",
    affects: ["Anleihen", "Devisen", "zinsempfindliche Aktien", "Banken"],
  },
  "politik-regulierung": {
    why: "Aufsichts- und Regulierungsmaßnahmen können Geschäftsmodelle, Kosten und Marktzugang einzelner Branchen verändern.",
    affects: ["Finanzbranche", "betroffene Einzelunternehmen"],
  },
  unternehmen: {
    why: "Pflichtmitteilungen enthalten kursrelevante Ereignisse wie Geschäftszahlen, Personalwechsel oder wesentliche Verträge.",
    affects: ["das meldende Unternehmen"],
  },
};
