import type { PortfolioTrendPoint } from "@/lib/services/whales";
import { formatCompact, formatDate } from "@/lib/finance/format";

const WIDTH = 96;
const HEIGHT = 26;
const PAD = 3;

/**
 * Kleiner Verlaufs-Trend ueber bis zu drei Quartale Gesamtportfoliowert.
 * Das ist eine Wertrichtung (wie ein Kurs), keine Kategorie - pos/neg sind
 * hier zulaessig, nicht nur fuer einzelne Aktienkurse.
 */
export function TrendSparkline({ trend }: { trend: PortfolioTrendPoint[] }) {
  if (trend.length < 2) return null;

  const values = trend.map((t) => t.totalValueUsd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = trend.map((t, i) => ({
    x: PAD + (i / (trend.length - 1)) * (WIDTH - PAD * 2),
    y: HEIGHT - PAD - ((t.totalValueUsd - min) / span) * (HEIGHT - PAD * 2),
  }));

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const up = values[values.length - 1] > values[0];
  const flat = values[values.length - 1] === values[0];
  const stroke = flat ? "var(--ink-faint)" : up ? "var(--pos)" : "var(--neg)";
  const label = trend.map((t) => `${formatDate(t.reportDate)}: ${formatCompact(t.totalValueUsd, "USD")}`).join(", ");

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Portfolio-Verlauf über ${trend.length} Quartale: ${label}`}>
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 2.2 : 1.3} fill={stroke} />
      ))}
    </svg>
  );
}
