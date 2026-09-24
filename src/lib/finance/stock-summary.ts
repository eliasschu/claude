/**
 * Investment-Kurzfazit: Argumente dafuer und dagegen, gleich gewichtet
 * nebeneinander. Jede Aussage nennt Kennzahl, Zeitraum und Quelle. Fehlen
 * Belege, bleibt die Liste kuerzer – es wird nichts aufgefuellt.
 */

import type { CompanyFinancials, FinancialMetrics } from "./fundamentals.ts";
import type { Scorecard } from "./stock-scorecard.ts";
import { impliedGrowthSentence, type StockModel } from "./stock-model.ts";

export type SummaryLabel = "Bewertung erscheint attraktiv" | "Gemischtes Bild" | "Hohe Erwartungen eingepreist" | "Datenlage unzureichend";

export interface Argument { text: string; period: string; source: string; strength: number }

export interface StockSummary {
  headline: SummaryLabel;
  whyInteresting: string;
  /** Argumente dafuer (Bull) und dagegen (Bear), gleichrangig dargestellt. */
  bull: Argument[];
  bear: Argument[];
  pricedIn: string;
  trigger: string;
  falsification: string;
  horizon: string;
  pillars: { label: string; verdict: string }[];
}

const share = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")} %`;

export function buildSummary(
  company: string,
  fin: CompanyFinancials,
  m: FinancialMetrics,
  card: Scorecard,
  model: StockModel,
): StockSummary {
  const last = fin.latest;
  const src = last ? `${last.form ?? "Jahresbericht"} vom ${last.filed ?? "–"} (SEC EDGAR)` : "SEC EDGAR";
  const fy = last ? `Geschäftsjahr bis ${last.end}` : "–";
  const span = `${m.revenueCagrYears} Geschäftsjahre bis ${last?.end ?? "–"}`;

  const bull: Argument[] = [];
  const bear: Argument[] = [];

  if (m.revenueCagr !== null && m.revenueCagr >= 0.08) bull.push({ text: `Der Umsatz wuchs um durchschnittlich ${share(m.revenueCagr)} pro Jahr.`, period: span, source: src, strength: m.revenueCagr });
  if (m.operatingMargin !== null && m.operatingMargin >= 0.2) bull.push({ text: `Die operative Marge lag bei ${share(m.operatingMargin)}.`, period: fy, source: src, strength: m.operatingMargin });
  if (m.netDebt !== null && m.netDebt < 0) bull.push({ text: "Das Unternehmen hat mehr Zahlungsmittel als Finanzschulden (Nettoliquidität).", period: fy, source: src, strength: 0.3 });
  if (m.yearsWithFcf >= 3 && m.fcfPositiveYears === m.yearsWithFcf) bull.push({ text: `Der freie Cashflow war in allen ${m.yearsWithFcf} ausgewerteten Geschäftsjahren positiv.`, period: `letzte ${m.yearsWithFcf} Geschäftsjahre`, source: src, strength: 0.25 });
  if (m.roe !== null && m.roe >= 0.2 && !m.negativeEquity) bull.push({ text: `Die Eigenkapitalrendite lag bei ${share(m.roe)}.`, period: fy, source: src, strength: m.roe / 2 });
  if (m.shareCountChange !== null && m.shareCountChange < -0.02) bull.push({ text: `Die Aktienanzahl sank um ${share(-m.shareCountChange)}; dein Anteil am Unternehmen wächst dadurch.`, period: `${m.shareCountYears} Jahre`, source: src, strength: 0.28 });

  if (m.revenueGrowthLatest !== null && m.revenueGrowthLatest < 0) bear.push({ text: `Der Umsatz ging zuletzt um ${share(-m.revenueGrowthLatest)} zurück.`, period: fy, source: src, strength: 0.5 });
  if (m.operatingMargin !== null && m.operatingMargin < 0.05) bear.push({ text: `Die operative Marge ist mit ${share(m.operatingMargin)} niedrig.`, period: fy, source: src, strength: 0.4 });
  if (m.netDebtToOcf !== null && m.netDebtToOcf > 3) bear.push({ text: `Die Nettoverschuldung entspricht dem ${m.netDebtToOcf.toFixed(1).replace(".", ",")}-Fachen des operativen Cashflows.`, period: fy, source: src, strength: 0.45 });
  if (m.shareCountChange !== null && m.shareCountChange > 0.03) bear.push({ text: `Die Aktienanzahl stieg um ${share(m.shareCountChange)}; dein Anteil am Unternehmen wird dadurch kleiner.`, period: `${m.shareCountYears} Jahre`, source: src, strength: 0.35 });
  if (m.fcfMargin !== null && m.fcfMargin < 0) bear.push({ text: "Der freie Cashflow war im letzten Geschäftsjahr negativ.", period: fy, source: src, strength: 0.5 });
  if (m.negativeEquity) bear.push({ text: "Das bilanzielle Eigenkapital ist negativ.", period: fy, source: src, strength: 0.35 });
  if (m.epsGrowthLatest !== null && m.epsGrowthLatest < -0.1) bear.push({ text: `Das Ergebnis je Aktie sank um ${share(-m.epsGrowthLatest)}.`, period: fy, source: src, strength: 0.4 });
  if (m.payoutOfFcf !== null && m.payoutOfFcf > 1) bear.push({ text: `Dividenden und Rückkäufe lagen über dem freien Cashflow (${share(m.payoutOfFcf)} davon).`, period: fy, source: src, strength: 0.3 });

  bull.sort((a, b) => b.strength - a.strength);
  bear.sort((a, b) => b.strength - a.strength);

  const quality = card.dimensions.filter((d) => d.key === "wachstum" || d.key === "profitabilitaet").map((d) => d.score).filter((q): q is number => q !== null);
  const qualityScore = quality.length ? quality.reduce((a, b) => a + b, 0) / quality.length : null;
  const qualityVerdict = qualityScore === null ? "Datenlage unzureichend"
    : qualityScore >= 65 ? "Starke Kennzahlen" : qualityScore >= 40 ? "Gemischtes Bild" : "Schwache Kennzahlen";

  const verdict = model.price.verdict;
  const headline: SummaryLabel =
    verdict === "Bewertung erscheint attraktiv" ? "Bewertung erscheint attraktiv"
    : verdict === "Hohe Erwartungen eingepreist" ? "Hohe Erwartungen eingepreist"
    : verdict === "Eher fair bewertet" ? "Gemischtes Bild" : "Datenlage unzureichend";

  const top = bull[0];
  const falsification = top
    ? top.text.startsWith("Der Umsatz wuchs")
      ? "Ein Umsatzrückgang in den nächsten Jahresberichten würde das Wachstumsargument widerlegen."
      : top.text.startsWith("Die operative Marge")
        ? "Eine deutlich sinkende operative Marge würde das Qualitätsargument schwächen."
        : top.text.includes("Nettoliquidität")
          ? "Eine schuldenfinanzierte Übernahme oder anhaltende Mittelabflüsse würden die Finanzstärke aufzehren."
          : "Ein dauerhaft negativer freier Cashflow würde die These widerlegen."
    : "Ohne belegte Stärken gibt es keine positive These, die widerlegt werden könnte.";

  return {
    headline,
    whyInteresting: top
      ? `${company}: ${top.text}`
      : `Für ${company} lassen sich aus den Jahresabschlüssen derzeit keine hervorstechenden Stärken belegen.`,
    bull: bull.slice(0, 3),
    bear: bear.slice(0, 3),
    pricedIn: impliedGrowthSentence(model) ?? "Nicht beurteilbar.",
    trigger: "Der nächste Quartals- oder Jahresbericht bei der SEC. Ein belegter Termin liegt nicht vor.",
    falsification,
    horizon: "Mehrjährig – die Einordnung beruht auf Jahresabschlüssen, nicht auf kurzfristigen Kursbewegungen.",
    pillars: [
      { label: "Geschäftsqualität", verdict: qualityVerdict },
      { label: "Bewertung", verdict },
      { label: "Kurzfristiges Momentum", verdict: card.dimensions.find((d) => d.key === "momentum")?.score === null ? "Datenlage unzureichend" : "siehe Scorecard" },
    ],
  };
}
