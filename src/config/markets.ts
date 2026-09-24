/**
 * Eindeutige Definition der Marktinstrumente. Index, ETF, Spotpreis und
 * Future werden nicht vermischt. Instrumente ohne Quelle stehen hier mit
 * Definition, werden aber ohne Werte angezeigt.
 */

export type MarketKind = "index" | "rohstoff" | "devise" | "rendite" | "krypto";

export interface MarketDefinition {
  slug: string;
  name: string;
  fullName: string;
  kind: MarketKind;
  unit: string;
  definition: string;
  source: "coingecko" | "ecb" | "treasury" | "eia" | "twelvedata" | null;
  coinId?: string;
  /** Symbol beim Kursanbieter; bei Indizes nur, wenn der Tarif sie liefert. */
  providerSymbol?: string;
  missingNote?: string;
  /** Zuerst sichtbar laut Vorgabe. */
  primary: boolean;
}

export const MARKETS: MarketDefinition[] = [
  { slug: "sp500", name: "S&P 500 · ETF SPY", fullName: "S&P 500, über den ETF SPY", kind: "index", unit: "USD", primary: true, source: "twelvedata", providerSymbol: "SPY",
    definition: "Der offizielle Indexstand von S&P Dow Jones Indices ist im Gratistarif nicht verfügbar. Gezeigt wird stattdessen der Kurs des SPDR S&P 500 ETF (SPY), der den Index nachbildet - das ist ein ETF-Kurs, kein Indexstand, und weicht durch Gebühren und Handelsspanne leicht ab." },
  { slug: "nasdaq-100", name: "Nasdaq 100 · ETF QQQ", fullName: "Nasdaq-100, über den ETF QQQ", kind: "index", unit: "USD", primary: true, source: "twelvedata", providerSymbol: "QQQ",
    definition: "Indexstand nicht im Gratistarif verfügbar. Gezeigt wird der Kurs des Invesco QQQ Trust, der den Nasdaq-100 nachbildet - ein ETF-Kurs, kein Indexstand." },
  { slug: "dax", name: "DAX", fullName: "DAX (Performanceindex)", kind: "index", unit: "Punkte", primary: true, source: null,
    definition: "Die 40 größten Unternehmen am Frankfurter Aktienmarkt; als Performanceindex mit rechnerisch reinvestierten Dividenden.",
    missingNote: "Weder der Indexstand noch ein zuverlässiger, im Gratistarif abrufbarer ETF-Ersatz sind verfügbar." },
  { slug: "msci-world", name: "MSCI World · ETF URTH", fullName: "MSCI World, über den ETF URTH", kind: "index", unit: "USD", primary: true, source: "twelvedata", providerSymbol: "URTH",
    definition: "Indexstand nicht im Gratistarif verfügbar. Gezeigt wird der Kurs des iShares MSCI World ETF (URTH) - ein ETF-Kurs, kein Indexstand." },
  { slug: "bitcoin", name: "Bitcoin", fullName: "Bitcoin (BTC)", kind: "krypto", unit: "Euro je BTC", primary: true, source: "coingecko", coinId: "bitcoin",
    definition: "Aggregierter Marktpreis laut CoinGecko über viele Handelsplätze. Veränderung über 24 Stunden rollierend, nicht seit Mitternacht." },
  { slug: "gold", name: "Gold · ETF GLD", fullName: "Gold, über den ETF GLD", kind: "rohstoff", unit: "USD", primary: true, source: "twelvedata", providerSymbol: "GLD",
    definition: "Referenzpreise für physisches Gold sind lizenzpflichtig. Gezeigt wird der Kurs des SPDR Gold Shares ETF (GLD), der mit physischem Gold hinterlegt ist - ein ETF-Kurs, kein Feinunzenpreis." },
  { slug: "silber", name: "Silber · ETF SLV", fullName: "Silber, über den ETF SLV", kind: "rohstoff", unit: "USD", primary: true, source: "twelvedata", providerSymbol: "SLV",
    definition: "Referenzpreise für physisches Silber sind lizenzpflichtig. Gezeigt wird der Kurs des iShares Silver Trust ETF (SLV) - ein ETF-Kurs, kein Feinunzenpreis." },
  { slug: "brent", name: "Brent", fullName: "Brent-Rohöl (Spotpreis, EIA)", kind: "rohstoff", unit: "USD je Barrel", primary: true, source: "eia",
    definition: "Europe Brent Spot Price FOB laut U.S. Energy Information Administration. Tages-Spotpreis, kein Futures-Kontrakt; mit einigen Tagen Verzug veröffentlicht.",
    missingNote: "Benötigt einen kostenlosen EIA-Schlüssel (EIA_API_KEY)." },
  { slug: "ethereum", name: "Ethereum", fullName: "Ether (ETH)", kind: "krypto", unit: "Euro je ETH", primary: false, source: "coingecko", coinId: "ethereum",
    definition: "Aggregierter Marktpreis laut CoinGecko. Veränderung über 24 Stunden rollierend." },
  { slug: "eur-usd", name: "EUR/USD", fullName: "Euro-Referenzkurs EUR/USD (EZB)", kind: "devise", unit: "US-Dollar je Euro", primary: false, source: "ecb",
    definition: "Täglicher Euro-Referenzkurs der Europäischen Zentralbank. Referenzkurse dienen nur Informationszwecken und sind kein Handelskurs." },
  { slug: "us-rendite-10j", name: "US-Rendite 10 J.", fullName: "Rendite 10-jähriger US-Staatsanleihen", kind: "rendite", unit: "Prozent", primary: false, source: "treasury",
    definition: "Par Yield laut U.S. Department of the Treasury (Tageswert). Veränderungen in Basispunkten (1 Bp. = 0,01 Prozentpunkte)." },
];

export const marketBySlug = (slug: string) => MARKETS.find((m) => m.slug === slug);
