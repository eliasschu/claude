import { getCompany, getForm13F } from "../sources/sec.ts";
import { fail, ok, type Result } from "../core/meta.ts";
import type { WhaleProfile } from "../../config/whales.ts";
import type { ThirteenFHolding } from "../sources/parsers/sec-13f.ts";

export type PositionChange = "neu" | "erhöht" | "reduziert" | "unverändert" | "geschlossen";

export interface WhaleHolding extends ThirteenFHolding {
  change: PositionChange;
  /** Aktien in der Vorquartalsmeldung, falls vorhanden. */
  previousShares: number | null;
}

export interface WhalePortfolio {
  profile: WhaleProfile;
  managerName: string;
  reportDate: string;
  filingDate: string;
  previousReportDate: string | null;
  holdings: WhaleHolding[];
  totalValueUsd: number;
  documentUrl: string;
  fetchedAt: string;
}

function classify(current: number | null, previous: number | null): PositionChange {
  if (previous === null || previous === 0) return "neu";
  if (current === null || current === 0) return "geschlossen";
  if (current > previous * 1.02) return "erhöht";
  if (current < previous * 0.98) return "reduziert";
  return "unverändert";
}

export async function getWhalePortfolio(profile: WhaleProfile): Promise<Result<WhalePortfolio>> {
  const company = await getCompany(profile.cik);
  if (!company.ok) return company;

  const quarterly = company.data.filings
    .filter((f) => f.form === "13F-HR" && f.reportDate)
    .sort((a, b) => (b.reportDate ?? "").localeCompare(a.reportDate ?? ""));

  // Nur die juengste Meldung je Quartalsende (Mehrfacheinreichungen am selben Tag kommen vor).
  const byQuarter = new Map<string, (typeof quarterly)[number]>();
  for (const f of quarterly) if (!byQuarter.has(f.reportDate!)) byQuarter.set(f.reportDate!, f);
  const [latest, previous] = [...byQuarter.values()];
  if (!latest) return fail("sec", "not_found", "Keine 13F-Meldung gefunden.");

  const currentTable = await getForm13F(profile.cik, latest.accession, latest.primaryDocument, latest.filingDate, latest.reportDate);
  if (!currentTable) return fail("sec", "invalid", "Informationstabelle der aktuellen Meldung konnte nicht gelesen werden.");

  const previousTable = previous
    ? await getForm13F(profile.cik, previous.accession, previous.primaryDocument, previous.filingDate, previous.reportDate)
    : null;
  const previousByCusip = new Map((previousTable?.holdings ?? []).map((h) => [h.cusip, h]));

  const holdings: WhaleHolding[] = currentTable.holdings
    .map((h) => {
      const prev = previousByCusip.get(h.cusip);
      return { ...h, change: classify(h.shares, prev?.shares ?? null), previousShares: prev?.shares ?? null };
    })
    .sort((a, b) => b.valueUsd - a.valueUsd);

  // Positionen, die es in der Vorquartalsmeldung noch gab, jetzt aber nicht mehr - vollstaendig geschlossen.
  const currentCusips = new Set(currentTable.holdings.map((h) => h.cusip));
  for (const prev of previousTable?.holdings ?? []) {
    if (currentCusips.has(prev.cusip)) continue;
    holdings.push({ ...prev, valueUsd: 0, shares: 0, change: "geschlossen", previousShares: prev.shares });
  }

  return ok({
    profile, managerName: company.data.name,
    reportDate: latest.reportDate!, filingDate: latest.filingDate,
    previousReportDate: previous?.reportDate ?? null,
    holdings, totalValueUsd: currentTable.holdings.reduce((s, h) => s + h.valueUsd, 0),
    documentUrl: currentTable.documentUrl, fetchedAt: company.meta.fetchedAt,
  }, company.meta);
}
