import type { Metadata } from "next";
import Link from "next/link";
import { getInsiderActivity } from "@/lib/services/insider";
import { STOCK_MOVER_UNIVERSE } from "@/config/movers";
import { Card, Chip } from "@/components/ui/primitives";
import { formatCompact, formatDate } from "@/lib/finance/format";

export const metadata: Metadata = { title: "Politiker- und Investorentracker – Finanzwelt-App" };

const CATEGORY_LABEL: Record<string, { label: string; tone: "pos" | "neg" | "warn" | "neutral" }> = {
  kauf: { label: "Kauf", tone: "pos" },
  verkauf: { label: "Verkauf", tone: "neg" },
  ausuebung: { label: "Ausübung", tone: "warn" },
  zuteilung: { label: "Zuteilung", tone: "neutral" },
  sonstige: { label: "Sonstige", tone: "neutral" },
};

export default async function TrackerPage() {
  const insider = await getInsiderActivity(STOCK_MOVER_UNIVERSE, 90, 15);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Politiker- und Investorentracker</h1>
        <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-muted">
          Hier stehen zuletzt öffentlich gemeldete Transaktionen – keine aktuellen Bestände. Zwischen Handel und
          Veröffentlichung liegen oft Tage bis Wochen; der Meldeverzug steht deshalb an jeder Zeile.
        </p>
      </div>

      <Card>
        <div className="px-4 pt-4 sm:px-5">
          <h2 className="text-[15px] font-bold">Insider (SEC Form 4)</h2>
          <p className="mt-1 text-[12px] text-muted">
            Vorstände, Aufsichtsräte und Großaktionäre melden Käufe und Verkäufe eigener Aktien in der Regel binnen
            zwei Geschäftstagen. Beschränkt auf die kuratierte Beobachtungsliste (siehe /datenquellen).
          </p>
        </div>
        {insider.issues.length > 0 ? (
          <p className="mx-4 mt-2 rounded-[8px] bg-warn-soft px-3 py-2 text-[11px] text-warn sm:mx-5">
            {insider.issues.map((i) => `${i.ticker}: ${i.message}`).join(" · ")}
          </p>
        ) : null}
        {insider.clusters.length > 0 ? (
          <div className="mx-4 mt-3 rounded-[10px] border border-pos/30 bg-pos-soft px-3 py-2.5 text-[12px] leading-relaxed sm:mx-5">
            <span className="font-semibold">Cluster-Käufe (mehrere Insider, 30 Tage): </span>
            {insider.clusters.map((c) => `${c.issuerName} (${c.owners.length} Personen)`).join(" · ")}
          </div>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[12px]">
            <thead>
              <tr className="border-y border-line bg-surface-2 text-[11px] text-faint">
                <th className="px-4 py-2 font-semibold sm:px-5">Person</th>
                <th className="px-2 py-2 font-semibold">Wertpapier</th>
                <th className="px-2 py-2 font-semibold">Art</th>
                <th className="px-2 py-2 text-right font-semibold">Wert</th>
                <th className="px-2 py-2 font-semibold">Handelsdatum</th>
                <th className="px-2 py-2 font-semibold">Veröffentlicht</th>
                <th className="px-2 py-2 text-right font-semibold">Verzug</th>
                <th className="px-4 py-2 font-semibold sm:px-5">Meldung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {insider.rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-muted sm:px-5">Keine Meldungen in den letzten 90 Tagen.</td></tr>
              ) : insider.rows.map((r) => {
                const cat = CATEGORY_LABEL[r.category] ?? CATEGORY_LABEL.sonstige;
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 font-semibold sm:px-5">{r.owner}</td>
                    <td className="px-2 py-2.5">
                      <Link href={`/aktie/${r.ticker}`} className="hover:underline">{r.ticker}</Link>
                    </td>
                    <td className="px-2 py-2.5"><Chip tone={cat.tone}>{cat.label}</Chip></td>
                    <td className="num px-2 py-2.5 text-right">
                      {r.value !== null ? formatCompact(r.value, "USD") : r.shares !== null ? `${r.shares.toLocaleString("de-DE")} Stk.` : "–"}
                    </td>
                    <td className="num px-2 py-2.5">{r.transactionDate ? formatDate(r.transactionDate) : "–"}</td>
                    <td className="num px-2 py-2.5">{formatDate(r.filingDate)}</td>
                    <td className={`num px-2 py-2.5 text-right ${r.delayDays !== null && r.delayDays > 5 ? "font-semibold text-warn" : ""}`}>
                      {r.delayDays === null ? "–" : `${r.delayDays} Tage`}
                    </td>
                    <td className="px-4 py-2.5 sm:px-5">
                      <a href={r.documentUrl} className="underline decoration-dotted underline-offset-2">Form 4</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {[
        { title: "Politiker", text: "Congressional Financial Disclosures – gemeldet werden Wertspannen, oft mit Wochen Verzug." },
        { title: "Institutionen (13F)", text: "Bestände zum Quartalsende, veröffentlicht bis zu 45 Tage später." },
      ].map((group) => (
        <Card key={group.title}>
          <div className="px-4 py-4 sm:px-5">
            <h2 className="text-[15px] font-bold">{group.title}</h2>
            <p className="mt-1 text-[12px] text-muted">{group.text}</p>
            <p className="mt-2 rounded-[8px] border border-dashed border-line-strong px-3 py-2 text-[12px] text-faint">
              Keine echten Daten verfügbar – für {group.title.toLowerCase()} ist keine Quelle angebunden.
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}
