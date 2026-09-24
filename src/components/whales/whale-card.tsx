import { WHALES, type WhaleProfile } from "@/config/whales";
import { getWhalePortfolio } from "@/lib/services/whales";
import { Card, Chip } from "@/components/ui/primitives";
import { formatCompact, formatDate } from "@/lib/finance/format";
import { AllocationBar, type AllocationSlice } from "./allocation-bar";

const CHANGE_TONE: Record<string, "pos" | "neg" | "neutral" | "warn"> = {
  neu: "pos", "erhöht": "pos", reduziert: "warn", geschlossen: "neg", "unverändert": "neutral",
};

/** Einzelne Fonds-/Investorenkarte: echte SEC-13F-Bestaende, keine erfundenen Werte. */
export async function WhaleCard({ profile, rows = 5 }: { profile: WhaleProfile; rows?: number }) {
  const result = await getWhalePortfolio(profile);

  if (!result.ok) {
    return (
      <Card className="p-4 sm:p-5">
        <h2 className="text-[13px] font-bold">{profile.displayName}</h2>
        <p className="mt-1 text-[12px] text-muted">Daten derzeit nicht verfügbar: {result.message}</p>
      </Card>
    );
  }

  const open = result.data.holdings.filter((h) => h.change !== "geschlossen").sort((a, b) => b.valueUsd - a.valueUsd);
  const top = open.slice(0, rows);
  const slices: AllocationSlice[] = open.map((h) => ({ label: h.issuerName, valueUsd: h.valueUsd }));

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="text-[13px] font-bold">{profile.displayName}</h2>
        <span className="ml-auto text-[11px] text-faint">Stand {formatDate(result.data.reportDate)}</span>
      </div>
      <p className="text-[11px] text-faint">
        US-Aktienbestand laut SEC-13F, {formatCompact(result.data.totalValueUsd, "USD")} gesamt
        {result.data.previousReportDate ? ` · Vergleich zu ${formatDate(result.data.previousReportDate)}` : ""}
      </p>

      <div className="mt-3">
        <AllocationBar slices={slices} totalUsd={result.data.totalValueUsd} />
      </div>

      <ul className="mt-3 divide-y divide-line">
        {top.map((h) => (
          <li key={h.cusip} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
            <span className="min-w-0 flex-1 truncate font-semibold">{h.issuerName}</span>
            <Chip tone={CHANGE_TONE[h.change] ?? "neutral"}>{h.change}</Chip>
            <span className="num w-[80px] text-right font-semibold">{formatCompact(h.valueUsd, "USD")}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        Meldung mit bis zu 45 Tagen Verzug nach Quartalsende; keine Leerverkäufe, kaum Derivate, keine Positionen außerhalb der USA enthalten.
        {" "}<a href={result.data.documentUrl} className="underline decoration-dotted underline-offset-2">Original ↗</a>
      </p>
    </Card>
  );
}

export const DEFAULT_WHALE = WHALES[0];
