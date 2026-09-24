/**
 * Kurze, regelbasierte Einordnungssätze für eine Insider-Transaktion.
 * Ausschliesslich aus den vorhandenen Datenfeldern abgeleitet - keine
 * frei erfundenen Begründungen.
 */

import type { InsiderRow } from "../services/insider.ts";
import { formatCompact } from "./format.ts";

function pct(v: number) {
  return `${(v * 100).toFixed(0)} %`;
}

export function whatItMeans(row: InsiderRow, isLargestInWindow: boolean): string {
  const verb = row.category === "kauf" ? "Kauf" : "Verkauf";
  const parts: string[] = [];
  if (isLargestInWindow) parts.push(`Größter ${verb} in der Beobachtungsliste im aktuellen Zeitraum.`);
  if (row.plan10b51 === true) parts.push("Über einen vorab festgelegten Plan (Rule 10b5-1) gemeldet, also nicht zwingend eine spontane Entscheidung.");
  else parts.push("Ohne erkennbaren vorab festgelegten Plan gemeldet, also eine aktive Entscheidung zum gemeldeten Zeitpunkt.");
  if (row.shareOfHolding !== null && row.shareOfHolding >= 0.05) {
    parts.push(`Entspricht ${pct(row.shareOfHolding)} des zuletzt gemeldeten Bestands der Person.`);
  }
  return parts.join(" ");
}

export function whatItDoesNotMean(row: InsiderRow): string {
  const parts: string[] = ["Ein Grund für die Transaktion wird von der SEC nicht verlangt und ist hier nicht bekannt."];
  if (row.sharesAfter !== null && row.sharesAfter > 0) {
    parts.push(`Die Person hält danach weiterhin ${formatCompact(row.sharesAfter)} Aktien.`);
  }
  if (row.category === "verkauf") {
    parts.push("Ein Verkauf ist keine Aussage über die Erwartung zum Unternehmen - er kann auch persönliche Gründe (Diversifikation, Steuern, Liquidität) haben.");
  }
  return parts.join(" ");
}
