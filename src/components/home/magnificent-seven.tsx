import Link from "next/link";
import { FEATURED_TICKERS, findListing, loadPrices } from "@/lib/services/stocks";
import { getValuationSummary } from "@/lib/services/stock-analysis";
import { Delta, Sparkline } from "@/components/common/data";
import { SectionTitle } from "@/components/ui/primitives";
import { WatchButton } from "@/components/watchlist/watch-button";
import { formatNumber } from "@/lib/finance/format";
import { VERDICT_TEXT } from "@/lib/finance/labels";

async function loadEntry(ticker: string) {
  const [listing, prices] = await Promise.all([findListing(ticker), loadPrices(ticker)]);
  if (!listing.ok || !prices.quote || prices.quote.price === null || prices.quote.changePct === null) return null;
  const verdict = await getValuationSummary(ticker, prices.quote.price);
  return {
    ticker,
    name: listing.data.name,
    exchange: listing.data.exchange,
    price: prices.quote.price,
    currency: prices.quote.currency ?? "USD",
    changePct: prices.quote.changePct,
    spark: (prices.daily ?? []).slice(-30).map((p) => p[1]),
    verdict,
  };
}

export async function MagnificentSeven() {
  const entries = (await Promise.all(FEATURED_TICKERS.map(loadEntry))).filter((e): e is NonNullable<typeof e> => e !== null);
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="mag7">
      <SectionTitle id="mag7">Magnificent Seven</SectionTitle>

      <ul className="rail -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {entries.map((entry) => {
          const dir = entry.changePct > 0 ? 1 : entry.changePct < 0 ? -1 : 0;
          return (
            <li
              key={entry.ticker}
              className="w-[228px] shrink-0 snap-start rounded-[14px] border border-line bg-surface p-3.5 sm:w-auto"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/aktie/${entry.ticker}`} className="block truncate text-[14px] font-bold hover:underline">
                    {entry.name}
                  </Link>
                  <p className="num text-[11px] text-faint">
                    {entry.ticker}{entry.exchange ? ` · ${entry.exchange}` : ""}
                  </p>
                </div>
                <WatchButton symbol={entry.ticker} name={entry.name} />
              </div>

              <p className="num mt-3 text-[22px] font-extrabold leading-none tracking-[-0.02em]">
                {formatNumber(entry.price)}
                <span className="ml-1 text-[12px] font-semibold text-faint">{entry.currency}</span>
              </p>

              <div className="mt-2 flex items-center justify-between gap-2">
                <Delta value={entry.changePct} size="sm" />
                <Sparkline values={entry.spark} direction={dir} width={72} height={22} />
              </div>

              <p className="mt-3 border-t border-line pt-2 text-[11px] leading-snug text-muted">
                {entry.verdict && entry.verdict.deviation !== null ? (
                  <>
                    Modell: <span className="font-semibold text-ink">{VERDICT_TEXT[entry.verdict.verdict]}</span>
                    <span className="num"> · Kurs {Math.abs(entry.verdict.deviation).toFixed(0)} % {entry.verdict.deviation > 0 ? "unter" : "über"} fairem Wert</span>
                  </>
                ) : (
                  "Keine verlässliche Modellbewertung verfügbar"
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
