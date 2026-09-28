import Link from "next/link";
import { MESSAGE_KIND_LABEL, type BotMessage } from "@/lib/services/bot-feed";
import { Card, Chip } from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/finance/format";
import { cn } from "@/lib/utils";

const KIND_TONE: Record<BotMessage["kind"], "pos" | "neg" | "accent"> = {
  insider_cluster: "accent",
  insider_buy: "pos",
  insider_sale: "neg",
};

function traded(m: BotMessage): string {
  if (!m.tradedFrom) return "nicht angegeben";
  if (!m.tradedTo || m.tradedTo === m.tradedFrom) return formatDate(m.tradedFrom);
  return `${formatDate(m.tradedFrom)} – ${formatDate(m.tradedTo)}`;
}

/**
 * Eine Bot-Meldung. Jede Karte beantwortet vier Fragen: Was ist passiert,
 * warum ist es relevant, wann wurde es erkannt und welche Unsicherheit
 * besteht. Handels-, Veroeffentlichungs- und Erkennungszeitpunkt stehen
 * getrennt.
 */
export function BotMessageCard({ message: m, variant = "compact", headingLevel = 3, id }: {
  message: BotMessage; variant?: "full" | "compact"; headingLevel?: 2 | 3; id?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const full = variant === "full";
  return (
    <Card as="article" className={full ? "p-4 sm:p-6" : "p-4"}>
      <div id={id} className="flex scroll-mt-32 flex-wrap items-center gap-1.5">
        <Chip tone={KIND_TONE[m.kind]}>{MESSAGE_KIND_LABEL[m.kind]}</Chip>
        <Link href={`/aktie/${m.ticker}`} className="num text-[12px] font-bold hover:underline">{m.ticker}</Link>
        <span className="truncate text-[12px] text-faint">{m.issuerName}</span>
        {m.origin === "live" ? (
          <Chip tone="neutral" className="ml-auto" title="Von der Website live berechnet, nicht im Archiv des Bots gespeichert">Live-Auswertung · nicht archiviert</Chip>
        ) : null}
      </div>

      <Heading className={cn("mt-2.5 font-bold leading-snug tracking-[-0.01em]", full ? "text-[19px] sm:text-[22px]" : "text-[15px]")}>
        {m.title}
      </Heading>

      <dl className={cn("mt-3 grid gap-3", full ? "sm:grid-cols-2" : "")}>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-faint">Warum relevant</dt>
          <dd className="mt-0.5 text-[13px] leading-relaxed text-ink">{m.relevance}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-faint">Unsicherheit</dt>
          <dd className="mt-0.5 text-[13px] leading-relaxed text-muted">{m.uncertainty}</dd>
        </div>
      </dl>

      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[11px]">
        <div>
          <dt className="text-faint">Gehandelt</dt>
          <dd className="num mt-0.5 font-semibold">{traded(m)}</dd>
        </div>
        <div>
          <dt className="text-faint">Veröffentlicht (SEC)</dt>
          <dd className="num mt-0.5 font-semibold">{formatDate(m.publishedAt)}</dd>
        </div>
        <div>
          <dt className="text-faint" title={m.origin === "archiv" ? "Erster Erkennungszeitpunkt, im Archiv unveränderlich gespeichert" : "Zeitpunkt des Datenabrufs, bei dem die Meldung vorlag"}>
            {m.origin === "archiv" ? "Vom Bot erkannt" : "Von der Website abgerufen"}
          </dt>
          <dd className="num mt-0.5 font-semibold">{m.detectedAt ? formatDateTime(m.detectedAt) : "nicht belegt"}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span>Auswahl: {m.selection}</span>
        {m.sources.slice(0, full ? 6 : 2).map((s) => (
          <a key={s.url} href={s.url} className="underline decoration-dotted underline-offset-2 hover:text-ink">{s.label} ↗</a>
        ))}
        {!full && m.sources.length > 2 ? <span>+{m.sources.length - 2} weitere Quellen</span> : null}
      </div>
    </Card>
  );
}
