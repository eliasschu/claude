import Link from "next/link";
import { getInsiderActivity } from "@/lib/services/insider";
import { FEED_RULES, fromArchive, selectBotMessages, type BotMessage } from "@/lib/services/bot-feed";
import { bot } from "@/lib/bot/client";
import { botConnection, type Connection } from "@/lib/bot/connection";
import { formatDateTime } from "@/lib/finance/format";
import { cn } from "@/lib/utils";
import { STOCK_MOVER_UNIVERSE } from "@/config/movers";
import { BotMessageCard } from "@/components/bot/bot-message-card";
import { Skeleton } from "@/components/ui/primitives";

interface FeedData {
  messages: BotMessage[];
  origin: "archiv" | "live";
  connection: Connection;
  issues: string[];
  /** Nur Live-Auswertung: Zeitpunkt des SEC-Abrufs dieser Website. */
  liveFetchedAt: string | null;
}

/**
 * Quelle der Meldungen: das unveraenderliche Archiv des Bots, wenn er
 * erreichbar ist (auch wenn sein Stand veraltet ist - dann mit Warnung).
 * Sonst wendet die Website dieselben Regeln live an. Diese Live-Auswertung
 * erscheint NIE als Bot-Erkennung: eigene Ueberschrift, eigenes Etikett,
 * kein Erkennungszeitpunkt.
 */
async function loadFeed(): Promise<FeedData> {
  const [status, archived] = await Promise.all([bot.archiveStatus(), bot.messages({ limit: 200 })]);
  let connection = botConnection(status);
  if (connection.archiveAvailable && archived.ok) {
    return { messages: fromArchive(archived.value.data, new Date(), FEED_RULES.limit + 1), origin: "archiv", connection, issues: [], liveFetchedAt: null };
  }
  if (connection.archiveAvailable && !archived.ok) connection = botConnection(archived);
  // Gleiche Parameter wie "Deals der Woche" - der Abruf wird geteilt.
  const activity = await getInsiderActivity(STOCK_MOVER_UNIVERSE, 30, 15);
  return {
    messages: selectBotMessages(activity, FEED_RULES.limit + 1),
    origin: "live",
    connection,
    issues: [...new Set(activity.issues.map((i) => i.message))],
    liveFetchedAt: activity.fetchedAt,
  };
}

const TONE: Record<Connection["tone"], string> = {
  pos: "border-pos/30 bg-pos-soft",
  warn: "border-warn/40 bg-warn-soft",
  neg: "border-neg/30 bg-neg-soft",
  neutral: "border-line-strong bg-surface-2",
};
const DOT: Record<Connection["tone"], string> = { pos: "bg-pos", warn: "bg-warn", neg: "bg-neg", neutral: "bg-line-strong" };

/** Zustand der Bot-Verbindung mit letztem erfolgreichem Abruf - immer sichtbar ueber den Meldungen. */
function ConnectionBanner({ connection: c, liveFetchedAt }: { connection: Connection; liveFetchedAt: string | null }) {
  return (
    <div role="status" className={cn("rounded-[12px] border px-3.5 py-3", TONE[c.tone])}>
      <p className="flex items-center gap-2 text-[13px] font-bold">
        <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[c.tone])} />
        {c.headline}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{c.detail}</p>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
        {c.archiveAvailable ? (
          <>
            <div className="flex gap-1"><dt className="text-faint">Letzter erfolgreicher Abruf des Bots:</dt><dd className="num font-semibold">{c.lastSuccessAt ? formatDateTime(c.lastSuccessAt) : "noch keiner"}</dd></div>
            {c.lastAttemptAt && c.lastAttemptAt !== c.lastSuccessAt ? (
              <div className="flex gap-1"><dt className="text-faint">Letzter Versuch:</dt><dd className="num font-semibold">{formatDateTime(c.lastAttemptAt)}</dd></div>
            ) : null}
          </>
        ) : (
          <div className="flex gap-1"><dt className="text-faint">Live-Abruf dieser Website:</dt><dd className="num font-semibold">{liveFetchedAt ? formatDateTime(liveFetchedAt) : "fehlgeschlagen"}</dd></div>
        )}
      </dl>
    </div>
  );
}

/**
 * Beispielmeldung und aktuelle Ereignisse - echte Daten, keine Demo. Gibt es
 * weniger passende Ereignisse, erscheinen weniger Karten.
 */
export async function BotFeed() {
  const { messages, origin, connection, issues, liveFetchedAt } = await loadFeed();
  const [example, ...rest] = messages;
  const archive = origin === "archiv";

  return (
    <>
      <ConnectionBanner connection={connection} liveFetchedAt={liveFetchedAt} />

      <section aria-labelledby="beispiel-titel">
        <h2 id="beispiel-titel" className="mb-2 text-[12px] font-bold uppercase tracking-wide text-faint">
          {archive ? "Beispielmeldung · echte Erkennung des Bots" : "Beispiel · Live-Auswertung der Website, keine Bot-Erkennung"}
        </h2>
        <p className="mb-2 text-[11px] text-faint">
          {archive
            ? "Aus dem Meldungsarchiv des Bots: Jede Meldung wird beim ersten Erkennen gespeichert und danach nicht mehr verändert."
            : "Dieselben Regeln, aber jetzt live auf SEC-Daten angewandt. Nichts davon ist im Archiv gespeichert, und es gibt keinen Erkennungszeitpunkt."}
        </p>
        {example ? (
          <BotMessageCard message={example} variant="full" id="beispiel" />
        ) : (
          <div id="beispiel" className="scroll-mt-32 rounded-[14px] border border-dashed border-line-strong px-4 py-5">
            <p className="text-[14px] font-semibold">Derzeit keine Meldung, die die Auswahlregeln erfüllt</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Hier erscheinen nur echte Ereignisse der letzten {FEED_RULES.maxAgeDays} Tage, keine Beispiel- oder
              Demodaten.{" "}
              <Link href="/bot#auswahl" className="underline">Auswahlregeln</Link>
            </p>
            {issues.length > 0 ? (
              <p className="mt-2 text-[12px] text-faint">Datenquelle eingeschränkt: {issues.slice(0, 2).join(" · ")}</p>
            ) : null}
          </div>
        )}
      </section>

      {rest.length > 0 ? (
        <section aria-labelledby="ereignisse-titel">
          <div className="mb-2 flex items-baseline gap-2">
            <h2 id="ereignisse-titel" className="text-[12px] font-bold uppercase tracking-wide text-faint">
              {archive ? "Weitere Erkennungen des Bots" : "Weitere Ereignisse · Live-Auswertung"}
            </h2>
            <Link href="/bot#auswahl" className="ml-auto text-[12px] font-semibold text-accent hover:underline">
              Wie ausgewählt wird
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {rest.slice(0, FEED_RULES.limit).map((m) => <BotMessageCard key={m.id} message={m} />)}
          </div>
        </section>
      ) : null}
    </>
  );
}

export function BotFeedSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-60" />
    </div>
  );
}
