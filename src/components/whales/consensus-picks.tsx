import Link from "next/link";
import { getConsensusPicks } from "@/lib/services/whales";
import { Card, Chip, SectionTitle } from "@/components/ui/primitives";
import { formatCompact } from "@/lib/finance/format";

/**
 * Reine Auswertung der bereits geladenen 13F-Bestaende: welche Aktien
 * halten mehrere der beobachteten Fonds gleichzeitig. Keine neue
 * Datenquelle, keine Schaetzung - nur Zaehlen echter, bereits vorhandener
 * Positionen.
 */
export async function ConsensusPicks() {
  const { picks, issues } = await getConsensusPicks();
  const top = picks.slice(0, 12);

  if (top.length === 0) return null;

  return (
    <section aria-labelledby="konsens-kaeufe">
      <SectionTitle id="konsens-kaeufe">Konsens-Käufe</SectionTitle>
      <p className="mb-3 max-w-[74ch] text-[13px] leading-relaxed text-muted">
        Aktien, die mindestens drei der beobachteten Fonds laut letzter SEC-13F-Meldung gleichzeitig halten – keine
        Empfehlung, nur eine Zählung echter, bereits gemeldeter Positionen.
      </p>
      {issues.length > 0 ? (
        <p className="mb-3 rounded-[8px] bg-warn-soft px-3 py-2 text-[11px] text-warn">
          {issues.length} Fonds derzeit nicht abrufbar, in der Zählung nicht berücksichtigt: {issues.map((i) => i.profile).join(", ")}
        </p>
      ) : null}

      <Card className="hidden sm:block">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[11px] text-faint">
              <th className="px-4 py-2 font-semibold">Aktie</th>
              <th className="px-2 py-2 font-semibold">Fonds</th>
              <th className="px-2 py-2 font-semibold">davon neu/erhöht</th>
              <th className="px-2 py-2 font-semibold">Gesamtwert (dieser Fonds)</th>
              <th className="px-4 py-2 font-semibold">Wer hält</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {top.map((p) => (
              <tr key={p.cusip}>
                <td className="px-4 py-2.5 font-semibold">{p.issuerName}</td>
                <td className="num px-2 py-2.5">{p.fundCount}</td>
                <td className="px-2 py-2.5">{p.newOrIncreasedCount > 0 ? <Chip tone="pos">{p.newOrIncreasedCount}</Chip> : <span className="text-faint">0</span>}</td>
                <td className="num px-2 py-2.5">{formatCompact(p.totalValueUsd, "USD")}</td>
                <td className="max-w-[320px] px-4 py-2.5 text-muted">
                  {p.funds.map((f) => f.displayName.split(" / ")[0]).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ul className="grid gap-2 sm:hidden">
        {top.map((p) => (
          <li key={p.cusip}>
            <Card className="p-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold">{p.issuerName}</span>
                <span className="ml-auto num text-[11px] text-faint">{p.fundCount} Fonds</span>
              </div>
              <p className="mt-1 text-[12px] text-muted">{p.funds.map((f) => f.displayName.split(" / ")[0]).join(", ")}</p>
              <p className="num mt-1.5 text-[12px] text-muted">
                {formatCompact(p.totalValueUsd, "USD")} gesamt
                {p.newOrIncreasedCount > 0 ? <> · <Chip tone="pos">{p.newOrIncreasedCount} neu/erhöht</Chip></> : null}
              </p>
            </Card>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        Aus den 13F-Meldungen der Fonds unter <Link href="/grosse-fische" className="underline decoration-dotted underline-offset-2">Große Fische</Link> errechnet, bis zu 45 Tage Meldeverzug.
      </p>
    </section>
  );
}
