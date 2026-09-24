import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStockOverview, FEATURED_TICKERS } from "@/lib/services/stocks";
import { toValuationView } from "@/lib/services/stock-analysis";
import { toUiMeta, type Candle } from "@/lib/data/types";
import { Card, CardBody, Chip } from "@/components/ui/primitives";
import { DataStamp, Delta } from "@/components/common/data";
import { WatchButton } from "@/components/watchlist/watch-button";
import { PriceChart } from "@/components/stock/price-chart";
import { FairValueCard } from "@/components/stock/fair-value-card";
import { ScorecardCard } from "@/components/stock/scorecard-card";
import { formatNumber, formatPrice } from "@/lib/finance/format";

export const dynamicParams = true;

type Params = { params: Promise<{ symbol: string }> };

export async function generateStaticParams() {
  return FEATURED_TICKERS.map((symbol) => ({ symbol }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { symbol } = await params;
  const overview = await getStockOverview(symbol.toUpperCase());
  return { title: overview.ok ? `${overview.data.company.name} (${overview.data.listing.ticker}) – Finanzwelt-App` : "Wertpapier nicht gefunden" };
}

const SECTIONS = [
  { href: "#bewertung", label: "Bewertung" },
  { href: "#scorecard", label: "Scorecard" },
  { href: "#meldungen", label: "Meldungen" },
];

export default async function StockPage({ params }: Params) {
  const { symbol } = await params;
  const overview = await getStockOverview(symbol.toUpperCase());
  if (!overview.ok) notFound();
  const { listing, company, model, scorecard, prices, filings, factsMeta } = overview.data;

  const quote = prices.quote;
  const candles: Candle[] = (prices.daily ?? []).map(([t, close]) => ({ date: new Date(t).toISOString(), close }));
  const valuation = toValuationView(model);
  const factsUiMeta = toUiMeta(factsMeta);

  return (
    <div className="space-y-5">
      <nav aria-label="Brotkrumen" className="text-[12px] text-faint">
        <Link href="/" className="hover:text-ink">Start</Link> <span aria-hidden>/</span> {company.name}
      </nav>

      <Card>
        <CardBody className="pt-4 sm:pt-5">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[24px] font-extrabold tracking-[-0.03em] sm:text-[28px]">{company.name}</h1>
              <p className="num mt-1 text-[12px] text-faint">
                {listing.ticker}{listing.exchange ? ` · ${listing.exchange}` : ""} · CIK {listing.cik}
              </p>
            </div>
            <WatchButton symbol={listing.ticker} name={company.name} variant="full" />
          </div>

          {quote && quote.price !== null ? (
            <>
              <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-1">
                <p className="num text-[34px] font-extrabold leading-none tracking-[-0.03em]">
                  {formatPrice(quote.price, quote.currency ?? "USD")}
                </p>
                <Delta value={quote.changePct} size="lg" />
                {quote.changeAbs !== null ? (
                  <span className="num text-[13px] text-muted">
                    {quote.changeAbs > 0 ? "+" : ""}{formatNumber(quote.changeAbs)} {quote.currency} heute
                  </span>
                ) : null}
                {quote.volume !== null ? (
                  <span className="num text-[13px] text-muted">Volumen {formatNumber(quote.volume, 0)} Stk.</span>
                ) : null}
                {quote.marketOpen !== null ? (
                  <Chip tone={quote.marketOpen ? "pos" : "neutral"}>Handel {quote.marketOpen ? "offen" : "geschlossen"}</Chip>
                ) : null}
              </div>

              <div className="mt-5">
                <PriceChart candles={candles} currency={quote.currency ?? "USD"} />
              </div>

              {prices.quoteMeta ? <DataStamp meta={toUiMeta(prices.quoteMeta)} className="mt-3" /> : null}
            </>
          ) : (
            <p className="mt-4 rounded-[10px] border border-dashed border-line-strong px-4 py-3 text-[13px] text-muted">
              Kein Kurs verfügbar{prices.unavailable ? `: ${prices.unavailable}` : "."} Die Bewertung unten beruht nur auf den
              Jahresabschlüssen.
            </p>
          )}
        </CardBody>
      </Card>

      <nav aria-label="Abschnitte" className="rail sticky top-[112px] z-30 -mx-4 flex gap-1.5 overflow-x-auto bg-bg/90 px-4 py-2 backdrop-blur md:top-[62px] sm:mx-0 sm:px-0">
        {SECTIONS.map((s) => (
          <a key={s.href} href={s.href} className="shrink-0 rounded-[8px] border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted hover:text-ink">
            {s.label}
          </a>
        ))}
      </nav>

      <div id="bewertung" className="scroll-mt-32">
        <FairValueCard valuation={valuation} price={quote?.price ?? 0} currency={quote?.currency ?? model.currency ?? "USD"} meta={factsUiMeta} />
      </div>

      <div id="scorecard" className="scroll-mt-32">
        <ScorecardCard card={scorecard} meta={factsUiMeta} />
      </div>

      <div id="meldungen" className="scroll-mt-32">
        <Card>
          <CardBody className="pt-4 sm:pt-5">
            <h2 className="mb-3 text-[15px] font-bold">Meldungen bei der SEC</h2>
            {filings.length === 0 ? (
              <p className="text-[13px] text-muted">Keine Pflichtmeldungen der letzten 180 Tage.</p>
            ) : (
              <ul className="divide-y divide-line">
                {filings.map((f) => (
                  <li key={f.id} className="py-2.5">
                    <a href={f.url} className="text-[13px] font-semibold hover:underline">{f.title}</a>
                    <p className="mt-0.5 text-[11px] text-faint">{f.formLabel} · eingereicht am {f.filingDate}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
