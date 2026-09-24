import Link from "next/link";
import { getInsiderActivity, visibleRows, type InsiderRow } from "@/lib/services/insider";
import { STOCK_MOVER_UNIVERSE } from "@/config/movers";
import { getStockQuote, getStockSeries } from "@/lib/sources/twelvedata";
import { totalReturnPct } from "@/lib/finance/performance";
import { whatItMeans, whatItDoesNotMean } from "@/lib/finance/insider-narrative";
import { Card, Chip } from "@/components/ui/primitives";
import { formatCompact, formatDate, formatNumber, formatPercent } from "@/lib/finance/format";

const MATERIALITY_LABEL: Record<string, string> = { hoch: "hoch", mittel: "mittel", gering: "gering" };

function rank(row: InsiderRow) {
  const level = row.materiality === "hoch" ? 2 : row.materiality === "mittel" ? 1 : 0;
  return { level, value: row.value ?? 0 };
}

/**
 * "Deal der Woche" und "Die Aktie im Blick" teilen sich einen Datenabruf:
 * der Deal mit der höchsten Aussagekraft der letzten 7 Tage in der
 * Beobachtungsliste (bei Gleichstand der größere Wert), dazu die Aktie und
 * Insider-Bilanz der letzten 4 Wochen für genau dieses Unternehmen.
 */
export async function DealOfWeekSection() {
  const activity = await getInsiderActivity(STOCK_MOVER_UNIVERSE, 7, 15);
  const candidates = visibleRows(activity.rows).filter((r) => (r.category === "kauf" || r.category === "verkauf") && r.materiality !== "keine");
  if (candidates.length === 0) return null;

  const deal = [...candidates].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra.level !== rb.level ? rb.level - ra.level : rb.value - ra.value;
  })[0];

  const isLargest = !candidates.some((r) => r.ticker === deal.ticker && r.id !== deal.id && (r.value ?? 0) > (deal.value ?? 0));

  const [quote, series, focusActivity] = await Promise.all([
    getStockQuote(deal.ticker),
    getStockSeries(deal.ticker, "1day", 260),
    getInsiderActivity([deal.ticker], 28, 15),
  ]);

  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const ytdCloses = series.ok ? series.data.filter(([t]) => t >= yearStart).map(([, c]) => c) : [];
  const ytdPct = ytdCloses.length > 1 ? totalReturnPct(ytdCloses) : null;

  const balanceRows = visibleRows(focusActivity.rows).filter((r) => r.category === "kauf" || r.category === "verkauf");
  const balanceByPerson = new Map<string, { owner: string; role: string; category: string; plan: boolean | null; volume: number }>();
  for (const r of balanceRows) {
    const key = `${r.owner}|${r.category}`;
    const existing = balanceByPerson.get(key);
    const volume = r.value ?? 0;
    if (existing) existing.volume += volume;
    else balanceByPerson.set(key, { owner: r.owner, role: r.role, category: r.category, plan: r.plan10b51, volume });
  }
  const balance = [...balanceByPerson.values()].sort((a, b) => b.volume - a.volume);
  const totalSales = balance.filter((b) => b.category === "verkauf").reduce((s, b) => s + b.volume, 0);
  const totalBuys = balance.filter((b) => b.category === "kauf").reduce((s, b) => s + b.volume, 0);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-faint">Deal der Woche</span>
          <Chip tone={deal.category === "kauf" ? "pos" : "neg"}>{deal.category === "kauf" ? "▲ Kauf" : "▼ Verkauf"}</Chip>
          {deal.plan10b51 ? <Chip tone="neutral">mit Plan</Chip> : <Chip tone="neutral">ohne Verkaufsplan</Chip>}
          <span className="ml-auto text-[11px] text-faint">Aussagekraft {MATERIALITY_LABEL[deal.materiality]}</span>
        </div>

        <h3 className="editorial mt-3 text-[20px] font-semibold leading-snug sm:text-[24px]">
          {deal.owner} {deal.category === "kauf" ? "kauft" : "verkauft"} {deal.ticker}-Aktien für {formatCompact(deal.value, "USD")}
        </h3>
        <p className="mt-1 text-[12px] text-muted">{deal.role} · {deal.issuerName} seit Insider-Beobachtung</p>

        {deal.shareOfHolding !== null || deal.sharesAfter !== null ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {deal.shares !== null ? (
              <div>
                <p className="text-[11px] text-muted">{deal.category === "kauf" ? "Gekauft" : "Verkauft"}</p>
                <p className="num text-[18px] font-extrabold">{formatCompact(deal.shares)} Aktien</p>
              </div>
            ) : null}
            {deal.sharesAfter !== null ? (
              <div>
                <p className="text-[11px] text-muted">Hält weiterhin</p>
                <p className="num text-[18px] font-extrabold">{formatCompact(deal.sharesAfter)} Aktien</p>
              </div>
            ) : null}
            {deal.shareOfHolding !== null ? (
              <div>
                <p className="text-[11px] text-muted">Anteil transagiert</p>
                <p className="num text-[18px] font-extrabold">{(deal.shareOfHolding * 100).toFixed(0)} %</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold">Was es heißt</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{whatItMeans(deal, isLargest)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold">Was es nicht heißt</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{whatItDoesNotMean(deal)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
          <span>Gehandelt {deal.transactionDate ? formatDate(deal.transactionDate) : "–"}</span>
          <span>Gemeldet {formatDate(deal.filingDate)}</span>
          <span>{deal.delayDays === null ? "" : `${deal.delayDays} ${deal.delayDays === 1 ? "Geschäftstag" : "Geschäftstage"} Verzug`}</span>
          <a href={deal.documentUrl} className="ml-auto underline decoration-dotted underline-offset-2 hover:text-ink">SEC Form 4 ↗</a>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-faint">Die Aktie im Blick</span>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <div>
            <Link href={`/aktie/${deal.ticker}`} className="text-[16px] font-extrabold hover:underline">{deal.issuerName}</Link>
            <p className="num text-[11px] text-faint">{deal.ticker}</p>
          </div>
          {quote.ok && quote.data.price !== null ? (
            <div className="text-right">
              <p className="num text-[20px] font-extrabold leading-none">{formatNumber(quote.data.price)} {quote.data.currency}</p>
              {ytdPct !== null ? <p className="num mt-0.5 text-[11px] text-muted">seit 1.1. {formatPercent(ytdPct, 1)}</p> : null}
            </div>
          ) : null}
        </div>

        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Hier passiert gerade der größte Insider-{deal.category === "kauf" ? "Kauf" : "Verkauf"} der Beobachtungsliste in dieser Woche.
        </p>

        <p className="mt-4 text-[11px] font-semibold">Insider-Bilanz, letzte 4 Wochen</p>
        {balance.length === 0 ? (
          <p className="mt-1 text-[12px] text-muted">Keine weiteren Käufe oder Verkäufe von Insidern gemeldet.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-line">
            {balance.map((b) => (
              <li key={`${b.owner}-${b.category}`} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{b.owner}</span> <span className="text-faint">· {b.role}</span>
                </span>
                <span className={b.category === "kauf" ? "text-pos" : "text-neg"}>{b.category === "kauf" ? "Kauf" : "Verkauf"}{b.plan ? " · Plan" : ""}</span>
                <span className="num w-[84px] text-right font-semibold">{formatCompact(b.volume, "USD")}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
          <span>Verkäufe gesamt <span className="num font-semibold text-neg">{formatCompact(totalSales, "USD")}</span></span>
          <span>Käufe gesamt <span className="num font-semibold text-pos">{formatCompact(totalBuys, "USD")}</span></span>
        </div>
      </Card>
    </div>
  );
}
