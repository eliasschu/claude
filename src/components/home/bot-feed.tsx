import Link from "next/link";
import { getInsiderActivity } from "@/lib/services/insider";
import { FEED_RULES, selectBotMessages } from "@/lib/services/bot-feed";
import { STOCK_MOVER_UNIVERSE } from "@/config/movers";
import { BotMessageCard } from "@/components/bot/bot-message-card";
import { Skeleton } from "@/components/ui/primitives";

/**
 * Beispielmeldung und aktuelle Ereignisse. Beides sind echte, aktuelle
 * Erkennungen aus demselben Datenabruf, keine Demo. Gibt es weniger
 * passende Ereignisse, erscheinen weniger Karten.
 */
export async function BotFeed() {
  // Gleiche Parameter wie "Deals der Woche" - der Abruf wird geteilt.
  const activity = await getInsiderActivity(STOCK_MOVER_UNIVERSE, 30, 15);
  const messages = selectBotMessages(activity, FEED_RULES.limit + 1);
  const [example, ...rest] = messages;

  return (
    <>
      <section aria-labelledby="beispiel-titel">
        <h2 id="beispiel-titel" className="mb-2 text-[12px] font-bold uppercase tracking-wide text-faint">
          Beispielmeldung · echte aktuelle Erkennung
        </h2>
        {example ? (
          <BotMessageCard message={example} variant="full" id="beispiel" />
        ) : (
          <div id="beispiel" className="scroll-mt-32 rounded-[14px] border border-dashed border-line-strong px-4 py-5">
            <p className="text-[14px] font-semibold">Derzeit keine Meldung, die die Auswahlregeln erfüllt</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Der Bot zeigt hier nur echte Erkennungen der letzten {FEED_RULES.maxAgeDays} Tage, keine Beispiel- oder
              Demodaten.{" "}
              <Link href="/bot#auswahl" className="underline">Auswahlregeln</Link>
            </p>
            {activity.issues.length > 0 ? (
              <p className="mt-2 text-[12px] text-faint">
                Datenquelle eingeschränkt: {[...new Set(activity.issues.map((i) => i.message))].slice(0, 2).join(" · ")}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {rest.length > 0 ? (
        <section aria-labelledby="ereignisse-titel">
          <div className="mb-2 flex items-baseline gap-2">
            <h2 id="ereignisse-titel" className="text-[12px] font-bold uppercase tracking-wide text-faint">
              Weitere aktuelle Ereignisse
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
