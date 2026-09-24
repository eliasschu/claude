import Link from "next/link";
import { getNews, clusterNews } from "@/lib/services/news";
import { newsToUiMeta } from "@/lib/data/types";
import { NewsFeed } from "./news-feed";
import { SectionTitle } from "@/components/ui/primitives";

/** Eigener Abschnitt, damit der News-Abruf die restliche Startseite nicht blockiert. */
export async function NewsSection() {
  const result = await getNews([], 10);
  const items = clusterNews(result.items);

  return (
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
      <NewsFeed initialItems={items} initialMeta={newsToUiMeta(result)} />
    </section>
  );
}
