import { env, upstream } from "../core/env.ts";
import { fetchSource, parseText, SourceError } from "../core/http.ts";
import { fail, ok, type Result, type SourceId } from "../core/meta.ts";
import { parseFeed, type FeedItem } from "./parsers/rss.ts";

export interface PressFeed { sourceId: Extract<SourceId, "ecb-press" | "fed-press" | "sec-press">; name: string; url: string }

export const PRESS_FEEDS: PressFeed[] = [
  { sourceId: "ecb-press", name: "Europäische Zentralbank", url: "https://www.ecb.europa.eu/rss/press.html" },
  { sourceId: "fed-press", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { sourceId: "sec-press", name: "U.S. Securities and Exchange Commission", url: "https://www.sec.gov/news/pressreleases.rss" },
];

export async function getPressFeed(feed: PressFeed): Promise<Result<{ items: FeedItem[] }>> {
  try {
    const ua = env.secUserAgent();
    if (feed.sourceId === "sec-press" && !ua) return fail(feed.sourceId, "not_configured", "SEC_EDGAR_USER_AGENT fehlt.");
    const res = await fetchSource({
      sourceId: feed.sourceId, url: upstream(feed.url),
      headers: feed.sourceId === "sec-press" && ua ? { "User-Agent": ua } : undefined,
      revalidate: 600, parse: parseText, maxStaleMs: 6 * 3600000,
    });
    const items = parseFeed(res.value, 30);
    return ok({ items }, {
      sourceId: feed.sourceId, source: feed.name, sourceUrl: feed.url,
      observedAt: items[0]?.publishedAt ?? null, observedPrecision: "minute",
      fetchedAt: res.fetchedAt, freshness: "bei Veröffentlichung", stale: res.stale, staleReason: res.staleReason,
    });
  } catch (error) {
    return error instanceof SourceError ? fail(feed.sourceId, error.reason, error.message) : fail(feed.sourceId, "unavailable", "Unbekannter Fehler beim Abruf");
  }
}
