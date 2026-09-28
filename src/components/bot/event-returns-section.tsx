import { getStockSeries } from "@/lib/sources/twelvedata";
import { eventReturns, toDailyBars, type EventReturns, type HorizonRow } from "@/lib/finance/event-returns";
import { Card, CardBody } from "@/components/ui/primitives";
import { formatDate } from "@/lib/finance/format";

const BENCH = "SPY";

function Pct({ v }: { v: number | null }) {
  if (v === null) return <span className="text-faint">–</span>;
  return <span className={v >= 0 ? "text-pos" : "text-neg"}>{v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(1).replace(".", ",")} %</span>;
}
function Pp({ v }: { v: number | null }) {
  if (v === null) return <span className="text-faint">–</span>;
  return <span>{v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(1).replace(".", ",")} Pp.</span>;
}

function Row({ r, label }: { r: HorizonRow; label: string }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-2 pr-2 text-left font-semibold">{label}</th>
      {r.status === "noch_nicht_erreicht" ? (
        <td colSpan={3} className="py-2 text-faint">noch nicht erreicht</td>
      ) : (
        <>
          <td className="num py-2 pr-2"><Pct v={r.stockPct} /></td>
          <td className="num py-2 pr-2"><Pct v={r.benchPct} /></td>
          <td className="num py-2"><Pp v={r.excessPp} /></td>
        </>
      )}
    </tr>
  );
}

function Table({ title, result }: { title: string; result: EventReturns }) {
  return (
    <div>
      <p className="text-[12px] font-bold">{title}</p>
      {!result.ok ? (
        <p className="mt-1 text-[12px] text-muted">{result.reason}</p>
      ) : (
        <>
          <p className="mt-0.5 text-[11px] text-faint">Ausgangspunkt: Schlusskurs vom {formatDate(result.base.date)} (erster Handelsschluss danach)</p>
          <table className="mt-1.5 w-full text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-faint">
                <th className="py-1 pr-2 font-semibold">Zeitraum</th><th className="py-1 pr-2 font-semibold">Aktie</th>
                <th className="py-1 pr-2 font-semibold">{BENCH}</th><th className="py-1 font-semibold">Differenz</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => <Row key={r.horizon} r={r} label={`${r.horizon} ${r.horizon === 1 ? "Handelstag" : "Handelstage"}`} />)}
              {result.latest.tradingDays > 0 ? <Row r={result.latest} label={`bis ${formatDate(result.latest.endDate)} (${result.latest.tradingDays} T.)`} /> : null}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/**
 * Spaeterer Kursverlauf, getrennt ab Veroeffentlichung und ab Erkennung durch den Bot. Nur mit Kursdaten
 * (Twelve Data, Gratistarif nur private Nutzung); sonst eine klare Begruendung.
 */
export async function EventReturnsSection({ ticker, publishedAt, detectedAt }: { ticker: string | null; publishedAt: string; detectedAt: string }) {
  if (!ticker) return <p className="text-[13px] text-muted">Kein Börsenkürzel bekannt, deshalb kein Kursverlauf.</p>;
  const [stock, bench] = await Promise.all([getStockSeries(ticker, "1day", 400), getStockSeries(BENCH, "1day", 400)]);
  if (!stock.ok) {
    return (
      <p className="rounded-[10px] border border-dashed border-line-strong px-4 py-3 text-[13px] text-muted">
        Kursdaten nicht verfügbar: {stock.message}
      </p>
    );
  }
  const s = toDailyBars(stock.data);
  const b = bench.ok ? toDailyBars(bench.data) : null;
  return (
    <Card>
      <CardBody className="space-y-4 pt-4 sm:pt-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Table title="Ab Veröffentlichung" result={eventReturns(s, b, publishedAt)} />
          <Table title="Ab Erkennung durch den Bot" result={eventReturns(s, b, detectedAt)} />
        </div>
        <p className="text-[11px] leading-relaxed text-faint">
          Schlusskurse laut Twelve Data (Gratistarif, nur private Nutzung; Bereinigung um Splits und Dividenden nicht geprüft).
          {b ? ` Vergleich: ${BENCH} als Näherung für den US-Gesamtmarkt.` : ` Vergleichsreihe ${BENCH} nicht verfügbar.`} Ein Kursverlauf nach
          einer Meldung belegt keine Ursache, und einzelne Fälle sagen nichts über die Regel insgesamt.
        </p>
      </CardBody>
    </Card>
  );
}
