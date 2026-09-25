import { getCompany, getForm13F } from "../sources/sec.ts";
import { fail, ok, type Result } from "../core/meta.ts";
import { WHALES, type WhaleProfile } from "../../config/whales.ts";
import type { ThirteenFHolding } from "../sources/parsers/sec-13f.ts";

export type PositionChange = "neu" | "erhöht" | "reduziert" | "unverändert" | "geschlossen";

export interface WhaleHolding extends ThirteenFHolding {
  change: PositionChange;
  /** Aktien in der Vorquartalsmeldung, falls vorhanden. */
  previousShares: number | null;
}

export interface PortfolioTrendPoint {
  reportDate: string;
  totalValueUsd: number;
}

export interface WhalePortfolio {
  profile: WhaleProfile;
  managerName: string;
  reportDate: string;
  filingDate: string;
  previousReportDate: string | null;
  holdings: WhaleHolding[];
  totalValueUsd: number;
  /** Bis zu drei Quartale (aeltestes zuerst), fuer den kleinen Verlaufs-Trend. */
  trend: PortfolioTrendPoint[];
  documentUrl: string;
  fetchedAt: string;
}

const sumValue = (holdings: { valueUsd: number }[]) => holdings.reduce((s, h) => s + h.valueUsd, 0);

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

  const secName = company.data.name.toUpperCase();
  if (!profile.nameHints.some((hint) => secName.includes(hint))) {
    return fail(
      "sec",
      "invalid",
      `CIK ${profile.cik} fuehrt bei der SEC zu "${company.data.name}", nicht zu ${profile.displayName}. Anzeige gesperrt, um keine falsch zugeordneten Daten zu zeigen.`,
    );
  }

  const quarterly = company.data.filings
    .filter((f) => f.form === "13F-HR" && f.reportDate)
    .sort((a, b) => (b.reportDate ?? "").localeCompare(a.reportDate ?? ""));

  // Nur die juengste Meldung je Quartalsende (Mehrfacheinreichungen am selben Tag kommen vor).
  const byQuarter = new Map<string, (typeof quarterly)[number]>();
  for (const f of quarterly) if (!byQuarter.has(f.reportDate!)) byQuarter.set(f.reportDate!, f);
  const [latest, previous, older] = [...byQuarter.values()];
  if (!latest) return fail("sec", "not_found", "Keine 13F-Meldung gefunden.");

  const currentTable = await getForm13F(profile.cik, latest.accession, latest.primaryDocument, latest.filingDate, latest.reportDate);
  if (!currentTable) return fail("sec", "invalid", "Informationstabelle der aktuellen Meldung konnte nicht gelesen werden.");

  const previousTable = previous
    ? await getForm13F(profile.cik, previous.accession, previous.primaryDocument, previous.filingDate, previous.reportDate)
    : null;
  const previousByCusip = new Map((previousTable?.holdings ?? []).map((h) => [h.cusip, h]));

  // Nur fuer den Verlaufs-Trend gebraucht - keine Positions-Klassifizierung fuer dieses Quartal.
  const olderTable = older
    ? await getForm13F(profile.cik, older.accession, older.primaryDocument, older.filingDate, older.reportDate)
    : null;

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

  const trend: PortfolioTrendPoint[] = [
    ...(olderTable ? [{ reportDate: older!.reportDate!, totalValueUsd: sumValue(olderTable.holdings) }] : []),
    ...(previousTable ? [{ reportDate: previous!.reportDate!, totalValueUsd: sumValue(previousTable.holdings) }] : []),
    { reportDate: latest.reportDate!, totalValueUsd: sumValue(currentTable.holdings) },
  ];

  return ok({
    profile, managerName: company.data.name,
    reportDate: latest.reportDate!, filingDate: latest.filingDate,
    previousReportDate: previous?.reportDate ?? null,
    holdings, totalValueUsd: sumValue(currentTable.holdings), trend,
    documentUrl: currentTable.documentUrl, fetchedAt: company.meta.fetchedAt,
  }, company.meta);
}

export interface ConsensusPickFund {
  slug: string;
  displayName: string;
  change: PositionChange;
  valueUsd: number;
}

export interface ConsensusPick {
  issuerName: string;
  cusip: string;
  fundCount: number;
  newOrIncreasedCount: number;
  totalValueUsd: number;
  funds: ConsensusPickFund[];
}

export interface ConsensusResult {
  picks: ConsensusPick[];
  issues: { profile: string; message: string }[];
  fetchedAt: string | null;
}

const CONSENSUS_MIN_FUNDS = 3;

/**
 * Reine Auswertung bereits geladener 13F-Bestaende - keine neue Datenquelle,
 * kein zusaetzliches Fabrikationsrisiko. Zeigt, welche Aktien mehrere der
 * beobachteten Fonds gleichzeitig (offen) halten.
 */
export async function getConsensusPicks(profiles: WhaleProfile[] = WHALES, minFunds = CONSENSUS_MIN_FUNDS): Promise<ConsensusResult> {
  const issues: ConsensusResult["issues"] = [];
  let fetchedAt: string | null = null;

  const results = await Promise.all(profiles.map((p) => getWhalePortfolio(p)));
  const byCusip = new Map<string, ConsensusPick>();

  results.forEach((result, i) => {
    const profile = profiles[i];
    if (!result.ok) { issues.push({ profile: profile.displayName, message: result.message }); return; }
    fetchedAt = result.data.fetchedAt;

    for (const h of result.data.holdings) {
      if (h.change === "geschlossen") continue;
      const fundEntry: ConsensusPickFund = { slug: profile.slug, displayName: profile.displayName, change: h.change, valueUsd: h.valueUsd };
      const existing = byCusip.get(h.cusip);
      if (existing) {
        existing.funds.push(fundEntry);
        existing.totalValueUsd += h.valueUsd;
      } else {
        byCusip.set(h.cusip, { issuerName: h.issuerName, cusip: h.cusip, fundCount: 0, newOrIncreasedCount: 0, totalValueUsd: h.valueUsd, funds: [fundEntry] });
      }
    }
  });

  const picks = [...byCusip.values()]
    .map((p) => ({ ...p, fundCount: p.funds.length, newOrIncreasedCount: p.funds.filter((f) => f.change === "neu" || f.change === "erhöht").length }))
    .filter((p) => p.fundCount >= minFunds)
    .sort((a, b) => b.fundCount - a.fundCount || b.totalValueUsd - a.totalValueUsd);

  return { picks, issues, fetchedAt };
}
