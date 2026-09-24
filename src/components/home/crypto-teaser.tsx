import Link from "next/link";
import { getCryptoSnapshot } from "@/lib/services/crypto";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { Delta } from "@/components/common/data";
import { formatCompact, formatNumber } from "@/lib/finance/format";

/** Zeigt die größten Kryptowerte nach Marktkapitalisierung – echte CoinGecko-Top-500-Liste, hier nur der Anfang. */
export async function CryptoTeaser() {
  const snap = await getCryptoSnapshot();
  if (!snap.ok) return null;
  const rows = snap.data.rows.filter((r) => !(snap.data.tags.get(r.id) ?? []).includes("stablecoin")).slice(0, 6);

  return (
    <section aria-labelledby="krypto-teaser">
      <SectionTitle
        id="krypto-teaser"
        right={<Link href="/maerkte" className="text-[13px] font-semibold text-accent hover:underline">Alle ~500 ansehen</Link>}
      >
        Krypto
      </SectionTitle>
      <Card>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/krypto/${r.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:opacity-80 sm:px-4">
                <span className="num w-7 shrink-0 text-[11px] text-faint">#{r.marketCapRank ?? "–"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{r.name}</span>
                  <span className="num block text-[11px] text-faint">{r.symbol} · Marktkap. {formatCompact(r.marketCap, "EUR")}</span>
                </span>
                <span className="num text-[13px] font-bold">{formatNumber(r.price, r.price !== null && r.price < 1 ? 4 : 2)} €</span>
                <Delta value={r.change24h} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
