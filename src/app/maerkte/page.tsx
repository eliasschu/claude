import type { Metadata } from "next";
import Link from "next/link";
import { getCryptoRanking, FILTERS, type FilterKey } from "@/lib/services/crypto";
import { getTopMovers } from "@/lib/services/movers";
import { Card, Chip } from "@/components/ui/primitives";
import { Delta } from "@/components/common/data";
import { formatCompact, formatNumber } from "@/lib/finance/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Märkte – Der junge Kapitalist" };

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function MarketsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const page = Number(sp.page) || 1;
  const filter = (typeof sp.filter === "string" && sp.filter in FILTERS ? sp.filter : "alle") as FilterKey;

  const [ranking, movers] = await Promise.all([
    getCryptoRanking({ page, q: "", filter, sort: "marketCap", dir: "desc" }),
    getTopMovers(20),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Märkte</h1>
        <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-muted">
          Krypto vollständig nach Marktkapitalisierung (CoinGecko, kostenlos, ~500 Werte). Für eine echte Top-500-Liste
          bei Aktien braucht es einen kostenpflichtigen Massendaten-Anbieter (siehe{" "}
          <Link href="/datenquellen" className="underline">Datenquellen</Link>) – bis dahin zeigt die Aktienseite unten
          eine kuratierte Beobachtungsliste.
        </p>
      </div>

      <section aria-labelledby="aktien-bewegungen">
        <h2 id="aktien-bewegungen" className="mb-2 text-[13px] font-bold uppercase tracking-wide text-faint">
          Aktien – kuratierte Beobachtungsliste
        </h2>
        <Card>
          <ul className="divide-y divide-line">
            {movers.rows.filter((r) => r.kind === "aktie").map((r) => (
              <li key={r.href}>
                <Link href={r.href} className="flex items-center gap-3 px-3 py-2.5 hover:opacity-80 sm:px-4">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{r.name}</span>
                    <span className="num block text-[11px] text-faint">{r.symbol}{r.volume !== null ? ` · Vol. ${formatCompact(r.volume)}` : ""}</span>
                  </span>
                  <span className="num text-[13px] font-bold">{formatNumber(r.price)} {r.currency}</span>
                  <Delta value={r.changePct} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section aria-labelledby="krypto-rangliste">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="krypto-rangliste" className="text-[13px] font-bold uppercase tracking-wide text-faint">
            Krypto – Top nach Marktkapitalisierung
          </h2>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
              <Link
                key={key}
                href={`/maerkte?filter=${key}`}
                className={cn(
                  "rounded-[8px] border px-2.5 py-1 text-[11px] font-semibold",
                  filter === key ? "border-accent bg-accent-soft text-accent" : "border-line text-muted",
                )}
              >
                {FILTERS[key].label}
              </Link>
            ))}
          </div>
        </div>

        {!ranking.ok ? (
          <p className="rounded-[10px] border border-dashed border-line-strong px-4 py-6 text-[13px] text-muted">
            Krypto-Rangliste derzeit nicht verfügbar: {ranking.message}
          </p>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-[11px] text-faint">
                    <th className="px-3 py-2 font-semibold sm:px-4">#</th>
                    <th className="px-2 py-2 font-semibold">Name</th>
                    <th className="px-2 py-2 text-right font-semibold">Preis</th>
                    <th className="px-2 py-2 text-right font-semibold">24 Std.</th>
                    <th className="px-2 py-2 text-right font-semibold">Marktkap.</th>
                    <th className="px-2 py-2 text-right font-semibold sm:table-cell">Volumen (24 Std.)</th>
                    <th className="px-2 py-2 font-semibold">Einordnung</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ranking.data.page.items.map(({ item, sizeRank }) => (
                    <tr key={item.row.id}>
                      <td className="num px-3 py-2 text-faint sm:px-4">{sizeRank}</td>
                      <td className="px-2 py-2">
                        <Link href={`/krypto/${item.row.id}`} className="font-semibold hover:underline">
                          {item.row.name} <span className="num text-faint">{item.row.symbol}</span>
                        </Link>
                      </td>
                      <td className="num px-2 py-2 text-right">{formatNumber(item.row.price)} €</td>
                      <td className="px-2 py-2 text-right"><Delta value={item.row.change24h} size="sm" /></td>
                      <td className="num px-2 py-2 text-right">{formatCompact(item.row.marketCap, "EUR")}</td>
                      <td className="num px-2 py-2 text-right">{formatCompact(item.row.volume24h, "EUR")}</td>
                      <td className="px-2 py-2"><Chip tone={item.profile.tone}>{item.profile.label}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-3 py-2.5 text-[12px] sm:px-4">
              <span className="text-faint">
                {ranking.data.page.from}–{ranking.data.page.to} von {ranking.data.page.total}
              </span>
              <div className="flex gap-2">
                {page > 1 ? <Link href={`/maerkte?filter=${filter}&page=${page - 1}`} className="underline">Zurück</Link> : null}
                {page < ranking.data.page.pages ? <Link href={`/maerkte?filter=${filter}&page=${page + 1}`} className="underline">Weiter</Link> : null}
              </div>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
