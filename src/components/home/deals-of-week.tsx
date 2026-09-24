import Link from "next/link";
import { getInsiderActivity, visibleRows } from "@/lib/services/insider";
import { STOCK_MOVER_UNIVERSE } from "@/config/movers";
import { Card, Chip, SectionTitle } from "@/components/ui/primitives";
import { formatCompact, formatDate } from "@/lib/finance/format";

const MATERIALITY_TONE: Record<string, "pos" | "warn"> = { hoch: "pos", mittel: "warn" };

/** Nur Aussagekraft mittel und hoch, sortiert danach - Zuteilungen, Ausübungen usw. bleiben aussen vor. */
export async function DealsOfWeek() {
  const activity = await getInsiderActivity(STOCK_MOVER_UNIVERSE, 30, 15);
  const rows = visibleRows(activity.rows)
    .filter((r) => (r.category === "kauf" || r.category === "verkauf") && (r.materiality === "hoch" || r.materiality === "mittel"))
    .sort((a, b) => (a.materiality === b.materiality ? (b.value ?? 0) - (a.value ?? 0) : a.materiality === "hoch" ? -1 : 1))
    .slice(0, 15);

  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="deals-der-woche">
      <SectionTitle id="deals-der-woche" right={<Link href="/tracker" className="text-[13px] font-semibold text-accent hover:underline">Alle Meldungen</Link>}>
        Deals der Woche
      </SectionTitle>
      <p className="mb-3 max-w-[74ch] text-[13px] leading-relaxed text-muted">
        Nur Insidergeschäfte mit mittlerer oder hoher Aussagekraft aus der Beobachtungsliste, sortiert danach.
      </p>

      <Card className="hidden sm:block">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[11px] text-faint">
              <th className="px-4 py-2 font-semibold">Person &amp; Rolle</th>
              <th className="px-2 py-2 font-semibold">Firma</th>
              <th className="px-2 py-2 font-semibold">Volumen &amp; Datum</th>
              <th className="px-2 py-2 font-semibold">Richtung</th>
              <th className="px-2 py-2 font-semibold">Aussagekraft</th>
              <th className="px-2 py-2 font-semibold">Warum es zählt</th>
              <th className="px-4 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 font-semibold">{r.owner}<span className="block text-[11px] font-normal text-faint">{r.role}</span></td>
                <td className="px-2 py-2.5"><Link href={`/aktie/${r.ticker}`} className="hover:underline">{r.ticker}</Link></td>
                <td className="num px-2 py-2.5">{formatCompact(r.value, "USD")}<span className="block text-[11px] text-faint">{r.transactionDate ? formatDate(r.transactionDate) : "–"}</span></td>
                <td className="px-2 py-2.5"><Chip tone={r.category === "kauf" ? "pos" : "neg"}>{r.category === "kauf" ? "▲ Kauf" : "▼ Verkauf"}</Chip></td>
                <td className="px-2 py-2.5"><Chip tone={MATERIALITY_TONE[r.materiality]}>{r.materiality}</Chip></td>
                <td className="max-w-[280px] px-2 py-2.5 text-muted">{r.materialityReason}</td>
                <td className="px-4 py-2.5"><a href={r.documentUrl} className="underline decoration-dotted underline-offset-2">↗</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ul className="grid gap-2 sm:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Card className="p-3">
              <div className="flex items-center gap-1.5">
                <Chip tone={r.category === "kauf" ? "pos" : "neg"}>{r.category === "kauf" ? "▲ Kauf" : "▼ Verkauf"}</Chip>
                <Chip tone={MATERIALITY_TONE[r.materiality]}>{r.materiality}</Chip>
                <span className="ml-auto num text-[11px] text-faint">{r.transactionDate ? formatDate(r.transactionDate) : "–"}</span>
              </div>
              <p className="mt-2 text-[13px] font-semibold">{r.owner} <span className="font-normal text-faint">· {r.role}</span></p>
              <p className="num text-[12px] text-muted">
                <Link href={`/aktie/${r.ticker}`} className="hover:underline">{r.ticker}</Link> · {formatCompact(r.value, "USD")}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{r.materialityReason}</p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
