import { formatCompact } from "@/lib/finance/format";

const SLOT_CLASSES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"];

export interface AllocationSlice { label: string; valueUsd: number }

/**
 * Horizontaler Segmentbalken statt Kreisdiagramm: bei mehreren, teils langen
 * Firmennamen deutlich besser lesbar als duenne Tortenstuecke. Farben aus dem
 * validierten kategorialen Chart-Set (siehe globals.css), Reihenfolge fix.
 * Prozentzahlen stehen immer als Text da, nie nur als Farbe.
 */
export function AllocationBar({ slices, totalUsd }: { slices: AllocationSlice[]; totalUsd: number }) {
  if (totalUsd <= 0 || slices.length === 0) return null;
  const top = slices.slice(0, 5);
  const restUsd = Math.max(0, totalUsd - top.reduce((s, x) => s + x.valueUsd, 0));
  const segments = restUsd > 0 ? [...top, { label: "Sonstige", valueUsd: restUsd }] : top;

  return (
    <div>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`Depotaufteilung: ${segments.map((s) => `${s.label} ${((s.valueUsd / totalUsd) * 100).toFixed(0)} Prozent`).join(", ")}`}
      >
        {segments.map((s, i) => {
          const pct = (s.valueUsd / totalUsd) * 100;
          return (
            <span
              key={s.label}
              className={`h-full ${i < 5 ? SLOT_CLASSES[i] : "bg-line-strong"} ${i > 0 ? "ml-[2px]" : ""}`}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${pct.toFixed(1)} % (${formatCompact(s.valueUsd, "USD")})`}
            />
          );
        })}
      </div>

      <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
        {segments.map((s, i) => {
          const pct = (s.valueUsd / totalUsd) * 100;
          return (
            <li key={s.label} className="flex items-center gap-1.5 text-[11px]">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-[2px] ${i < 5 ? SLOT_CLASSES[i] : "bg-line-strong"}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="num shrink-0 font-semibold">{pct.toFixed(0)} %</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
