import type { UiDataMeta } from "@/lib/data/types";
import type { ValuationView } from "@/lib/services/stock-analysis";
import { Card, CardBody, CardHeader, Chip, EmptyState, Hint, Meter } from "@/components/ui/primitives";
import { DataStamp } from "@/components/common/data";
import { formatNumber, formatPercent, formatPrice } from "@/lib/finance/format";
import { VERDICT_TEXT } from "@/lib/finance/labels";

function verdictTone(verdict: ValuationView["verdict"]) {
  switch (verdict) {
    case "Bewertung erscheint attraktiv":
      return "pos" as const;
    case "Eher fair bewertet":
      return "neutral" as const;
    case "Hohe Erwartungen eingepreist":
      return "warn" as const;
    default:
      return "neutral" as const;
  }
}

/** Szenarienband: pessimistisch – Basis – optimistisch, mit dem Kurs als Marke. */
function ScenarioBand({
  valuation,
  price,
  currency,
}: {
  valuation: ValuationView;
  price: number;
  currency: string;
}) {
  const values = valuation.scenarios
    .map((s) => s.perShare)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;

  const low = Math.min(...values, price);
  const high = Math.max(...values, price);
  const span = high - low || 1;
  const pos = (value: number) => ((value - low) / span) * 100;

  const bear = valuation.scenarios.find((s) => s.key === "bear")?.perShare ?? null;
  const bull = valuation.scenarios.find((s) => s.key === "bull")?.perShare ?? null;
  const base = valuation.scenarios.find((s) => s.key === "base")?.perShare ?? null;

  return (
    <div className="mt-5 overflow-hidden">
      <div className="relative mx-12 h-[86px]">
        {/* Spanne zwischen pessimistischem und optimistischem Szenario */}
        {bear !== null && bull !== null ? (
          <div
            className="absolute top-[34px] h-2 rounded-full bg-accent-soft"
            style={{ left: `${pos(bear)}%`, width: `${Math.max(pos(bull) - pos(bear), 1)}%` }}
          />
        ) : null}
        <div className="absolute left-0 right-0 top-[34px] h-2 rounded-full border border-line" />

        {base !== null ? (
          <div className="absolute top-[26px]" style={{ left: `${pos(base)}%` }}>
            <div className="-translate-x-1/2">
              <div className="mx-auto h-6 w-[3px] rounded-full bg-accent" />
              <p className="num mt-1 -translate-x-0 whitespace-nowrap text-[11px] font-bold text-accent">
                {formatNumber(base)}
              </p>
            </div>
          </div>
        ) : null}

        <div className="absolute top-[6px]" style={{ left: `${pos(price)}%` }}>
          <div className="-translate-x-1/2 text-center">
            <p className="num whitespace-nowrap text-[11px] font-bold">Kurs {formatNumber(price)}</p>
            <div className="mx-auto mt-1 h-7 w-[3px] rounded-full bg-ink" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {valuation.scenarios.map((scenario) => (
          <div key={scenario.key} className="rounded-[10px] border border-line px-3 py-2">
            <p className="text-[11px] font-semibold text-muted">{scenario.label}</p>
            <p className="num mt-0.5 text-[16px] font-extrabold tracking-[-0.02em]">
              {scenario.perShare === null ? "–" : formatPrice(scenario.perShare, currency)}
            </p>
            <p className="num mt-0.5 text-[11px] text-faint">
              Wachstum {formatPercent(scenario.growth * 100, 1)} ·{" "}
              {scenario.deviationPct === null ? "–" : `${formatPercent(scenario.deviationPct, 0)} zum Kurs`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FairValueCard({
  valuation,
  price,
  currency,
  meta,
}: {
  valuation: ValuationView | null;
  price: number;
  currency: string;
  meta: UiDataMeta;
}) {
  if (!valuation) {
    return (
      <Card>
        <CardHeader title="Modellbewertung" />
        <CardBody>
          <EmptyState
            title="Keine verlässlichen Daten verfügbar"
            hint="Für dieses Wertpapier liegen keine Eingangsgrößen für eine Bewertung vor."
          />
        </CardBody>
      </Card>
    );
  }

  const deviation = valuation.deviationPct;
  const direction = deviation === null ? null : deviation > 0 ? "unter" : "über";

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Modellbewertung
            <Hint text="Eigene Berechnung aus mehreren Bewertungsverfahren. Keine Analystenschätzung, keine Anlageberatung." />
          </span>
        }
        description="Modellschätzung mit offengelegten Annahmen – bewusst als Spanne, nicht als Einzelwert."
      />

      <CardBody>
        <div className="rounded-[12px] bg-surface-2 p-4">
          {deviation === null ? (
            <p className="text-[15px] font-semibold">Keine verlässliche Modellbewertung möglich.</p>
          ) : (
            <>
              <p className="max-w-[52ch] text-[17px] font-bold leading-snug tracking-[-0.01em] sm:text-[19px]">
                Nach unserem Modell liegt die Aktie etwa{" "}
                <span className={deviation > 0 ? "text-pos" : "text-neg"}>
                  {formatNumber(Math.abs(deviation), 0)} % {direction}
                </span>{" "}
                ihrem geschätzten fairen Wert.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone={verdictTone(valuation.verdict)}>{VERDICT_TEXT[valuation.verdict]}</Chip>
                <span className="num text-[12px] text-muted">
                  Fairer Wert {formatPrice(valuation.aggregate.value, currency)} · Spanne{" "}
                  {formatPrice(valuation.aggregate.low, currency)} bis {formatPrice(valuation.aggregate.high, currency)}
                </span>
              </div>
            </>
          )}

          <div className="mt-4 flex items-center gap-3">
            <span className="text-[11px] font-semibold text-muted">
              Konfidenz
              <Hint text="Steigt mit der Zahl der nutzbaren Verfahren und sinkt, wenn deren Ergebnisse weit auseinanderliegen." />
            </span>
            <Meter value={valuation.aggregate.confidence} className="max-w-[220px]" label="Konfidenz der Bewertung" />
            <span className="num text-[12px] font-bold">{valuation.aggregate.confidence}/100</span>
          </div>
        </div>

        <ScenarioBand valuation={valuation} price={price} currency={currency} />

        <h3 className="mb-2 mt-6 text-[13px] font-bold">Verwendete Verfahren</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[11px] text-faint">
                <th className="py-1.5 pr-3 font-semibold">Verfahren</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Fairer Wert</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Gewicht</th>
                <th className="py-1.5 font-semibold">Annahme</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {valuation.methods.map((method) => (
                <tr key={method.id} className={method.value === null ? "text-faint" : ""}>
                  <td className="py-2 pr-3 font-semibold">{method.label}</td>
                  <td className="num py-2 pr-3 text-right">
                    {method.value === null ? "keine Daten" : formatPrice(method.value, currency)}
                  </td>
                  <td className="num py-2 pr-3 text-right">{(method.weight * 100).toFixed(0)} %</td>
                  <td className="py-2 leading-snug text-muted">{method.assumption}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {valuation.terminalShare !== null ? (
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Im Discounted-Cashflow-Modell entfallen{" "}
            <span className="num font-semibold text-ink">{(valuation.terminalShare * 100).toFixed(0)} %</span> des
            Unternehmenswerts auf den Endwert. Je höher dieser Anteil, desto stärker hängt das Ergebnis an
            Annahmen weit in der Zukunft.
          </p>
        ) : null}

        <details className="mt-4 rounded-[10px] border border-line">
          <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold">
            Sensitivität gegenüber Wachstum und Diskontsatz
          </summary>
          <div className="overflow-x-auto border-t border-line p-3">
            <table className="w-full min-w-[420px] text-[12px]">
              <thead>
                <tr className="text-[11px] text-faint">
                  <th className="py-1 pr-3 text-left font-semibold">Diskontsatz \ Wachstum</th>
                  {valuation.sensitivity.growths.map((g) => (
                    <th key={g} className="num py-1 px-2 text-right font-semibold">
                      {(g * 100).toFixed(1)} %
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {valuation.sensitivity.discountRates.map((rate) => (
                  <tr key={rate} className="border-t border-line">
                    <td className="num py-1.5 pr-3 font-semibold">{(rate * 100).toFixed(1)} %</td>
                    {valuation.sensitivity.growths.map((g) => {
                      const cell = valuation.sensitivity.cells.find(
                        (c) => c.discountRate === rate && c.growth === g,
                      );
                      const value = cell?.perShare ?? null;
                      const above = value !== null && value > price;
                      return (
                        <td
                          key={g}
                          className={`num px-2 py-1.5 text-right ${above ? "text-pos" : value === null ? "text-faint" : "text-neg"}`}
                        >
                          {value === null ? "–" : formatNumber(value, 0)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              Werte über dem aktuellen Kurs sind grün, Werte darunter rot. Die Tabelle zeigt, wie stark das Ergebnis
              von zwei Annahmen abhängt.
            </p>
          </div>
        </details>

        <div className="mt-4">
          <DataStamp meta={meta} />
        </div>
      </CardBody>
    </Card>
  );
}
