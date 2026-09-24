import { child, childrenNamed, findAll, parseXml, textOf, type XmlNode } from "../../core/xml.ts";
import { safeHttpUrl, toPlainText } from "../../core/sanitize.ts";

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string | null;
  categories: string[];
  guid: string;
}

function linkOf(entry: XmlNode): string | null {
  const direct = textOf(child(entry, "link"));
  if (direct) return safeHttpUrl(direct);
  for (const l of childrenNamed(entry, "link")) {
    const href = l.attrs.href;
    if (href) return safeHttpUrl(href);
  }
  return null;
}

/** RSS 2.0 und Atom. Alle Texte werden als Klartext bereinigt. */
export function parseFeed(xmlText: string, limit = 40): FeedItem[] {
  const doc = parseXml(xmlText);
  const entries = [...findAll(doc, "item"), ...findAll(doc, "entry")];
  const items: FeedItem[] = [];
  for (const entry of entries) {
    const title = toPlainText(textOf(child(entry, "title")), 240);
    const url = linkOf(entry);
    if (!title || !url) continue;
    const dateRaw = textOf(child(entry, "pubDate")) || textOf(child(entry, "published")) || textOf(child(entry, "updated")) || textOf(child(entry, "date"));
    const parsed = dateRaw ? Date.parse(dateRaw) : Number.NaN;
    items.push({
      title,
      url,
      publishedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
      summary: toPlainText(textOf(child(entry, "description")) || textOf(child(entry, "summary")), 480) || null,
      categories: childrenNamed(entry, "category").map((c) => toPlainText(textOf(c) || c.attrs.term || "", 80)).filter(Boolean),
      guid: toPlainText(textOf(child(entry, "guid")) || textOf(child(entry, "id")), 300) || url,
    });
    if (items.length >= limit) break;
  }
  return items;
}
