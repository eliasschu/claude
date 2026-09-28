import { NextResponse } from "next/server";
import { findListing } from "@/lib/services/stocks";
import { getCompanyFacts } from "@/lib/sources/sec";
import { trimFacts } from "@/lib/finance/sec-facts";
import { env } from "@/lib/core/env";

export const dynamic = "force-dynamic";

/**
 * Normalisierte SEC-Unternehmenszahlen fuer die automatische Kriterienpruefung.
 * Der Browser sendet nur das Boersenkuerzel - keine Thesentexte. Abruf, Drosselung und Zwischenspeicher laufen
 * ueber die bestehende SEC-Anbindung (User-Agent, hoechstens 8 Anfragen je Sekunde).
 */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const symbol = ticker.toUpperCase();
  const headers = { "Cache-Control": "no-store" };
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return NextResponse.json({ ok: false, reason: "invalid", message: "Ungültiges Börsenkürzel." }, { status: 400, headers });
  }
  const listing = await findListing(symbol);
  if (!listing.ok) {
    const message = listing.reason === "not_found" ? `${symbol} ist bei der SEC nicht registriert - keine automatische Prüfung möglich.` : listing.message;
    return NextResponse.json({ ok: false, reason: listing.reason, message }, { headers });
  }
  const facts = await getCompanyFacts(listing.data.cik);
  if (!facts.ok) {
    const message = facts.reason === "not_found" ? `Für ${symbol} veröffentlicht die SEC keine strukturierten Finanzdaten (XBRL).` : facts.message;
    return NextResponse.json({ ok: false, reason: facts.reason, message }, { headers });
  }
  const since = new Date(Date.now() - 10 * 365 * 86400000).toISOString().slice(0, 10);
  return NextResponse.json({
    ok: true, ticker: symbol, facts: trimFacts(facts.data, since),
    // true = Abrufe gehen an einen lokalen Testserver statt an die SEC (nur Entwicklung) - Pruefskripte brechen dann ab
    upstreamOverridden: Boolean(env.upstreamOverride()),
    fetchedAt: facts.meta.fetchedAt, stale: facts.meta.stale, staleReason: facts.meta.staleReason ?? null, sourceUrl: facts.meta.sourceUrl,
  }, { headers });
}
