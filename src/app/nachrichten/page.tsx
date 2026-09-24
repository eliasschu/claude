import type { Metadata } from "next";
import { getNews, clusterNews } from "@/lib/services/news";
import { newsToUiMeta } from "@/lib/data/types";
import { NewsFeed } from "@/components/news/news-feed";

export const metadata: Metadata = { title: "Nachrichten – Der junge Kapitalist" };

export default async function NewsPage() {
  const result = await getNews([], 60);
  const items = clusterNews(result.items);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Finanzen und Geopolitik</h1>
        <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-muted">
          Meldungen von EZB, Fed, SEC-Pressestelle und Unternehmensmeldungen bei der SEC. Mehrere Quellen zum selben
          Ereignis werden zu einem Themencluster zusammengefasst, statt doppelt zu erscheinen.
        </p>
      </div>
      <NewsFeed initialItems={items} initialMeta={newsToUiMeta(result)} />
    </div>
  );
}
