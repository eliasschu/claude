import type { Scorecard } from "@/lib/finance/stock-scorecard";
import type { UiDataMeta } from "@/lib/data/types";
import { Card, CardBody, CardHeader, Chip, Meter } from "@/components/ui/primitives";
import { DataStamp } from "@/components/common/data";

function tone(score: number | null) {
  if (score === null) return "neutral" as const;
  if (score >= 65) return "pos" as const;
  if (score >= 40) return "warn" as const;
  return "neg" as const;
}

function overallText(score: number | null) {
  if (score === null) return "Keine Gesamteinordnung möglich";
  if (score >= 70) return "Überwiegend starke Kennzahlen";
  if (score >= 55) return "Solides Gesamtbild mit einzelnen Schwächen";
  if (score >= 40) return "Gemischtes Bild";
  return "Überwiegend schwache Kennzahlen";
}

export function ScorecardCard({ card, meta }: { card: Scorecard; meta: UiDataMeta }) {
  return (
    <Card>
      <CardHeader
        title="Scorecard"
        description="Sieben Dimensionen von 0 bis 100 – Methode, Gewicht und Kennzahlen stehen an jeder Zeile."
      />
      <CardBody>
        <div className="flex items-center gap-4 rounded-[12px] bg-surface-2 p-4">
          <p className="num text-[36px] font-extrabold leading-none tracking-[-0.03em]">{card.overall ?? "–"}</p>
          <div>
            <p className="text-[14px] font-bold">{overallText(card.overall)}</p>
            <p className="text-[12px] text-muted">{card.overallNote}</p>
          </div>
        </div>

        {card.redFlags.length > 0 ? (
          <div className="mt-3 rounded-[10px] border border-neg/30 bg-neg-soft px-3 py-2.5">
            <p className="text-[11px] font-semibold text-neg">Warnsignale</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-ink">
              {card.redFlags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        ) : null}

        <ul className="mt-4 space-y-3">
          {card.dimensions.map((d) => (
            <li key={d.key}>
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold">{d.label}</span>
                <span className="num text-[11px] text-faint">Gewicht {(d.weight * 100).toFixed(0)} %</span>
                <span className="num ml-auto text-[13px] font-bold">{d.score ?? "k. A."}</span>
              </div>
              <Meter value={d.score} tone={tone(d.score)} className="mt-1.5" label={`${d.label} ${d.score ?? "keine Angabe"}`} />
              <p className="mt-1 text-[11px] leading-snug text-faint">{d.method} · Vergleich: {d.comparison}</p>
              {d.unavailableReason ? (
                <p className="mt-0.5 text-[11px] leading-snug text-faint">{d.unavailableReason}</p>
              ) : d.metrics.length > 0 ? (
                <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted">
                  {d.metrics.map((m) => <li key={m.label}>{m.label}: <span className="num font-semibold text-ink">{m.value}</span></li>)}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center gap-2 text-[11px] text-faint">
          <Chip tone="neutral">{card.dataQuality.coveragePct}% Datenabdeckung</Chip>
          {card.dataQuality.ageMonths !== null ? <span>Jahresabschluss vom {card.dataQuality.latestFiscalYearEnd}</span> : null}
        </div>

        <div className="mt-4">
          <DataStamp meta={meta} />
        </div>
      </CardBody>
    </Card>
  );
}
