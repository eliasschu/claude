import type { Dimension, Scorecard } from "@/lib/finance/stock-scorecard";
import type { UiDataMeta } from "@/lib/data/types";
import { Card, CardBody, CardHeader, Chip, InfoTip } from "@/components/ui/primitives";
import { DataStamp } from "@/components/common/data";

/** Grün ab 70, Gelb 40–69, Rot unter 40, Grau ohne Daten. */
function tone(score: number | null): "pos" | "warn" | "neg" | "neutral" {
  if (score === null) return "neutral";
  if (score >= 70) return "pos";
  if (score >= 40) return "warn";
  return "neg";
}

const TILE: Record<ReturnType<typeof tone>, string> = {
  pos: "border-pos/40 bg-pos-soft", warn: "border-warn/40 bg-warn-soft", neg: "border-neg/40 bg-neg-soft", neutral: "border-dashed border-line bg-surface-2",
};
const BAR: Record<ReturnType<typeof tone>, string> = { pos: "bg-pos", warn: "bg-warn", neg: "bg-neg", neutral: "bg-line" };
const TEXT: Record<ReturnType<typeof tone>, string> = { pos: "text-pos", warn: "text-warn", neg: "text-neg", neutral: "text-faint" };

function verdict(score: number) {
  if (score >= 70) return "Starke Kennzahlen";
  if (score >= 55) return "Solide, mit Schwächen";
  if (score >= 40) return "Gemischtes Bild";
  return "Schwache Kennzahlen";
}

/** Kurzer Grund statt Textblock - Details im ℹ. */
function missingBadge(d: Dimension) {
  const r = d.unavailableReason ?? "";
  if (/Kurs/.test(r)) return "braucht Kursdaten";
  if (/Analysten|lizenziert/.test(r)) return "braucht Analystendaten";
  return "keine Daten";
}

function Tile({ d }: { d: Dimension }) {
  const t = tone(d.score);
  const main = d.metrics[0];
  return (
    <li className={`flex min-h-[112px] flex-col rounded-[12px] border p-3 ${TILE[t]}`}>
      <div className="flex items-start gap-1">
        <span className="text-[12px] font-bold leading-tight">{d.label}</span>
        <span className="ml-auto"><InfoTip label={`Methode ${d.label}`} text={`${d.method} Gewicht ${(d.weight * 100).toFixed(0)} %. Vergleich: ${d.comparison}.${d.unavailableReason ? ` ${d.unavailableReason}` : ""}`} /></span>
      </div>
      {d.score !== null ? (
        <>
          <p className={`num mt-1 text-[26px] font-extrabold leading-none ${TEXT[t]}`}>{d.score}</p>
          <span aria-hidden className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-surface/70">
            <span className={`block h-full ${BAR[t]}`} style={{ width: `${d.score}%` }} />
          </span>
          {main ? <p className="mt-1.5 text-[11px] leading-snug text-muted">{main.label}: <span className="num font-semibold text-ink">{main.value}</span></p> : null}
        </>
      ) : (
        <p className="mt-auto"><Chip tone="neutral">{missingBadge(d)}</Chip></p>
      )}
    </li>
  );
}

export function ScorecardCard({ card, meta }: { card: Scorecard; meta: UiDataMeta }) {
  const headline = card.overall ?? card.fundamental?.score ?? null;
  const t = tone(headline);
  const label = card.overall !== null ? "Gesamtwert" : card.fundamental ? "Fundamental-Score" : "Kein Gesamtwert";
  const note = card.overall !== null
    ? card.overallNote
    : card.fundamental
      ? `Nur aus SEC-Jahreszahlen: ${card.fundamental.dimensions.length} Fundamental-Dimensionen. Bewertung, Momentum und Stabilität brauchen Kursdaten.`
      : card.overallNote;
  return (
    <Card>
      <CardHeader title="Scorecard" description="Sieben Dimensionen, 0 bis 100 – Methode hinter jedem ℹ." />
      <CardBody>
        <div className={`flex items-center gap-4 rounded-[12px] border p-4 ${TILE[t]}`}>
          <div className="relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full"
            style={{ background: headline === null ? undefined : `conic-gradient(var(--${t === "neutral" ? "line" : t}) ${headline * 3.6}deg, var(--surface-3) 0)` }}>
            <span className="grid h-[58px] w-[58px] place-items-center rounded-full bg-surface">
              <span className={`num text-[24px] font-extrabold leading-none ${TEXT[t]}`}>{headline ?? "–"}</span>
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</p>
            <p className="text-[15px] font-bold">{headline !== null ? verdict(headline) : "Zu wenige Kennzahlen"}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">{card.overall !== null ? `${card.overallNote}` : "SEC-Jahreszahlen"} <InfoTip text={note} /></p>
          </div>
        </div>

        {card.redFlags.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {card.redFlags.map((f) => <li key={f}><Chip tone="neg" title={f}>⚠ {f.split(/[:.(]/)[0]}</Chip></li>)}
          </ul>
        ) : null}

        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {card.dimensions.map((d) => <Tile key={d.key} d={d} />)}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-faint">
          <Chip tone="neutral">{card.dataQuality.coveragePct} % Datenabdeckung</Chip>
          {card.dataQuality.latestFiscalYearEnd ? <span>Jahresabschluss vom {card.dataQuality.latestFiscalYearEnd}</span> : null}
          <InfoTip text={card.dataQuality.note} />
        </div>
        <div className="mt-3"><DataStamp meta={meta} /></div>
      </CardBody>
    </Card>
  );
}
