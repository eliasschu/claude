import { child, childrenNamed, parseXml, textOf, valueOf, type XmlNode } from "../../core/xml.ts";
import { toPlainText } from "../../core/sanitize.ts";

/* ---------------- Tickerverzeichnis ---------------- */

export interface SecListing { cik: number; name: string; ticker: string; exchange: string | null }

export function normalizeTickerIndex(raw: unknown): SecListing[] {
  const r = raw as { fields?: string[]; data?: unknown[][] };
  if (!Array.isArray(r?.fields) || !Array.isArray(r?.data)) return [];
  const i = (n: string) => r.fields!.indexOf(n);
  const [iCik, iName, iTicker, iExch] = [i("cik"), i("name"), i("ticker"), i("exchange")];
  if (iCik < 0 || iTicker < 0) return [];
  const seen = new Set<string>();
  const out: SecListing[] = [];
  for (const row of r.data) {
    const ticker = String(row[iTicker] ?? "").toUpperCase().trim();
    const cik = Number(row[iCik]);
    if (!ticker || !Number.isFinite(cik) || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({ cik, name: String(row[iName] ?? "").trim(), ticker, exchange: iExch >= 0 && row[iExch] ? String(row[iExch]) : null });
  }
  return out;
}

export const padCik = (cik: number | string) => String(cik).replace(/^0+/, "").padStart(10, "0");

/* ---------------- Meldungsliste ---------------- */

export interface SecFiling {
  accession: string; form: string; filingDate: string; reportDate: string | null;
  primaryDocument: string; description: string | null; items: string[];
}

export interface SecCompany {
  cik: number; name: string; tickers: string[]; exchanges: string[];
  sic: string | null; sicDescription: string | null; fiscalYearEnd: string | null; filings: SecFiling[];
}

export function normalizeSubmissions(raw: unknown): SecCompany | null {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r.name !== "string") return null;
  const recent = ((r.filings as Record<string, unknown>)?.recent ?? {}) as Record<string, unknown[]>;
  const acc = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const filings: SecFiling[] = acc.map((_, i) => ({
    accession: String(recent.accessionNumber[i]),
    form: String(recent.form?.[i] ?? ""),
    filingDate: String(recent.filingDate?.[i] ?? ""),
    reportDate: recent.reportDate?.[i] ? String(recent.reportDate[i]) : null,
    primaryDocument: String(recent.primaryDocument?.[i] ?? ""),
    description: recent.primaryDocDescription?.[i] ? toPlainText(String(recent.primaryDocDescription[i]), 200) : null,
    items: String(recent.items?.[i] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  }));
  return {
    cik: Number(r.cik),
    name: toPlainText(r.name, 200),
    tickers: Array.isArray(r.tickers) ? (r.tickers as unknown[]).map(String) : [],
    exchanges: Array.isArray(r.exchanges) ? (r.exchanges as unknown[]).map((e) => String(e ?? "")).filter(Boolean) : [],
    sic: r.sic ? String(r.sic) : null,
    sicDescription: r.sicDescription ? String(r.sicDescription) : null,
    fiscalYearEnd: r.fiscalYearEnd ? String(r.fiscalYearEnd) : null,
    filings,
  };
}

export function filingUrls(cik: number, accession: string, primaryDocument: string) {
  const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;
  return {
    index: `${folder}/${accession}-index.htm`,
    document: primaryDocument ? `${folder}/${primaryDocument}` : `${folder}/${accession}-index.htm`,
    /** Form 4: primaryDocument zeigt auf die XSL-Ansicht; das Roh-XML liegt ohne Praefix daneben. */
    rawXml: primaryDocument ? `${folder}/${primaryDocument.replace(/^xsl[^/]*\//, "")}` : null,
  };
}

export const EIGHT_K_ITEMS: Record<string, string> = {
  "1.01": "Abschluss eines wesentlichen Vertrags", "1.02": "Beendigung eines wesentlichen Vertrags",
  "1.03": "Insolvenz oder Zwangsverwaltung", "1.05": "Wesentlicher Cybersicherheitsvorfall",
  "2.01": "Abschluss eines Erwerbs oder einer Veräußerung", "2.02": "Geschäftszahlen und Finanzlage",
  "2.03": "Begründung einer wesentlichen Finanzverbindlichkeit", "2.05": "Kosten für Restrukturierung",
  "2.06": "Wesentliche Wertminderungen", "3.01": "Mitteilung zur Börsennotierung",
  "3.02": "Nicht registrierter Verkauf eigener Wertpapiere", "4.01": "Wechsel des Abschlussprüfers",
  "4.02": "Frühere Abschlüsse nicht mehr verlässlich", "5.01": "Kontrollwechsel",
  "5.02": "Personalien in Vorstand oder Aufsichtsgremium", "5.03": "Änderung von Satzung oder Geschäftsjahr",
  "5.07": "Abstimmungsergebnisse der Hauptversammlung", "7.01": "Offenlegung nach Regulation FD",
  "8.01": "Sonstige Ereignisse", "9.01": "Abschlüsse und Anlagen",
};

export const FORM_LABELS: Record<string, string> = {
  "8-K": "Ad-hoc-Pflichtmitteilung (8-K)", "10-K": "Jahresbericht (10-K)", "10-Q": "Quartalsbericht (10-Q)",
  "20-F": "Jahresbericht ausländischer Emittent (20-F)", "6-K": "Mitteilung ausländischer Emittent (6-K)",
  "4": "Insidermeldung (Form 4)", "4/A": "Berichtigte Insidermeldung (Form 4/A)",
};

/* ---------------- XBRL-Jahreswerte ---------------- */

export interface ConceptFact {
  start?: string; end: string; val: number; accn: string; fy?: number; fp?: string; form: string; filed: string;
}

export interface AnnualValue {
  end: string; start?: string; value: number; unit: string; form: string; filed: string; accession: string;
}

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "10-KT"]);

/**
 * Jahreswerte eines XBRL-Konzepts: nur Jahresberichte, bei Zeitraumgroessen
 * nur Perioden von rund einem Jahr, je Stichtag die juengste Einreichung.
 */
export function annualValues(
  units: Record<string, ConceptFact[]> | undefined,
  kind: "duration" | "instant",
  preferredUnits: string[],
): AnnualValue[] {
  if (!units) return [];
  const unit = preferredUnits.find((u) => Array.isArray(units[u])) ?? Object.keys(units)[0];
  if (!unit || !Array.isArray(units[unit])) return [];
  const byEnd = new Map<string, AnnualValue>();
  for (const f of units[unit]) {
    if (!f || !ANNUAL_FORMS.has(f.form) || !Number.isFinite(f.val) || !f.end) continue;
    if (kind === "duration") {
      if (!f.start) continue;
      const days = (Date.parse(`${f.end}T00:00:00Z`) - Date.parse(`${f.start}T00:00:00Z`)) / 86400000;
      if (days < 340 || days > 380) continue;
    }
    const current = byEnd.get(f.end);
    if (!current || f.filed > current.filed) {
      byEnd.set(f.end, { end: f.end, start: f.start, value: f.val, unit, form: f.form, filed: f.filed, accession: f.accn });
    }
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/** Ausstehende Aktien laut Deckblatt; mehrere Gattungen desselben Berichts werden addiert. */
export function latestSharesOutstanding(units: Record<string, ConceptFact[]> | undefined): AnnualValue | null {
  const facts = units?.shares;
  if (!Array.isArray(facts) || facts.length === 0) return null;
  const latest = [...facts].sort((a, b) => (a.filed === b.filed ? a.end.localeCompare(b.end) : a.filed.localeCompare(b.filed))).at(-1)!;
  const same = facts.filter((f) => f.accn === latest.accn && f.end === latest.end);
  const unique = new Map(same.map((f) => [String(f.val), f]));
  const total = [...unique.values()].reduce((s, f) => s + f.val, 0);
  return { end: latest.end, value: total, unit: "shares", form: latest.form, filed: latest.filed, accession: latest.accn };
}

/* ---------------- Form 4 ---------------- */

export type InsiderCategory = "kauf" | "verkauf" | "ausuebung" | "zuteilung" | "sonstige";

export const TRANSACTION_CODES: Record<string, { label: string; category: InsiderCategory }> = {
  P: { label: "Kauf am offenen Markt oder privat", category: "kauf" },
  S: { label: "Verkauf am offenen Markt oder privat", category: "verkauf" },
  A: { label: "Zuteilung (z. B. Aktienvergütung)", category: "zuteilung" },
  M: { label: "Ausübung oder Umwandlung eines Derivats", category: "ausuebung" },
  X: { label: "Ausübung eines Derivats im Geld", category: "ausuebung" },
  O: { label: "Ausübung eines Derivats aus dem Geld", category: "ausuebung" },
  C: { label: "Umwandlung eines Derivats", category: "ausuebung" },
  F: { label: "Einbehalt von Aktien zur Steuerzahlung", category: "sonstige" },
  G: { label: "Schenkung", category: "sonstige" },
  D: { label: "Rückgabe an den Emittenten", category: "sonstige" },
  J: { label: "Sonstige Transaktion", category: "sonstige" },
  W: { label: "Erwerb oder Abgabe durch Erbfall", category: "sonstige" },
  I: { label: "Ermessensentscheidung in einem Plan", category: "sonstige" },
  K: { label: "Equity Swap oder vergleichbares Geschäft", category: "sonstige" },
  V: { label: "Freiwillig früh gemeldete Transaktion", category: "sonstige" },
};

export interface InsiderOwner { cik: string | null; name: string; roles: string[] }

export interface InsiderTransaction {
  table: "direkt" | "derivativ"; security: string; date: string | null; code: string; codeLabel: string;
  category: InsiderCategory; shares: number | null; price: number | null; acquired: boolean | null;
  sharesAfter: number | null; ownership: "direkt" | "indirekt" | null;
}

export interface Form4 {
  documentType: string; periodOfReport: string | null; issuerCik: string | null; issuerName: string;
  issuerTicker: string | null; owners: InsiderOwner[]; plan10b51: boolean | null; transactions: InsiderTransaction[];
}

const num = (raw: string | null): number | null => {
  if (raw === null) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const flag = (node: XmlNode | undefined): boolean => {
  const v = valueOf(node);
  return v === "1" || v?.toLowerCase() === "true";
};

export function parseForm4(xmlText: string): Form4 | null {
  const doc = child(parseXml(xmlText), "ownershipDocument");
  if (!doc) return null;
  const issuer = child(doc, "issuer");

  const owners: InsiderOwner[] = childrenNamed(doc, "reportingOwner").map((o) => {
    const id = child(o, "reportingOwnerId");
    const rel = child(o, "reportingOwnerRelationship");
    const roles: string[] = [];
    const title = valueOf(child(rel, "officerTitle"));
    if (flag(child(rel, "isDirector"))) roles.push("Mitglied des Board of Directors");
    if (flag(child(rel, "isOfficer"))) roles.push(title ? `Führungskraft: ${toPlainText(title, 80)}` : "Führungskraft");
    if (flag(child(rel, "isTenPercentOwner"))) roles.push("Aktionär mit mehr als 10 %");
    if (flag(child(rel, "isOther"))) roles.push(toPlainText(valueOf(child(rel, "otherText")) ?? "Sonstige Beziehung", 80));
    return { cik: valueOf(child(id, "rptOwnerCik")), name: toPlainText(valueOf(child(id, "rptOwnerName")) ?? "", 120), roles };
  });

  const transactions: InsiderTransaction[] = [];
  const collect = (table: XmlNode | undefined, tag: string, kind: "direkt" | "derivativ") => {
    for (const t of childrenNamed(table, tag)) {
      const coding = child(t, "transactionCoding");
      const amounts = child(t, "transactionAmounts");
      const code = (valueOf(child(coding, "transactionCode")) ?? "").toUpperCase();
      const known = TRANSACTION_CODES[code] ?? { label: `Code ${code || "unbekannt"}`, category: "sonstige" as const };
      const price = num(valueOf(child(amounts, "transactionPricePerShare")));
      const ad = valueOf(child(amounts, "transactionAcquiredDisposedCode"));
      const own = valueOf(child(child(t, "ownershipNature"), "directOrIndirectOwnership"));
      transactions.push({
        table: kind,
        security: toPlainText(valueOf(child(t, "securityTitle")) ?? "", 120),
        date: valueOf(child(t, "transactionDate")),
        code, codeLabel: known.label, category: known.category,
        shares: num(valueOf(child(amounts, "transactionShares"))),
        price: price !== null && price > 0 ? price : null,
        acquired: ad === "A" ? true : ad === "D" ? false : null,
        sharesAfter: num(valueOf(child(child(t, "postTransactionAmounts"), "sharesOwnedFollowingTransaction"))),
        ownership: own === "D" ? "direkt" : own === "I" ? "indirekt" : null,
      });
    }
  };
  collect(child(doc, "nonDerivativeTable"), "nonDerivativeTransaction", "direkt");
  collect(child(doc, "derivativeTable"), "derivativeTransaction", "derivativ");

  const plan = child(doc, "aff10b5One");
  return {
    documentType: valueOf(child(doc, "documentType")) ?? "4",
    periodOfReport: valueOf(child(doc, "periodOfReport")),
    issuerCik: valueOf(child(issuer, "issuerCik")),
    issuerName: toPlainText(valueOf(child(issuer, "issuerName")) ?? "", 160),
    issuerTicker: valueOf(child(issuer, "issuerTradingSymbol")),
    owners,
    plan10b51: plan ? flag(plan) : null,
    transactions,
  };
}
