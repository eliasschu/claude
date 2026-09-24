import Link from "next/link";
import { FEATURED_TICKERS, findListing } from "@/lib/services/stocks";
import { getStockQuote } from "@/lib/sources/twelvedata";
import { Delta } from "@/components/common/data";
import { SectionTitle } from "@/components/ui/primitives";
import { WatchButton } from "@/components/watchlist/watch-button";
import { formatNumber } from "@/lib/finance/format";

/**
 * Nur der Kurs, keine Modellbewertung: Eine Bewertung braucht pro Aktie rund
 * ein Dutzend zusätzliche SEC-Abrufe (Jahresabschluss-Kennzahlen). Das wäre
 * für sieben Werte auf der Startseite viel zu langsam. Die volle Bewertung
 * gibt es auf der Aktienseite selbst.
 */
async function loadEntry(ticker: string) {
  const [listing, quote] = await Promise.all([findListing(ticker), getStockQuote(ticker)]);
  if (!listing.ok || !quote.ok || quote.data.price === null || quote.data.changePct === null) return null;
  return {
    ticker,
    name: listing.data.name,
    exchange: listing.data.exchange,
    price: quote.data.price,
    currency: quote.data.currency ?? "USD",
    changePct: quote.data.changePct,
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
                <Link href={`/aktie/${entry.ticker}`} className="text-[11px] font-semibold text-accent hover:underline">
                  Bewertung ansehen
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
