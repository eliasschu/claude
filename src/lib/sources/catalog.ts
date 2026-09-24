import type { SourceId } from "../core/meta.ts";

/** Beschreibung aller angebundenen Quellen – fuer Herkunftszeilen und die Methodikseite. */
export interface SourceInfo { id: SourceId; name: string; homepage: string; data: string; freshness: string; license: string; requires?: string }

export const SOURCES: Record<SourceId, SourceInfo> = {
  coingecko: { id: "coingecko", name: "CoinGecko", homepage: "https://www.coingecko.com/en/api",
    data: "Preise, Marktkapitalisierung, Volumen, Angebot und Verläufe von Kryptowährungen",
    freshness: "laut Anbieter ab etwa 60 Sekunden; jede Zeile mit eigenem Datenstand",
    license: "Namensnennung „Powered by CoinGecko“ Pflicht; Zwischenspeicher höchstens 24 Stunden",
    requires: "COINGECKO_API_KEY (kostenloser Demo-Schlüssel)" },
  sec: { id: "sec", name: "SEC EDGAR", homepage: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
    data: "Stammdaten, Finanzzahlen, Pflichtmitteilungen und Insidermeldungen US-registrierter Unternehmen",
    freshness: "neue Meldungen in der Regel innerhalb von Minuten nach Einreichung",
    license: "US-Behördendaten; höchstens 10 Anfragen je Sekunde, User-Agent mit Kontakt",
    requires: "SEC_EDGAR_USER_AGENT mit Name und E-Mail" },
  ecb: { id: "ecb", name: "Europäische Zentralbank", homepage: "https://data.ecb.europa.eu/",
    data: "Tägliche Euro-Referenzkurse", freshness: "Tageswert an TARGET-Geschäftstagen gegen 16:00 Uhr",
    license: "Weiterverwendung mit Quellenangabe gestattet" },
  "ecb-press": { id: "ecb-press", name: "EZB – Pressemitteilungen", homepage: "https://www.ecb.europa.eu/press/html/index.en.html",
    data: "Pressemitteilungen der EZB", freshness: "bei Veröffentlichung", license: "Wiedergabe mit Quellenangabe; nur Überschrift, Kurztext und Link" },
  "fed-press": { id: "fed-press", name: "Federal Reserve – Pressemitteilungen", homepage: "https://www.federalreserve.gov/newsevents/pressreleases.htm",
    data: "Pressemitteilungen der US-Notenbank", freshness: "bei Veröffentlichung", license: "Veröffentlichung einer US-Bundesbehörde" },
  "sec-press": { id: "sec-press", name: "SEC – Pressemitteilungen", homepage: "https://www.sec.gov/newsroom/press-releases",
    data: "Pressemitteilungen der US-Wertpapieraufsicht", freshness: "bei Veröffentlichung", license: "Veröffentlichung einer US-Bundesbehörde" },
  treasury: { id: "treasury", name: "U.S. Department of the Treasury", homepage: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
    data: "Tägliche Renditen von US-Staatsanleihen", freshness: "Tageswert nach US-Handelsschluss", license: "Veröffentlichung einer US-Bundesbehörde" },
  eia: { id: "eia", name: "U.S. Energy Information Administration", homepage: "https://www.eia.gov/opendata/",
    data: "Brent-Spotpreis je Barrel", freshness: "Tageswert mit einigen Tagen Verzug", license: "Veröffentlichung einer US-Bundesbehörde",
    requires: "EIA_API_KEY (kostenlose Registrierung)" },
  twelvedata: { id: "twelvedata", name: "Twelve Data", homepage: "https://twelvedata.com",
    data: "Aktienkurse und Kursverläufe", freshness: "US-Kurse laut Anbieter nahezu in Echtzeit; andere Börsen teils verzögert",
    license: "Gratistarif: nur persönliche, nicht-öffentliche Nutzung", requires: "TWELVEDATA_API_KEY (kostenlos)" },
  calendar: { id: "calendar", name: "Offizielle Sitzungskalender", homepage: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    data: "Termine geldpolitischer Sitzungen", freshness: "redaktionell übernommen", license: "öffentliche Terminangaben" },
};
