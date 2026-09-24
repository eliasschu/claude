import Link from "next/link";
import { getNews, clusterNews, CATEGORY_LABEL, type NewsItem } from "@/lib/services/news";
import { getTopMovers } from "@/lib/services/movers";
import { upcomingEvents } from "@/config/calendar";
import { Card, Chip } from "@/components/ui/primitives";
import { Delta } from "@/components/common/data";
import { formatDate, formatNumber, formatTime } from "@/lib/finance/format";

function LeadStory({ item }: { item: NewsItem }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="neutral">{item.kind}</Chip>
        <Chip tone="neutral">{CATEGORY_LABEL[item.category]}</Chip>
        {item.related.length > 0 ? (
          <span className="num ml-auto text-[11px] text-faint">{item.related.length + 1} Quellen</span>
        ) : null}
      </div>

      <h3 className="editorial mt-3 text-[24px] font-semibold leading-[1.2] tracking-[-0.01em] sm:text-[28px]">
        <a href={item.url} className="hover:underline">{item.title}</a>
      </h3>
      {item.summary ? <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-muted">{item.summary}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        {item.publishedAt ? <span>{formatTime(item.publishedAt)} Uhr</span> : null}
        <a href={item.url} className="underline decoration-dotted underline-offset-2 hover:text-ink">
          {item.sourceName}
        </a>
      </div>
    </div>
  );
}

export async function TodayPanel() {
  const [newsResult, movers] = await Promise.all([getNews([], 20), getTopMovers(6)]);
  const clustered = clusterNews(newsResult.items);
  // Themen, zu denen mehrere Quellen vorliegen, gelten als bestaetigter – sonst die juengste Meldung.
  const lead = [...clustered].sort((a, b) => b.related.length - a.related.length)[0];
  const events = upcomingEvents().slice(0, 5);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <Card className="p-4 sm:p-5">
        <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-faint">Thema des Tages</h2>
        {lead ? <LeadStory item={lead} /> : <p className="text-[13px] text-muted">Keine verlässlichen Daten verfügbar.</p>}
      </Card>

      <div className="grid gap-3">
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[12px] font-bold uppercase tracking-wide text-faint">Größte Bewegungen</h2>
            <Link href="/maerkte" className="text-[11px] font-semibold text-accent hover:underline">Alle</Link>
          </div>
          <ul className="divide-y divide-line">
            {movers.rows.map((row) => (
              <li key={row.href}>
                <Link href={row.href} className="flex items-center gap-3 py-2 transition-opacity hover:opacity-80">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{row.name}</span>
                    <span className="num block text-[11px] text-faint">
                      {formatNumber(row.price)} {row.currency} · {row.kind === "krypto" ? "Krypto" : "Aktie"}
                    </span>
                  </span>
                  <Delta value={row.changePct} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-faint">Anstehende Termine</h2>
          {events.length === 0 ? (
            <p className="text-[13px] text-muted">Keine bestätigten Termine in der Kalenderliste.</p>
          ) : (
            <ul className="space-y-2.5">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span className="num w-[52px] shrink-0 text-[12px] font-semibold text-muted">
                    {formatDate(event.date).slice(0, 5)}
                  </span>
                  <span className="min-w-0">
                    <a href={event.sourceUrl} className="block text-[13px] font-semibold leading-snug hover:underline">
                      {event.title}
                    </a>
                    <span className="block text-[11px] text-faint">{event.institution} · {event.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[10px] text-faint">
            Von Hand aus offiziellen Kalendern übernommen (Fed, EZB), keine automatische Quelle.
          </p>
        </Card>
      </div>
    </div>
  );
}
