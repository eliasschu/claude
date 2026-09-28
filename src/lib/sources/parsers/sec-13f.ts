/**
 * Zerleger fuer die SEC-13F-Informationstabelle (Institutional Investment
 * Manager Holdings Report). Meldet Aktienbestaende institutioneller
 * Investoren zum Quartalsende - mit bis zu 45 Tagen Verzug veroeffentlicht.
 * Enthaelt keine Leerverkaeufe, die meisten Derivate oder Positionen
 * ausserhalb der USA.
 */

import { childrenNamed, parseXml, valueOf, child } from "../../core/xml.ts";
import { toPlainText } from "../../core/sanitize.ts";

export interface ThirteenFHolding {
  issuerName: string;
  cusip: string;
  /** Wert in USD, unabhaengig von der Meldeeinheit (siehe VALUE_IN_DOLLARS_SINCE). */
  valueUsd: number;
  shares: number | null;
  shareType: string | null;
  investmentDiscretion: string | null;
}

const num = (raw: string | null): number | null => {
  if (raw === null) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const LOWERCASE_WORDS = new Set(["of", "and", "the", "for", "in", "&"]);

/** SEC-Meldungen fuehren Firmennamen in Grossbuchstaben; fuer die Anzeige lesbar umformen. */
function titleCaseName(raw: string): string {
  return raw
    .split(" ")
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && LOWERCASE_WORDS.has(lower)) return lower;
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Seit der Formularaenderung der SEC (Release 34-95148) wird die Spalte
 * `value` in Einreichungen ab dem 03.01.2023 in ganzen US-Dollar gemeldet,
 * davor in Tausend US-Dollar. Massgeblich ist das Einreichungsdatum, nicht
 * das Quartalsende.
 */
export const VALUE_IN_DOLLARS_SINCE = "2023-01-03";

export function valueMultiplier(filingDate: string): number {
  return filingDate >= VALUE_IN_DOLLARS_SINCE ? 1 : 1000;
}

export function parse13FInfoTable(xmlText: string, filingDate: string): ThirteenFHolding[] {
  const multiplier = valueMultiplier(filingDate);
  const table = child(parseXml(xmlText), "informationTable");
  const entries = childrenNamed(table, "infoTable");
  const holdings: ThirteenFHolding[] = [];
  for (const entry of entries) {
    const issuer = titleCaseName(toPlainText(valueOf(child(entry, "nameOfIssuer")) ?? "", 160));
    const cusip = (valueOf(child(entry, "cusip")) ?? "").trim();
    const reportedValue = num(valueOf(child(entry, "value")));
    if (!issuer || !cusip || reportedValue === null) continue;
    // Put-/Call-Zeilen sind Optionen, kein Aktienbestand - sie wuerden die Position verfaelschen
    if ((valueOf(child(entry, "putCall")) ?? "").trim()) continue;
    const amt = child(entry, "shrsOrPrnAmt");
    holdings.push({
      issuerName: issuer,
      cusip,
      valueUsd: reportedValue * multiplier,
      shares: num(valueOf(child(amt, "sshPrnamt"))),
      shareType: valueOf(child(amt, "sshPrnamtType")),
      investmentDiscretion: valueOf(child(entry, "investmentDiscretion")),
    });
  }
  return mergeByCusip(holdings);
}

/**
 * Eine 13F-Tabelle fuehrt dieselbe Aktie oft in mehreren Zeilen (je Verwalter/Unter-Manager bzw. Stimmrechtsart).
 * Fuer die Anzeige zaehlt die Summe je CUSIP und Mengenart (Aktien vs. Nennwert); Reihenfolge der ersten Nennung bleibt.
 */
export function mergeByCusip(rows: ThirteenFHolding[]): ThirteenFHolding[] {
  const merged = new Map<string, ThirteenFHolding>();
  for (const h of rows) {
    const key = `${h.cusip}|${h.shareType ?? ""}`;
    const prev = merged.get(key);
    if (!prev) { merged.set(key, { ...h }); continue; }
    prev.valueUsd += h.valueUsd;
    prev.shares = prev.shares !== null && h.shares !== null ? prev.shares + h.shares : prev.shares ?? h.shares;
    if (prev.investmentDiscretion !== h.investmentDiscretion) prev.investmentDiscretion = "gemischt";
  }
  return [...merged.values()];
}

export interface EdgarIndexItem { name: string; type: string | null }

/** EDGAR-Ordnerindex (index.json) einer Einreichung - listet alle enthaltenen Dateien. */
export function parseEdgarIndexJson(raw: unknown): EdgarIndexItem[] {
  const r = raw as { directory?: { item?: unknown[] } };
  const items = r?.directory?.item;
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => i as Record<string, unknown>)
    .filter((i) => typeof i.name === "string")
    .map((i) => ({ name: String(i.name), type: i.type ? String(i.type) : null }));
}

/** Findet die Informationstabelle in einer 13F-HR-Einreichung: die XML-Datei, die nicht das Deckblatt ist. */
export function findInfoTableFile(items: EdgarIndexItem[], primaryDocument: string): string | null {
  const xmlFiles = items.filter((i) => i.name.toLowerCase().endsWith(".xml") && i.name !== primaryDocument);
  const byNameHint = xmlFiles.find((i) => /infotable/i.test(i.name));
  return (byNameHint ?? xmlFiles[0])?.name ?? null;
}
