import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCryptoDetail } from "@/lib/services/crypto";
import { toUiMeta } from "@/lib/data/types";
import { Card, CardBody, Chip } from "@/components/ui/primitives";
import { DataStamp, Delta } from "@/components/common/data";
import { formatCompact, formatNumber } from "@/lib/finance/format";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const detail = await getCryptoDetail(id);
  return { title: detail.ok ? `${detail.data.detail.name} (${detail.data.detail.symbol}) – Der junge Kapitalist` : "Nicht gefunden" };
}

export default async function CryptoPage({ params }: Params) {
  const { id } = await params;
  const result = await getCryptoDetail(id);
  if (!result.ok) notFound();
  const { detail, tags, metrics, assessment, detailMeta } = result.data;

  return (
    <div className="space-y-5">
      <nav aria-label="Brotkrumen" className="text-[12px] text-faint">
        <Link href="/maerkte" className="hover:text-ink">Märkte</Link> <span aria-hidden>/</span> {detail.name}
      </nav>

      <Card>
        <CardBody className="pt-4 sm:pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-extrabold tracking-[-0.03em] sm:text-[28px]">{detail.name}</h1>
              <p className="num mt-1 text-[12px] text-faint">
                {detail.symbol}{detail.marketCapRank ? ` · Rang ${detail.marketCapRank} nach Marktkapitalisierung` : ""}
              </p>
            </div>
            {tags.length > 0 ? <Chip tone="neutral">{tags.join(", ")}</Chip> : null}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-1">
            <p className="num text-[34px] font-extrabold leading-none tracking-[-0.03em]">
              {detail.priceEur !== null ? `${formatNumber(detail.priceEur, detail.priceEur < 1 ? 4 : 2)} €` : "–"}
            </p>
            <Delta value={detail.change24h} size="lg" />
            <span className="text-[12px] text-muted">über 24 Stunden (rollierend)</span>
          </div>

          <DataStamp meta={toUiMeta(detailMeta)} className="mt-3" />
        </CardBody>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardBody><p className="text-[11px] text-muted">Marktkapitalisierung</p><p className="num mt-1 text-[16px] font-bold">{formatCompact(detail.marketCapEur, "EUR")}</p></CardBody></Card>
        <Card><CardBody><p className="text-[11px] text-muted">Vollständig verwässerte Bewertung</p><p className="num mt-1 text-[16px] font-bold">{formatCompact(detail.fdvEur, "EUR")}</p></CardBody></Card>
        <Card><CardBody><p className="text-[11px] text-muted">Volumen (24 Std.)</p><p className="num mt-1 text-[16px] font-bold">{formatCompact(detail.volume24hEur, "EUR")}</p></CardBody></Card>
      </div>

      <Card>
        <CardBody>
          <h2 className="text-[15px] font-bold">Einordnung</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{assessment.valuation}</p>
          {assessment.risks.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-muted">
              {assessment.risks.map((r) => <li key={r}>{r}</li>)}
            </ul>
          ) : null}
          {metrics.volatility365dPct !== null ? (
            <p className="mt-3 text-[12px] text-faint">
              Annualisierte Schwankung (1 Jahr): {formatNumber(metrics.volatility365dPct, 0)} %. Größter Rückgang: {formatNumber(metrics.maxDrawdown365dPct, 0)} %.
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
