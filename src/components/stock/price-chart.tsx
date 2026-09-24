"use client";

import { useMemo, useState } from "react";
import type { Candle } from "@/lib/data/types";
import { PERIOD_LABELS, sliceByPeriod, totalReturnPct, type PeriodKey } from "@/lib/finance/performance";
import { formatDate, formatNumber } from "@/lib/finance/format";
import { Delta } from "@/components/common/data";
import { cn } from "@/lib/utils";

const PERIODS: PeriodKey[] = ["1M", "3M", "YTD", "1J", "3J", "5J", "MAX"];
const SHORT: Record<PeriodKey, string> = {
  "1M": "1M",
  "3M": "3M",
  YTD: "lfd. Jahr",
  "1J": "1J",
  "3J": "3J",
  "5J": "5J",
  MAX: "Max",
};

const WIDTH = 720;
const HEIGHT = 240;
const PADDING = { top: 12, right: 8, bottom: 22, left: 8 };

export function PriceChart({ candles, currency }: { candles: Candle[]; currency: string }) {
  const [period, setPeriod] = useState<PeriodKey>("1J");

  const view = useMemo(() => {
    const slice = sliceByPeriod(candles, period);
    if (slice.length < 2) return null;

    const closes = slice.map((c) => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;

    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;

    const points = slice.map((candle, i) => {
      const x = PADDING.left + (i / (slice.length - 1)) * innerW;
      const y = PADDING.top + innerH - ((candle.close - min) / span) * innerH;
      return { x, y, candle };
    });

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
    const area = `${line} L${points[points.length - 1].x.toFixed(2)} ${HEIGHT - PADDING.bottom} L${points[0].x.toFixed(2)} ${HEIGHT - PADDING.bottom} Z`;

    return {
      slice,
      line,
      area,
      min,
      max,
      change: totalReturnPct(closes),
      first: slice[0],
      last: slice[slice.length - 1],
    };
  }, [candles, period]);

  const dir = view?.change === null || view?.change === undefined ? 0 : view.change >= 0 ? 1 : -1;
  const stroke = dir >= 0 ? "var(--pos)" : "var(--neg)";
  const gradientId = "kursverlauf-flaeche";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="rail flex gap-1 overflow-x-auto" role="tablist" aria-label="Zeitraum des Kurscharts">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                "shrink-0 rounded-[8px] px-2.5 py-1 text-[12px] font-semibold transition-colors",
                period === p ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface-3 hover:text-ink",
              )}
            >
              {SHORT[p]}
            </button>
          ))}
        </div>
        {view ? (
          <div className="ml-auto flex items-center gap-2 text-[12px] text-faint">
            <span>{PERIOD_LABELS[period]}</span>
            <Delta value={view.change} size="sm" />
          </div>
        ) : null}
      </div>

      {view ? (
        <figure>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[200px] w-full sm:h-[240px]"
            role="img"
            aria-label={`Kursverlauf über ${PERIOD_LABELS[period]}. Von ${formatNumber(view.first.close)} auf ${formatNumber(view.last.close)} ${currency}.`}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>

            {[0, 0.5, 1].map((t) => {
              const y = PADDING.top + t * (HEIGHT - PADDING.top - PADDING.bottom);
              return (
                <line
                  key={t}
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth="1"
                  strokeDasharray={t === 1 ? undefined : "3 4"}
                />
              );
            })}

            <path d={view.area} fill={`url(#${gradientId})`} />
            <path
              d={view.line}
              fill="none"
              stroke={stroke}
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />

            <text x={PADDING.left} y={HEIGHT - 6} className="num" fontSize="11" fill="var(--ink-faint)">
              {formatDate(view.first.date)}
            </text>
            <text
              x={WIDTH - PADDING.right}
              y={HEIGHT - 6}
              textAnchor="end"
              className="num"
              fontSize="11"
              fill="var(--ink-faint)"
            >
              {formatDate(view.last.date)}
            </text>
          </svg>

          <figcaption className="num mt-1 flex justify-between text-[11px] text-faint">
            <span>Tief {formatNumber(view.min)} {currency}</span>
            <span>Hoch {formatNumber(view.max)} {currency}</span>
          </figcaption>
        </figure>
      ) : (
        <p className="rounded-[10px] border border-dashed border-line-strong px-4 py-6 text-[13px] text-muted">
          Keine verlässlichen Daten verfügbar für diesen Zeitraum.
        </p>
      )}
    </div>
  );
}
