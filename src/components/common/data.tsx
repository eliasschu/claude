import type { UiDataMeta } from "@/lib/data/types";
import { Chip, QualityMarks } from "@/components/ui/primitives";
import { formatDateTime, formatPercent, formatPp } from "@/lib/finance/format";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<UiDataMeta["mode"], string> = {
  realtime: "Echtzeit",
  delayed: "Verzögert",
  close: "Schlusskurs",
};

/**
 * Herkunftszeile. Sitzt unter jeder Datenflaeche und beantwortet vier Fragen:
 * Woher, wann, welche Kursart, wie verlaesslich.
 */
export function DataStamp({ meta, className }: { meta: UiDataMeta; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint", className)}>
      <Chip tone="neutral">{MODE_LABEL[meta.mode]}</Chip>
      <span>
        Stand {formatDateTime(meta.asOf, meta.timezone)}
      </span>
      <span aria-hidden="true">·</span>
      {meta.sourceUrl ? (
        <a href={meta.sourceUrl} className="underline decoration-dotted underline-offset-2 hover:text-ink">
          {meta.source}
        </a>
      ) : (
        <span>{meta.source}</span>
      )}
      <QualityMarks quality={meta.quality} className="ml-auto" />
    </div>
  );
}

/**
 * Kursveraenderung. Farbe allein traegt die Information nicht – es gibt immer
 * zusaetzlich ein Richtungszeichen und einen Text für Screenreader.
 */
export function Delta({
  value,
  unit = "percent",
  size = "md",
  className,
}: {
  value: number | null | undefined;
  unit?: "percent" | "pp";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const invalid = value === null || value === undefined || !Number.isFinite(value);
  const dir = invalid ? 0 : (value as number) > 0 ? 1 : (value as number) < 0 ? -1 : 0;
  const text = unit === "pp" ? formatPp(value ?? null) : formatPercent(value ?? null);

  const tone =
    dir > 0 ? "text-pos" : dir < 0 ? "text-neg" : "text-muted";
  const sizes = { sm: "text-[12px]", md: "text-[13px]", lg: "text-[17px]" }[size];
  const glyph = dir > 0 ? "▲" : dir < 0 ? "▼" : "■";
  const spoken = dir > 0 ? "Anstieg" : dir < 0 ? "Rückgang" : "unverändert";

  return (
    <span className={cn("num inline-flex items-center gap-1 font-semibold", tone, sizes, className)}>
      <span aria-hidden="true" className="text-[0.72em] leading-none">
        {glyph}
      </span>
      <span>{text}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

/** Kleiner Verlaufsfunke ohne Achsen – reine Formangabe. */
export function Sparkline({
  values,
  direction = 0,
  width = 96,
  height = 28,
  className,
}: {
  values: number[];
  direction?: number;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const stroke = direction > 0 ? "var(--pos)" : direction < 0 ? "var(--neg)" : "var(--ink-faint)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label="Verlauf des Tages"
      preserveAspectRatio="none"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
