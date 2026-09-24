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
  /** Wert in USD (die Meldung selbst gibt Tausend USD an). */
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

export function parse13FInfoTable(xmlText: string): ThirteenFHolding[] {
  const table = child(parseXml(xmlText), "informationTable");
  const entries = childrenNamed(table, "infoTable");
  const holdings: ThirteenFHolding[] = [];
  for (const entry of entries) {
    const issuer = titleCaseName(toPlainText(valueOf(child(entry, "nameOfIssuer")) ?? "", 160));
    const cusip = (valueOf(child(entry, "cusip")) ?? "").trim();
    const valueThousands = num(valueOf(child(entry, "value")));
    if (!issuer || !cusip || valueThousands === null) continue;
    const amt = child(entry, "shrsOrPrnAmt");
    holdings.push({
      issuerName: issuer,
      cusip,
      valueUsd: valueThousands * 1000,
      shares: num(valueOf(child(amt, "sshPrnamt"))),
      shareType: valueOf(child(amt, "sshPrnamtType")),
      investmentDiscretion: valueOf(child(entry, "investmentDiscretion")),
    });
  }
  return holdings;
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
