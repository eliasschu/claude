import Link from "next/link";
import { getNews, clusterNews } from "@/lib/services/news";
import { newsToUiMeta } from "@/lib/data/types";
import { MarketRail } from "@/components/market/market-rail";
import { TodayPanel } from "@/components/home/today-panel";
import { MagnificentSeven } from "@/components/home/magnificent-seven";
import { CryptoTeaser } from "@/components/home/crypto-teaser";
import { InsiderTeaser } from "@/components/home/insider-teaser";
import { NewsFeed } from "@/components/news/news-feed";
import { SectionTitle } from "@/components/ui/primitives";

export default async function HomePage() {
  const newsResult = await getNews([], 10);
  const items = clusterNews(newsResult.items);

  return (
    <div className="space-y-9">
      <MarketRail />

      <TodayPanel />

      <MagnificentSeven />

      <div className="grid gap-6 lg:grid-cols-2">
        <CryptoTeaser />
        <InsiderTeaser />
      </div>

      <section aria-labelledby="nachrichten">
        <SectionTitle
          id="nachrichten"
          right={
            <Link href="/nachrichten" className="text-[13px] font-semibold text-accent hover:underline">
              Alle Meldungen
            </Link>
          }
        >
          Finanzen und Geopolitik
        </SectionTitle>
        <NewsFeed initialItems={items} initialMeta={newsToUiMeta(newsResult)} />
      </section>
    </div>
  );
}
