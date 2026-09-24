import { WHALES } from "@/config/whales";
import { getWhalePortfolio } from "@/lib/services/whales";
import { Card, Chip } from "@/components/ui/primitives";
import { formatCompact, formatDate } from "@/lib/finance/format";

const CHANGE_TONE: Record<string, "pos" | "neg" | "neutral" | "warn"> = {
  neu: "pos", "erhöht": "pos", reduziert: "warn", geschlossen: "neg", "unverändert": "neutral",
};

/** Reale SEC-13F-Bestände - vierteljährlich, mit bis zu 45 Tagen Meldeverzug. */
export async function GrosseFischeTeaser() {
  const profile = WHALES[0];
  const result = await getWhalePortfolio(profile);

  if (!result.ok) {
    return (
      <Card className="p-4 sm:p-5">
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-faint">Große Fische</h2>
        <p className="text-[13px] text-muted">Daten derzeit nicht verfügbar: {result.message}</p>
      </Card>
    );
  }

  const top = result.data.holdings.filter((h) => h.change !== "geschlossen").slice(0, 5);

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-faint">Große Fische</h2>
        <span className="ml-auto text-[11px] text-faint">Stand {formatDate(result.data.reportDate)}</span>
      </div>
      <p className="mt-1 text-[13px] font-semibold">{result.data.managerName}</p>
      <p className="text-[11px] text-faint">
        US-Aktienbestand laut SEC-13F, {formatCompact(result.data.totalValueUsd, "USD")} gesamt
        {result.data.previousReportDate ? ` · Vergleich zu ${formatDate(result.data.previousReportDate)}` : ""}
      </p>

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
