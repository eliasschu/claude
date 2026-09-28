import { getCompanyFacts } from "@/lib/sources/sec";
import { quarterlyOverview, type QuarterCell } from "@/lib/finance/quarterly";
import type { Quantity } from "@/lib/finance/sec-facts";
import { Card, CardBody, Chip, InfoTip } from "@/components/ui/primitives";
import { formatCompact, formatDate, formatNumber } from "@/lib/finance/format";

const ROWS: { q: Quantity | "margin" | "fcf"; label: string }[] = [
  { q: "revenue", label: "Umsatz" },
  { q: "operatingIncome", label: "Operatives Ergebnis" },
  { q: "margin", label: "Operative Marge" },
  { q: "netIncome", label: "Nettoergebnis" },
  { q: "epsDiluted", label: "Ergebnis je Aktie" },
  { q: "operatingCashFlow", label: "Operativer Cashflow" },
  { q: "capex", label: "Investitionen Sachanlagen" },
  { q: "fcf", label: "Freier Cashflow" },
];

function Growth({ pct, neutral = false }: { pct: number | null; neutral?: boolean }) {
  if (pct === null) return null;
  return <span className={`block text-[10px] font-semibold ${neutral ? "text-muted" : pct >= 0 ? "text-pos" : "text-neg"}`}>{pct >= 0 ? "+" : ""}{formatNumber(pct, 0)} % ggü. Vj.</span>;
}

function Money({ c, unit, perShare = false, neutral = false }: { c?: QuarterCell; unit: string; perShare?: boolean; neutral?: boolean }) {
  if (!c) return <span className="text-faint">–</span>;
  return (
    <>
      <span className="font-semibold">{perShare ? formatNumber(c.value, 2) : formatCompact(c.value)}</span>
      {c.derived ? <sup className="ml-0.5 text-faint" title="aus kumulierten Werten berechnet">Δ</sup> : null}
      {c.revised ? <sup className="ml-0.5 text-warn" title="später angepasst; zuletzt eingereichter Wert">R</sup> : null}
      <Growth pct={c.yoyPct} neutral={neutral} />
      <span className="sr-only">{unit}</span>
    </>
  );
}

/** Die letzten fünf Quartale aus den SEC-Einreichungen - jede Spalte verlinkt ihren Bericht. */
export async function QuarterlySection({ cik }: { cik: number }) {
  const facts = await getCompanyFacts(cik);
  if (!facts.ok) {
    return (
      <Card><CardBody className="pt-4 text-[13px] text-muted sm:pt-5">
        <h2 className="mb-1 text-[15px] font-bold text-ink">Quartalszahlen</h2>
        Quartalszahlen gerade nicht abrufbar ({facts.reason === "not_found" ? "keine strukturierten SEC-Daten" : "SEC nicht erreichbar"}).
      </CardBody></Card>
    );
  }
  const o = quarterlyOverview(facts.data, 5);
  if (o.rows.length === 0) {
    return <Card><CardBody className="pt-4 text-[13px] text-muted sm:pt-5"><h2 className="mb-1 text-[15px] font-bold text-ink">Quartalszahlen</h2>Keine Quartalsumsätze in den SEC-Daten (z. B. Halbjahresberichterstatter).</CardBody></Card>;
  }
  const unit = o.rows[0].unit;
  return (
    <Card>
      <CardBody className="pt-4 sm:pt-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold">Quartalszahlen</h2>
          <Chip tone="accent">SEC-Einreichungen</Chip>
          <span className="text-[11px] text-faint">Beträge in {unit}</span>
          <InfoTip text="Einzelquartale laut 10-Q/10-K. Δ = aus kumulierten Angaben berechnet (z. B. Q4 = Jahr − neun Monate). R = später angepasst, es gilt der zuletzt eingereichte Wert. Wachstum nur gegenüber demselben Quartal des Vorjahres mit gleichem SEC-Konzept. Ergebnis je Aktie nur, wenn direkt gemeldet." />
        </div>
        {o.ttm ? (
          <ul className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([["Umsatz", o.ttm.revenue], ["Operatives Ergebnis", o.ttm.operatingIncome], ["Nettoergebnis", o.ttm.netIncome], ["Freier Cashflow", o.ttm.freeCashFlow]] as const).map(([l, v]) => (
              <li key={l} className="rounded-[10px] border border-accent/30 bg-accent-soft px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">{l} · 12 Monate</p>
                <p className="num text-[16px] font-extrabold text-accent">{formatCompact(v, unit)}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[640px] text-right text-[12px]">
            <thead>
              <tr className="border-b border-line text-[11px] text-faint">
                <th className="sticky left-0 bg-surface py-1.5 pr-3 text-left font-semibold">Quartal bis</th>
                {o.rows.map((r) => (
                  <th key={r.end} className="px-2 py-1.5 font-semibold">
                    {formatDate(r.end)}
                    <a href={r.source.url} className="block font-normal underline decoration-dotted" target="_blank" rel="noreferrer">{r.source.form}</a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num divide-y divide-line">
              {ROWS.map((row) => (
                <tr key={row.q}>
                  <th scope="row" className="sticky left-0 bg-surface py-2 pr-3 text-left font-semibold text-muted">{row.label}</th>
                  {o.rows.map((r) => (
                    <td key={r.end} className="px-2 py-2 align-top">
                      {row.q === "margin"
                        ? r.operatingMarginPct === null ? <span className="text-faint">–</span> : <span className={`font-semibold ${r.operatingMarginPct >= 0 ? "" : "text-neg"}`}>{formatNumber(r.operatingMarginPct, 1)} %</span>
                        : row.q === "fcf"
                          ? r.freeCashFlow === null ? <span className="text-faint">–</span> : <span className={`font-semibold ${r.freeCashFlow >= 0 ? "text-pos" : "text-neg"}`}>{formatCompact(r.freeCashFlow)}</span>
                          : <Money c={r.cells[row.q]} unit={unit} perShare={row.q === "epsDiluted"} neutral={row.q === "capex"} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-faint">Quelle: SEC EDGAR Company Facts · abgerufen {formatDate(facts.meta.fetchedAt)}{facts.meta.stale ? " · älterer Abruf (SEC gerade nicht erreichbar)" : ""}</p>
      </CardBody>
    </Card>
  );
}
