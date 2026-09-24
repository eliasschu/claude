import Link from "next/link";
import { getInsiderActivity } from "@/lib/services/insider";
import { STOCK_MOVER_UNIVERSE } from "@/config/movers";
import { Card, Chip, SectionTitle } from "@/components/ui/primitives";
import { formatCompact, formatDate } from "@/lib/finance/format";

/** Jüngste echte SEC-Form-4-Insiderkäufe/-verkäufe der Beobachtungsliste. Kleine Auswahl, damit die
 * Startseite nicht zusätzlich durch viele SEC-Abrufe verlangsamt wird – die volle Liste ist unter /tracker. */
export async function InsiderTeaser() {
  const insider = await getInsiderActivity(STOCK_MOVER_UNIVERSE.slice(0, 5), 60, 5);
  const rows = insider.rows.filter((r) => r.category === "kauf" || r.category === "verkauf").slice(0, 6);

  return (
    <section aria-labelledby="insider-teaser">
      <SectionTitle
        id="insider-teaser"
        right={<Link href="/tracker" className="text-[13px] font-semibold text-accent hover:underline">Zum Tracker</Link>}
      >
        Insider-Käufe und -Verkäufe
      </SectionTitle>
      <Card>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted">Keine gemeldeten Insidertransaktionen in den letzten 60 Tagen (Beobachtungsliste).</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/aktie/${r.ticker}`} className="flex items-center gap-3 px-3 py-2.5 hover:opacity-80 sm:px-4">
                  <Chip tone={r.category === "kauf" ? "pos" : "neg"}>{r.category === "kauf" ? "Kauf" : "Verkauf"}</Chip>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{r.owner}</span>
                    <span className="num block text-[11px] text-faint">{r.ticker} · {formatDate(r.transactionDate)}</span>
                  </span>
                  {r.value !== null ? <span className="num text-[13px] font-bold">{formatCompact(r.value, "USD")}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
