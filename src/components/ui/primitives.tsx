import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------
   Karte – die Grundflaeche der gesamten Anwendung.
   Die Radienstufe unterscheidet Hierarchie: Panel > Card > Tile > Chip.
   ---------------------------------------------------------------------- */

export function Card({
  className,
  children,
  as: Tag = "section",
}: {
  className?: string;
  children: ReactNode;
  as?: "section" | "article" | "div";
}) {
  return (
    <Tag
      className={cn(
        "rounded-[14px] border border-line bg-surface",
        "shadow-[0_1px_2px_rgb(22_33_30_/_0.04)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  right,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-4 pt-4 pb-3 sm:px-5", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold leading-tight tracking-[-0.01em]">{title}</h2>
        {description ? <p className="mt-1 text-[13px] leading-snug text-muted">{description}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-4 pb-4 sm:px-5 sm:pb-5", className)}>{children}</div>;
}

/* -------------------------------------------------------------------------
   Chips und Marker
   ---------------------------------------------------------------------- */

type ChipTone = "neutral" | "pos" | "neg" | "warn" | "accent" | "demo";

const chipTone: Record<ChipTone, string> = {
  neutral: "bg-surface-3 text-muted",
  pos: "bg-pos-soft text-pos",
  neg: "bg-neg-soft text-neg",
  warn: "bg-warn-soft text-warn",
  accent: "bg-accent-soft text-accent",
  demo: "bg-demo-soft text-demo",
};

export function Chip({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: ChipTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold leading-4",
        chipTone[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Der DEMO-Marker. Er sitzt an jeder Flaeche, die synthetische Zahlen zeigt,
 * und ist bewusst nicht dezent.
 */
export function DemoChip({ className, label = "DEMO" }: { className?: string; label?: string }) {
  return (
    <Chip tone="demo" className={cn("tracking-wide", className)} title="Synthetische Beispieldaten ohne Marktbezug">
      {label}
    </Chip>
  );
}

/* -------------------------------------------------------------------------
   Messbalken – wiederkehrendes Element für Score- und Qualitätsangaben
   ---------------------------------------------------------------------- */

export function Meter({
  value,
  max = 100,
  tone = "accent",
  className,
  label,
}: {
  value: number | null;
  max?: number;
  tone?: "accent" | "pos" | "neg" | "warn" | "neutral";
  className?: string;
  label?: string;
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const bar = {
    accent: "bg-accent",
    pos: "bg-pos",
    neg: "bg-neg",
    warn: "bg-warn",
    neutral: "bg-line-strong",
  }[tone];

  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="meter"
      aria-valuenow={value ?? undefined}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div className={cn("h-full rounded-full", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Vierstufige Datenqualitaet – das wiederkehrende Vertrauenszeichen. */
export function QualityMarks({ quality, className }: { quality: number; className?: string }) {
  const filled = Math.max(0, Math.min(4, Math.round((quality / 100) * 4)));
  const words = ["sehr gering", "gering", "mittel", "gut", "sehr gut"][filled];
  return (
    <span
      className={cn("inline-flex items-center gap-[3px]", className)}
      title={`Datenqualitaet ${quality} von 100 (${words})`}
      aria-label={`Datenqualitaet ${quality} von 100`}
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "block h-2.5 w-[3px] rounded-[1px]",
            i < filled ? "bg-accent" : "bg-line-strong opacity-50",
          )}
        />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------
   Zustaende
   ---------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[10px] bg-surface-3", className)} />;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[10px] border border-dashed border-line-strong px-4 py-6">
      <p className="text-[14px] font-semibold">{title}</p>
      {hint ? <p className="max-w-[52ch] text-[13px] leading-relaxed text-muted">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-[10px] border border-neg/40 bg-neg-soft px-4 py-4">
      <p className="text-[14px] font-semibold text-neg">{title}</p>
      {detail ? <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-ink">{detail}</p> : null}
    </div>
  );
}

/** Kurze Erklärung am Wert selbst, ohne zusaetzliche Bibliothek. */
export function Hint({ text }: { text: string }) {
  return (
    <span
      tabIndex={0}
      title={text}
      aria-label={text}
      className="ml-1 inline-flex h-[14px] w-[14px] cursor-help items-center justify-center rounded-full border border-line-strong text-[9px] font-bold text-faint align-middle"
    >
      ?
    </span>
  );
}

export function SectionTitle({
  children,
  right,
  id,
}: {
  children: ReactNode;
  right?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 id={id} className="text-[19px] font-extrabold tracking-[-0.02em] sm:text-[21px]">
        {children}
      </h2>
      {right}
    </div>
  );
}
