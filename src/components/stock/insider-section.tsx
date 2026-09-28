import { getInsiderActivity, visibleRows, type InsiderRow } from "@/lib/services/insider";
import { Card, CardBody, Chip, InfoTip } from "@/components/ui/primitives";
import { HoldingShare } from "@/components/insider/holding-share";
import { formatCompact, formatDate, formatNumber } from "@/lib/finance/format";

const MAX_FILINGS = 60;

const ACTION: Partial<Record<InsiderRow["category"], { label: string; tone: "pos" | "neg" | "neutral" | "warn" }>> = {
  kauf: { label: "▲ Kauf", tone: "pos" }, verkauf: { label: "▼ Verkauf", tone: "neg" },
  zuteilung: { label: "Zuteilung", tone: "neutral" }, ausuebung: { label: "Ausübung", tone: "warn" },
};

function Tile({ label, value, sub, tone, tip }: { label: string; value: string; sub: string; tone: string; tip: string }) {
  return (
    <li className={`rounded-[12px] border p-3 ${tone}`}>
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint">{label}<InfoTip text={tip} /></p>
      <p className="num mt-0.5 text-[18px] font-extrabold">{value}</p>
      <p className="text-[11px] text-muted">{sub}</p>
    </li>
  );
}

/** Insidergeschäfte der letzten 12 Monate aus den Form-4-Meldungen - Summen, Plananteil und Einzelgeschäfte. */
export async function InsiderSection({ ticker }: { ticker: string }) {
  const activity = await getInsiderActivity([ticker], 365, MAX_FILINGS);
  if (activity.rows.length === 0) {
    return (
      <Card><CardBody className="pt-4 text-[13px] text-muted sm:pt-5">
        <h2 className="mb-1 text-[15px] font-bold text-ink">Insider (12 Monate)</h2>
        {activity.issues.length ? "Form-4-Meldungen gerade nicht abrufbar." : "Keine Form-4-Meldungen in den letzten 12 Monaten."}
      </CardBody></Card>
    );
  }
  const rows = activity.rows;
  const filings = new Set(rows.map((r) => r.id.replace(/-\d+$/, ""))).size;
  const sales = rows.filter((r) => r.category === "verkauf" && r.table === "direkt");
  const buys = rows.filter((r) => r.category === "kauf" && r.table === "direkt");
  const planSales = sales.filter((r) => r.plan10b51 === true);
  const grants = rows.filter((r) => r.category === "zuteilung" && r.table === "direkt");
  const tax = rows.filter((r) => r.category === "steuereinbehalt");
  const sum = (list: InsiderRow[]) => list.reduce((a, r) => a + (r.value ?? 0), 0);
  const shares = (list: InsiderRow[]) => list.reduce((a, r) => a + (r.shares ?? 0), 0);
  const list = visibleRows(rows)
    .filter((r) => r.table === "direkt" && ACTION[r.category])
    .sort((a, b) => (b.transactionDate ?? "").localeCompare(a.transactionDate ?? ""))
    .slice(0, 15);

  return (
    <Card>
      <CardBody className="pt-4 sm:pt-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold">Insider (12 Monate)</h2>
          <Chip tone="accent">SEC Form 4</Chip>
          <span className="text-[11px] text-faint">aus {filings} Meldungen{filings >= MAX_FILINGS ? ` (die neuesten ${MAX_FILINGS})` : ""}</span>
        </div>
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile label="Verkäufe" value={formatCompact(sum(sales), "USD")} sub={`${sales.length} Geschäfte`} tone="border-neg/30 bg-neg-soft"
            tip="Verkäufe am offenen Markt oder privat (Code S), Summe aus Stückzahl × Preis laut Meldung." />
          <Tile label="davon mit Plan" value={sales.length ? `${formatNumber((planSales.length / sales.length) * 100, 0)} %` : "–"} sub={`${planSales.length} von ${sales.length} Verkäufen`} tone="border-line bg-surface-2"
            tip="Verkäufe mit vorab festgelegtem Handelsplan (Rule 10b5-1). Sie sind weniger aussagekräftig, weil der Zeitpunkt vorher feststand." />
          <Tile label="Käufe" value={formatCompact(sum(buys), "USD")} sub={`${buys.length} Geschäfte`} tone="border-pos/30 bg-pos-soft"
            tip="Käufe am offenen Markt oder privat (Code P) - das seltenere und meist aussagekräftigere Signal." />
          <Tile label="Zuteilungen" value={`${formatCompact(shares(grants))} Aktien`} sub={`${grants.length} Zuteilungen · ${tax.length} Steuereinbehalte`} tone="border-line bg-surface-2"
            tip="Aktienvergütung (Code A) - kein Kauf mit eigenem Geld. Steuereinbehalte (Code F) sind Aktien, die zur Steuerzahlung einbehalten werden." />
        </ul>

        <div className="relative -mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[11px] text-faint">
                <th className="py-1.5 pr-2 font-semibold">Person</th>
                <th className="px-2 py-1.5 font-semibold">Datum</th>
                <th className="px-2 py-1.5 font-semibold">Aktion</th>
                <th className="px-2 py-1.5 text-right font-semibold">Stück × Preis</th>
                <th className="px-2 py-1.5 text-right font-semibold">Wert</th>
                <th className="px-2 py-1.5 font-semibold">Anteil am Bestand</th>
                <th className="py-1.5 pl-2 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((r) => {
                const a = ACTION[r.category]!;
                return (
                  <tr key={r.id}>
                    <td className="py-2 pr-2 font-semibold">{r.owner}<span className="block text-[11px] font-normal text-faint">{r.role}</span></td>
                    <td className="num px-2 py-2">{r.transactionDate ? formatDate(r.transactionDate) : "–"}
                      {r.delayDays !== null ? <span className={`block text-[10px] ${r.delayDays > 2 ? "text-neg" : "text-faint"}`}>gemeldet nach {r.delayDays} Tg.</span> : null}
                    </td>
                    <td className="px-2 py-2">
                      <Chip tone={a.tone}>{a.label}</Chip>
                      {r.plan10b51 === true ? <Chip tone="neutral" className="ml-1" title="Vorab festgelegter Handelsplan (Rule 10b5-1)">Plan</Chip> : null}
                    </td>
                    <td className="num px-2 py-2 text-right">{r.shares !== null ? formatNumber(r.shares, 0) : "–"}{r.price ? <span className="block text-[11px] text-faint">× {formatNumber(r.price, 2)} $</span> : null}</td>
                    <td className="num px-2 py-2 text-right font-semibold">{formatCompact(r.value, "USD")}</td>
                    <td className="px-2 py-2"><HoldingShare r={r} compact /></td>
                    <td className="py-2 pl-2"><a href={r.documentUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted" aria-label="Form 4 bei der SEC">↗</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-faint">Quelle: SEC EDGAR, Form 4. Zuteilungen und Steuereinbehalte sind Vergütung, keine Kauf- oder Verkaufsentscheidung.</p>
      </CardBody>
    </Card>
  );
}
