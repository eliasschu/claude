import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { bot } from "@/lib/bot/client";
import { MESSAGE_KIND_LABEL } from "@/lib/services/bot-feed";
import { lateDetection, messageStatus } from "@/lib/bot/message-view";
import { getTickerIndex } from "@/lib/sources/sec";
import { ArchiveUnavailable } from "@/components/bot/archive-unavailable";
import { LinkedMessages, Observations, Section, Timeline } from "@/components/bot/message-parts";
import { EventReturnsSection } from "@/components/bot/event-returns-section";
import { Card, CardBody, Chip, Skeleton } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meldung – Der junge Kapitalist" };

type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MessagePage({ params }: Params) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const res = await bot.message(id);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return (
      <div className="space-y-4">
        <Link href="/meldungen" className="text-[12px] text-faint hover:text-ink">← Meldungsarchiv</Link>
        <ArchiveUnavailable reason={res.reason} message={res.message} />
      </div>
    );
  }
  const { message: m, links, hash_verified } = res.value.data;
  const status = messageStatus(m, links);
  const late = lateDetection(m);
  const index = m.ticker ? await getTickerIndex() : null;
  const exchange = index?.ok && m.ticker ? index.data.byTicker.get(m.ticker)?.exchange ?? null : null;

  return (
    <div className="mx-auto max-w-[900px] space-y-7">
      <nav aria-label="Brotkrumen" className="text-[12px] text-faint">
        <Link href="/meldungen" className="hover:text-ink">Meldungsarchiv</Link> <span aria-hidden>/</span> {m.ticker ?? m.issuer_cik}
      </nav>

      <header>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone={m.kind === "insider_sale" ? "neg" : m.kind === "insider_cluster" ? "accent" : "pos"}>{MESSAGE_KIND_LABEL[m.kind]}</Chip>
          {m.materiality ? <Chip tone={m.materiality === "hoch" ? "pos" : "warn"}>Aussagekraft {m.materiality}</Chip> : <Chip tone="neutral">Aussagekraft: siehe Auswahlregel</Chip>}
          <Chip tone={status.tone}>{status.label}</Chip>
        </div>
        <p className="mt-3 text-[13px] text-muted">
          {m.ticker ? <Link href={`/aktie/${m.ticker}`} className="num font-bold text-ink hover:underline">{m.ticker}</Link> : null}
          {m.issuer_name ? ` · ${m.issuer_name}` : ""}{exchange ? ` · ${exchange}` : ""}
        </p>
        <h1 className="mt-1 text-[22px] font-extrabold leading-snug tracking-[-0.02em] sm:text-[28px]">{m.title}</h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed">{m.relevance}</p>
        {m.ticker ? (
          <Link href={`/aktie/${m.ticker}#these`} className="mt-3 inline-flex h-9 items-center rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-semibold hover:bg-surface-2">
            These zu {m.ticker} festhalten oder prüfen
          </Link>
        ) : null}
        {late ? <p className="mt-3 rounded-[10px] border border-warn/40 bg-warn-soft px-3 py-2 text-[12px] leading-relaxed">{late}</p> : null}
      </header>

      <Section id="zeiten" title="Vier Zeitpunkte" hint="Handel, Veröffentlichung, Eingang beim Bot und Erkennung werden getrennt gespeichert und nie vermischt.">
        <Timeline message={m} />
      </Section>

      <Section id="beobachtungen" title="Beobachtungen aus den Meldungen" hint="So, wie sie der SEC gemeldet wurden. Nichts davon ist geschätzt.">
        <Observations items={m.observations ?? []} />
      </Section>

      <Section id="einordnung" title="Einordnung">
        <Card>
          <CardBody className="space-y-3 pt-4 text-[13px] leading-relaxed sm:pt-5">
            <div>
              <p className="font-semibold">Warum ausgewählt</p>
              <p className="text-muted">{m.selection} Regelversion <span className="num">{m.rule_version ?? "unbekannt"}</span>. <Link href="/bot#auswahl" className="underline">Alle Auswahlregeln</Link></p>
            </div>
            <div>
              <p className="font-semibold">Unsicherheit</p>
              <p className="text-muted">{m.uncertainty}</p>
            </div>
            {m.counter_arguments.length ? (
              <div>
                <p className="font-semibold">Gegenargumente</p>
                <ul className="list-disc space-y-1 pl-5 text-muted">{m.counter_arguments.map((c) => <li key={c}>{c}</li>)}</ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </Section>

      <Section id="verlauf" title="Verknüpfte Meldungen" hint="Frühere Meldungen werden nie verändert. Berichtigungen und Erweiterungen kommen als neue, verknüpfte Meldungen hinzu.">
        <LinkedMessages links={links} />
      </Section>

      <Section id="kurs" title="Späterer Kursverlauf">
        <Suspense fallback={<Skeleton className="h-40" />}>
          <EventReturnsSection ticker={m.ticker} publishedAt={m.published_at} detectedAt={m.detected_at} />
        </Suspense>
      </Section>

      <Section id="quellen" title="Quellen und Prüfsumme">
        <Card>
          <CardBody className="space-y-3 pt-4 text-[13px] sm:pt-5">
            <ul className="space-y-1">
              {m.sources.map((s) => (
                <li key={s.url}><a href={s.url} className="underline decoration-dotted underline-offset-2">{s.label} ↗</a></li>
              ))}
            </ul>
            <details className="text-[12px] text-muted">
              <summary className="cursor-pointer">
                Prüfsumme:{" "}
                {hash_verified === true ? <span className="font-semibold text-pos">nachgerechnet, stimmt</span>
                  : hash_verified === false ? <span className="font-semibold text-neg">stimmt NICHT mit den gespeicherten Angaben überein</span>
                  : <span>für diese Regelversion nicht nachrechenbar</span>}
              </summary>
              <p className="num mt-2 break-all">{m.content_hash}</p>
              <p className="mt-1">SHA-256 über die Kernangaben dieser Meldung und ihre Regelversion. Der Bot rechnet sie bei jedem Aufruf aus den gespeicherten Angaben nach. Meldungs-ID <span className="num">{m.message_id}</span>.</p>
            </details>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
