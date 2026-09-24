import Link from "next/link";
import type { NewsItem } from "@/lib/services/news";
import { CATEGORY_LABEL } from "@/lib/services/news";
import { Chip } from "@/components/ui/primitives";
import { formatTime } from "@/lib/finance/format";

export function NewsCard({ item }: { item: NewsItem }) {
  return (
    <article className="px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <time dateTime={item.publishedAt ?? undefined} className="num text-[12px] font-bold">
          {item.publishedAt ? `${formatTime(item.publishedAt)} Uhr` : "Zeitpunkt unbekannt"}
        </time>
        <Chip tone="neutral">{item.kind}</Chip>
        <Chip tone="neutral">{CATEGORY_LABEL[item.category]}</Chip>
      </div>

      <h3 className="editorial mt-2 text-[17px] font-semibold leading-snug">
        <a href={item.url} className="hover:underline">{item.title}</a>
      </h3>
      {item.summary ? <p className="mt-1.5 max-w-[70ch] text-[13px] leading-relaxed text-muted">{item.summary}</p> : null}

      {item.companies.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {item.companies.map((c) => (
            <Link
              key={c.ticker}
              href={`/aktie/${c.ticker}`}
              className="num rounded-[6px] border border-line px-1.5 py-0.5 text-[11px] font-semibold hover:border-line-strong"
            >
              {c.ticker}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <a href={item.url} className="underline decoration-dotted underline-offset-2 hover:text-ink">
          Quelle: {item.sourceName}
        </a>
        {item.related.length > 0 ? (
          <details className="inline">
            <summary className="cursor-pointer list-none underline decoration-dotted underline-offset-2 hover:text-ink">
              {item.related.length + 1} Quellen im Themencluster
            </summary>
            <ul className="mt-1.5 space-y-1">
              {item.related.map((source) => (
                <li key={source.url}>
                  <a href={source.url} className="underline decoration-dotted underline-offset-2">
                    {source.sourceName}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span>Einzelquelle – noch nicht bestätigt</span>
        )}
      </div>
    </article>
  );
}
