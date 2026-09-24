/**
 * Krypto-Einordnung mit eigener Methodik. Aktienkennzahlen wie KGV oder ein
 * Aktien-DCF werden bewusst nicht uebertragen, und es wird kein "fairer
 * Tokenpreis" berechnet. "Nicht belastbar bewertbar" ist ein zulaessiges Ergebnis.
 */

import type { CoinRow } from "../sources/parsers/coingecko.ts";
import { dailyReturns, maxDrawdownPct, standardDeviation } from "./performance.ts";

export type CoinTag = "stablecoin" | "wrapped" | "liquid-staking";

export const TAG_LABEL: Record<CoinTag, string> = {
  stablecoin: "Stablecoin", wrapped: "Wrapped Token", "liquid-staking": "Liquid-Staking-Token",
};

export const PROFILE_RULES = [
  "Stablecoins, Wrapped Tokens und Liquid-Staking-Token werden nach der Kategorie des Anbieters gekennzeichnet.",
  "Schwankung (7 Tage): Abstand zwischen Hoch und Tief der letzten sieben Tage. Über 25 % sehr hoch, über 10 % hoch, sonst moderat.",
  "Handelsaktivität: 24-Stunden-Volumen unter 1 % der zirkulierenden Marktkapitalisierung gilt als gering.",
  "Verwässerungspotenzial: vollständig verwässerte Bewertung mehr als doppelt so hoch wie die zirkulierende Marktkapitalisierung.",
];

export interface CoinProfile { label: string; tone: "neutral" | "warn" | "neg"; reasons: string[] }

export function rangePct(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < 2) return null;
  return (Math.max(...v) / Math.min(...v) - 1) * 100;
}

export function turnoverPct(row: Pick<CoinRow, "volume24h" | "marketCap">): number | null {
  if (!row.volume24h || !row.marketCap || row.marketCap <= 0) return null;
  return (row.volume24h / row.marketCap) * 100;
}

/** Regelbasiertes Risikoprofil fuer die Rangliste. Keine Qualitaets- oder Kaufaussage. */
export function coinProfile(row: CoinRow, tags: CoinTag[]): CoinProfile {
  if (tags.includes("stablecoin")) return { label: "Stablecoin", tone: "neutral", reasons: ["Soll einen festen Gegenwert abbilden; Risiken liegen in Bindungsmechanismus, Reserven und Emittent."] };
  if (tags.includes("wrapped")) return { label: "Wrapped Token", tone: "neutral", reasons: ["Abbild eines anderen Vermögenswerts; zusätzliches Verwahr- beziehungsweise Brückenrisiko."] };
  if (tags.includes("liquid-staking")) return { label: "Liquid-Staking-Token", tone: "neutral", reasons: ["Anspruch auf gestakte Einheiten; zusätzliches Protokoll- und Abweichungsrisiko."] };

  const reasons: string[] = [];
  const range = rangePct(row.sparkline7d);
  const turnover = turnoverPct(row);
  let tone: CoinProfile["tone"] = "neutral";
  let label: string;
  if (range === null) label = "Schwankung nicht ermittelbar";
  else if (range > 25) { label = "Sehr hohe Schwankung"; tone = "neg"; }
  else if (range > 10) { label = "Hohe Schwankung"; tone = "warn"; }
  else label = "Moderate Schwankung";
  if (range !== null) reasons.push(`Abstand zwischen Hoch und Tief der letzten sieben Tage: ${range.toFixed(1).replace(".", ",")} %.`);

  if (turnover !== null && turnover < 1) {
    reasons.push(`Geringe Handelsaktivität: 24-Stunden-Volumen entspricht ${turnover.toFixed(2).replace(".", ",")} % der Marktkapitalisierung.`);
    if (tone === "neutral") tone = "warn";
  }
  if (row.fdv && row.marketCap && row.fdv > 2 * row.marketCap) {
    reasons.push(`Die vollständig verwässerte Bewertung ist ${(row.fdv / row.marketCap).toFixed(1).replace(".", ",")}-mal so hoch wie die zirkulierende Marktkapitalisierung; künftige Freigaben können den Kurs belasten.`);
    if (tone === "neutral") tone = "warn";
  }
  return { label, tone, reasons };
}

export interface CryptoMetrics {
  volatility30dPct: number | null; volatility365dPct: number | null; maxDrawdown365dPct: number | null;
  turnoverPct: number | null; circulatingShareOfMaxPct: number | null; fdvToMarketCap: number | null;
  pegDeviationPct: number | null; observedDays: number;
}

/** Kennzahlen aus Tagespreisen; annualisiert mit 365 Tagen, weil rund um die Uhr gehandelt wird. */
export function cryptoMetrics(input: {
  daily: number[]; marketCap: number | null; fdv: number | null; volume24h: number | null;
  circulating: number | null; maxSupply: number | null; priceUsd: number | null; isStablecoin: boolean;
}): CryptoMetrics {
  const vol = (values: number[]) => {
    const sd = standardDeviation(dailyReturns(values));
    return sd === null ? null : sd * Math.sqrt(365) * 100;
  };
  return {
    volatility30dPct: input.daily.length >= 31 ? vol(input.daily.slice(-31)) : null,
    volatility365dPct: input.daily.length >= 180 ? vol(input.daily) : null,
    maxDrawdown365dPct: input.daily.length >= 30 ? maxDrawdownPct(input.daily) : null,
    turnoverPct: turnoverPct({ volume24h: input.volume24h, marketCap: input.marketCap }),
    circulatingShareOfMaxPct: input.circulating && input.maxSupply ? (input.circulating / input.maxSupply) * 100 : null,
    fdvToMarketCap: input.fdv && input.marketCap ? input.fdv / input.marketCap : null,
    pegDeviationPct: input.isStablecoin && input.priceUsd ? Math.abs(input.priceUsd - 1) * 100 : null,
    observedDays: input.daily.length,
  };
}

/** Vier getrennte Blickwinkel statt einer Gesamtnote. */
export interface CryptoAssessment {
  marketDynamics: string[];
  risks: string[];
  valuation: string;
  projectQuality: string;
}

export function assessCoin(metrics: CryptoMetrics, tags: CoinTag[]): CryptoAssessment {
  const marketDynamics: string[] = [];
  const risks: string[] = [];
  const num = (v: number | null, digits = 1) => (v === null ? "–" : v.toFixed(digits).replace(".", ","));

  if (metrics.volatility365dPct !== null) marketDynamics.push(`Schwankung über ein Jahr: ${num(metrics.volatility365dPct)} % (annualisiert).`);
  if (metrics.maxDrawdown365dPct !== null) marketDynamics.push(`Größter Rückgang im beobachteten Jahr: ${num(metrics.maxDrawdown365dPct)} %.`);
  if (metrics.turnoverPct !== null) marketDynamics.push(`Handelsvolumen entspricht ${num(metrics.turnoverPct, 2)} % der Marktkapitalisierung je Tag.`);

  if (metrics.turnoverPct !== null && metrics.turnoverPct < 1) risks.push("Geringe Handelsaktivität: größere Beträge lassen sich möglicherweise nicht ohne Kursbewegung handeln.");
  if (metrics.fdvToMarketCap !== null && metrics.fdvToMarketCap > 2) risks.push("Ein großer Teil der Token ist noch nicht im Umlauf; künftige Freigaben können den Kurs belasten.");
  if (metrics.circulatingShareOfMaxPct !== null && metrics.circulatingShareOfMaxPct < 60) risks.push(`Erst ${num(metrics.circulatingShareOfMaxPct, 0)} % des Maximalangebots sind im Umlauf.`);
  if (metrics.pegDeviationPct !== null && metrics.pegDeviationPct > 1) risks.push(`Abweichung vom angestrebten Gegenwert: ${num(metrics.pegDeviationPct, 2)} %.`);
  if (metrics.volatility365dPct !== null && metrics.volatility365dPct > 80) risks.push("Sehr hohe Schwankung: zwischenzeitliche Verluste von mehr als der Hälfte sind möglich.");

  return {
    marketDynamics,
    risks,
    valuation: tags.includes("stablecoin")
      ? "Für Stablecoins zählt nicht ein Kursmodell, sondern die Bindung an den Gegenwert, die Zusammensetzung der Reserven und das Risiko des Emittenten. Diese Angaben liegen hier nicht in geprüfter Form vor."
      : "Nicht belastbar bewertbar: Für Kryptowerte gibt es kein tragfähiges Verfahren, das aus den verfügbaren Marktdaten einen fairen Preis ableitet. Angegeben werden nur beobachtbare Kennzahlen.",
    projectQuality: "Nicht automatisch bewertbar. Tatsächliche Nutzung, Sicherheitsprüfungen, Verteilung der Token und Kontrolle über das Protokoll lassen sich aus Marktdaten nicht ableiten.",
  };
}
