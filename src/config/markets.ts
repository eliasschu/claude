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
  { slug: "sp500", name: "S&P 500", fullName: "S&P 500 (Kursindex)", kind: "index", unit: "Punkte", primary: true, source: null,
    definition: "Aktienindex von S&P Dow Jones Indices mit rund 500 großen US-Unternehmen, gewichtet nach Streubesitz-Marktkapitalisierung.",
    missingNote: "Indexstände sind im Gratistarif nicht enthalten. ETF-Kurse werden bewusst nicht als Indexstand ausgegeben." },
  { slug: "nasdaq-100", name: "Nasdaq 100", fullName: "Nasdaq-100 Index (NDX)", kind: "index", unit: "Punkte", primary: true, source: null,
    definition: "Die 100 größten an der Nasdaq notierten Nicht-Finanzunternehmen. Nicht zu verwechseln mit dem Nasdaq Composite, der alle Nasdaq-Aktien umfasst.",
    missingNote: "Indexstände sind im Gratistarif nicht enthalten." },
  { slug: "dax", name: "DAX", fullName: "DAX (Performanceindex)", kind: "index", unit: "Punkte", primary: true, source: null,
    definition: "Die 40 größten Unternehmen am Frankfurter Aktienmarkt; als Performanceindex mit rechnerisch reinvestierten Dividenden.",
    missingNote: "Indexstände sind lizenzpflichtig und im Gratistarif nicht enthalten." },
  { slug: "msci-world", name: "MSCI World", fullName: "MSCI World Index (Kursindex, USD)", kind: "index", unit: "Punkte", primary: true, source: null,
    definition: "Große und mittlere Unternehmen aus 23 Industrieländern; keine Schwellenländer.",
    missingNote: "Indexstände sind lizenzpflichtig und im Gratistarif nicht enthalten." },
  { slug: "bitcoin", name: "Bitcoin", fullName: "Bitcoin (BTC)", kind: "krypto", unit: "Euro je BTC", primary: true, source: "coingecko", coinId: "bitcoin",
    definition: "Aggregierter Marktpreis laut CoinGecko über viele Handelsplätze. Veränderung über 24 Stunden rollierend, nicht seit Mitternacht." },
  { slug: "gold", name: "Gold", fullName: "Gold (USD je Feinunze)", kind: "rohstoff", unit: "USD je Feinunze", primary: true, source: null,
    definition: "Preis für eine Feinunze (31,1035 g) Gold.",
    missingNote: "Referenzpreise sind lizenzpflichtig und im Gratistarif nicht enthalten." },
  { slug: "silber", name: "Silber", fullName: "Silber (USD je Feinunze)", kind: "rohstoff", unit: "USD je Feinunze", primary: true, source: null,
    definition: "Preis für eine Feinunze Silber.",
    missingNote: "Referenzpreise sind lizenzpflichtig und im Gratistarif nicht enthalten." },
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
