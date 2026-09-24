import { NextResponse } from "next/server";
import { findListing } from "@/lib/services/stocks";
import { getStockQuote } from "@/lib/sources/twelvedata";

export const dynamic = "force-dynamic";

/** Einzelkurs fuer die Watchlist – kleine, vom Nutzer selbst gewaehlte Anzahl an Symbolen. */
export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await context.params;
  const ticker = symbol.toUpperCase();
  const [listing, quote] = await Promise.all([findListing(ticker), getStockQuote(ticker)]);
  const name = listing.ok ? listing.data.name : ticker;
  if (!quote.ok) {
    return NextResponse.json(
      { symbol: ticker, name, price: null, currency: null, changePct: null, ok: false, message: quote.message },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { symbol: ticker, name, price: quote.data.price, currency: quote.data.currency, changePct: quote.data.changePct, ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
