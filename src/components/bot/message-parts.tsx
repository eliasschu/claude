import Link from "next/link";
import type { ArchivedMessage, MessageLink, Observation } from "@/lib/services/bot-feed";
import { MESSAGE_KIND_LABEL } from "@/lib/services/bot-feed";
import { linkText, timeline } from "@/lib/bot/message-view";
import { Card, CardBody, Chip } from "@/components/ui/primitives";
import { formatCompact, formatDate, formatDateTime, formatNumber } from "@/lib/finance/format";

export function Section({ id, title, children, hint }: { id: string; title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-32">
      <h2 id={id} className="mb-2 text-[15px] font-bold tracking-[-0.01em]">{title}</h2>
      {hint ? <p className="-mt-1 mb-2 text-[12px] leading-relaxed text-faint">{hint}</p> : null}
      {children}
    </section>
  );
}

/** Vier Zeitpunkte als senkrechte Zeitleiste - auf dem Smartphone gut lesbar. */
export function Timeline({ message }: { message: ArchivedMessage }) {
  return (
    <Card>
      <CardBody className="pt-4 sm:pt-5">
        <ol className="relative space-y-4 border-l border-line pl-5">
          {timeline(message).map((s) => (
            <li key={s.key} className="relative">
              <span aria-hidden className={`absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ${s.at ? "bg-accent" : "bg-line-strong"}`} />
              <p className="text-[12px] font-semibold text-muted">{s.label}</p>
              <p className="num text-[14px] font-bold">
                {s.at ? (s.precision === "day" ? formatDate(s.at) : formatDateTime(s.at)) : "nicht erfasst"}
                {s.note && s.at ? <span className="ml-1 text-[12px] font-normal text-muted">{s.note}</span> : null}
              </p>
              {s.sincePrevious ? <p className="text-[11px] text-faint">{s.sincePrevious}</p> : null}
              {s.note && !s.at ? <p className="text-[11px] text-faint">{s.note}</p> : null}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="num text-[13px] font-semibold">{value}</dd>
    </div>
  );
}

/** Einzeltransaktionen als Karten statt breiter Tabelle; Details aufklappbar. */
export function Observations({ items }: { items: Observation[] }) {
  if (items.length === 0) return <p className="text-[13px] text-muted">Keine Einzelangaben gespeichert.</p>;
  return (
    <ul className="grid gap-2.5 md:grid-cols-2">
      {items.map((o) => {
        const price = o.value_usd !== null && o.shares ? o.value_usd / o.shares : null;
        return (
          <li key={`${o.accession}-${o.owner}`}>
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone={o.direction === "buy" ? "pos" : "neg"}>{o.direction === "buy" ? "▲ Kauf" : "▼ Verkauf"}</Chip>
                {o.amendment ? <Chip tone="warn">Berichtigung (4/A)</Chip> : null}
                <Chip tone="neutral">{o.plan_10b5_1 ? "mit Handelsplan 10b5-1" : "ohne erkennbaren Handelsplan"}</Chip>
              </div>
              <p className="mt-2 text-[14px] font-bold">{o.owner} <span className="font-normal text-muted">· {o.role}</span></p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                <Fact label="Handelstag(e)" value={o.trade_dates.length ? o.trade_dates.map((d) => formatDate(d)).join(", ") : "–"} />
                <Fact label="Betrag" value={formatCompact(o.value_usd, "USD")} />
                <Fact label="Stückzahl" value={o.shares === null ? "–" : formatNumber(o.shares, 0)} />
                <Fact label="Ø Kurs" value={price === null ? "–" : `${formatNumber(price)} USD`} />
                <Fact label="Bestand danach" value={o.shares_after === null ? "–" : formatNumber(o.shares_after, 0)} />
                <Fact label="Anteil am Bestand" value={o.share_of_holding === null ? "–" : `${(o.share_of_holding * 100).toFixed(0)} %`} />
              </dl>
              <details className="mt-2 text-[12px] text-muted">
                <summary className="cursor-pointer text-faint">Weitere Angaben</summary>
                <dl className="mt-2 grid grid-cols-1 gap-1.5">
                  <Fact label="Diskretionär (keine Programm-/Plantransaktion)" value={o.discretionary ? "ja" : "nein"} />
                  <Fact label="Sicherheit der Einordnung" value={`${Math.round(o.classification_confidence * 100)} %`} />
                  <Fact label="Veröffentlicht" value={o.published_at ? formatDateTime(o.published_at) : "–"} />
                  <Fact label="Einreichungsnummer" value={o.accession} />
                </dl>
                {o.source_url ? <a href={o.source_url} className="mt-2 inline-block underline decoration-dotted underline-offset-2">Rohdaten (XML) ↗</a> : null}
              </details>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export function LinkedMessages({ links }: { links: MessageLink[] }) {
  if (links.length === 0) {
    return <p className="text-[13px] text-muted">Keine verknüpften Meldungen. Spätere Berichtigungen oder Erweiterungen würden hier als eigene, neue Meldungen erscheinen.</p>;
  }
  return (
    <ul className="space-y-2">
      {links.map((l) => (
        <li key={`${l.direction}-${l.relation}-${l.message_id}`}>
          <Link href={`/meldungen/${l.message_id}`} className="block rounded-[12px] border border-line bg-surface px-3.5 py-3 hover:bg-surface-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{linkText(l)}</p>
            <p className="mt-0.5 text-[13px] font-semibold">{l.title}</p>
            <p className="num mt-0.5 text-[11px] text-faint">{MESSAGE_KIND_LABEL[l.kind]} · erkannt {formatDateTime(l.detected_at)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
