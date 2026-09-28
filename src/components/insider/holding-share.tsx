import type { InsiderRow } from "@/lib/services/insider";
import { Chip } from "@/components/ui/primitives";
import { formatCompact, formatNumber } from "@/lib/finance/format";

/** Anteil am zuvor gemeldeten Bestand der Person an dieser Aktie - nicht ihr Gesamtvermoegen. */
export function HoldingShare({ r, compact = false }: { r: InsiderRow; compact?: boolean }) {
  if (r.shareOfHolding === null) return <span className="text-[11px] text-faint">nicht gemeldet</span>;
  const pct = r.shareOfHolding * 100;
  // Grosse Anteile: Verkauf rot, Kauf gruen; 10-25 % gelb; darunter neutral
  const tone = pct >= 25 ? (r.category === "kauf" ? "pos" : "neg") : pct >= 10 ? "warn" : "neutral";
  const rest = r.sharesAfter !== null && r.price !== null ? r.sharesAfter * r.price : null;
  const verb = r.category === "kauf" ? "aufgestockt um" : "verkauft";
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <Chip tone={tone} title="Anteil dieser Transaktion am zuvor gemeldeten Bestand dieser Besitzform (direkt bzw. über Trust/Gesellschaft). Das Gesamtvermögen der Person ist nicht bekannt.">
          {compact ? "" : `${verb} `}{formatNumber(pct, pct < 10 ? 1 : 0)} %
        </Chip>
        <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-3">
          <span className={`block h-full ${tone === "neg" ? "bg-neg" : tone === "pos" ? "bg-pos" : tone === "warn" ? "bg-warn" : "bg-faint"}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </span>
      </span>
      <span className="text-[11px] text-faint">
        {r.sharesAfter !== null ? `danach ${formatNumber(r.sharesAfter, 0)} Aktien` : ""}{rest !== null ? ` ≈ ${formatCompact(rest, "USD")}` : ""}{r.ownership === "indirekt" ? " · indirekt" : ""}
      </span>
    </span>
  );
}
