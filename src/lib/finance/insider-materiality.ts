/**
 * "Aussagekraft" einer Insider-Transaktion - eine Einordnung, keine
 * Kauf- oder Verkaufsempfehlung. Regeln und Schwellenwerte stehen hier als
 * Konstanten, damit sie sichtbar und aenderbar sind, und werden unveraendert
 * in der Oberflaeche erklaert.
 */

import type { InsiderCategory } from "../sources/parsers/sec.ts";

export type Materiality = "hoch" | "mittel" | "gering" | "keine";

export const MATERIALITY_THRESHOLDS = {
  /** Ab diesem Wert gilt ein planloser Verkauf als bedeutend. */
  largeSaleValueUsd: 1_000_000,
  /** Oder ab diesem Anteil am gemeldeten Bestand. */
  largeSaleShareOfHolding: 0.05,
  /** Cluster: mindestens so viele verschiedene Insider... */
  clusterMinOwners: 2,
  /** ...innerhalb so vieler Tage kaufen, gilt als hohe Aussagekraft. */
  clusterWindowDays: 14,
};

export interface MaterialityInput {
  category: InsiderCategory;
  table: "direkt" | "derivativ";
  plan10b51: boolean | null;
  value: number | null;
  shareOfHolding: number | null;
  /** Vorberechnet: gehört diese Transaktion zu einem Cluster-Kauf (siehe findClusters)? */
  inBuyCluster: boolean;
}

export interface MaterialityResult {
  level: Materiality;
  reason: string;
}

/**
 * hoch: Kauf am offenen Markt ohne Plan, oder Teil eines Cluster-Kaufs
 *       (mehrere Insider derselben Firma kaufen innerhalb weniger Tage).
 * mittel: Verkauf ohne Plan ab 1 Mio. $ oder ab 5 % des eigenen Bestands.
 * gering: alle anderen Käufe/Verkäufe (z. B. nach Plan, kleine Beträge).
 * keine: Zuteilung, Ausübung, Steuereinbehalt, Schenkung, Rückgabe, Erbfall
 *        und sonstige nicht-marktliche Vorgänge.
 */
export function assessMateriality(input: MaterialityInput): MaterialityResult {
  if (input.category === "kauf" && input.table === "direkt") {
    if (input.inBuyCluster) return { level: "hoch", reason: `Teil eines Cluster-Kaufs: mindestens ${MATERIALITY_THRESHOLDS.clusterMinOwners} Insider derselben Firma kauften innerhalb von ${MATERIALITY_THRESHOLDS.clusterWindowDays} Tagen.` };
    if (input.plan10b51 === false || input.plan10b51 === null) return { level: "hoch", reason: "Kauf am offenen Markt ohne erkennbaren Plan." };
    return { level: "gering", reason: "Kauf im Rahmen eines vorab festgelegten Plans." };
  }
  if (input.category === "verkauf" && input.table === "direkt") {
    const large =
      (input.value !== null && input.value >= MATERIALITY_THRESHOLDS.largeSaleValueUsd) ||
      (input.shareOfHolding !== null && input.shareOfHolding >= MATERIALITY_THRESHOLDS.largeSaleShareOfHolding);
    if (input.plan10b51 !== true && large) {
      return { level: "mittel", reason: `Großer Verkauf ohne erkennbaren Plan (ab ${(MATERIALITY_THRESHOLDS.largeSaleValueUsd / 1_000_000).toFixed(0)} Mio. $ oder ${(MATERIALITY_THRESHOLDS.largeSaleShareOfHolding * 100).toFixed(0)} % des Bestands).` };
    }
    return { level: "gering", reason: input.plan10b51 ? "Verkauf im Rahmen eines vorab festgelegten Plans." : "Kleinerer Verkauf ohne besonderen Umfang." };
  }
  return { level: "keine", reason: "Keine marktliche Kauf- oder Verkaufsentscheidung (Zuteilung, Ausübung, Steuereinbehalt, Schenkung, Rückgabe oder Erbfall)." };
}
