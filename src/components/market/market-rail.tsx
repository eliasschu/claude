import { getMarketOverview } from "@/lib/services/markets";
import { Sparkline } from "@/components/common/data";
import { formatNumber, formatPercent, formatTime } from "@/lib/finance/format";
import { cn } from "@/lib/utils";

/** Marktleiste mit den in `config/markets.ts` definierten Instrumenten. Werte ohne
 * angebundene Quelle werden nicht versteckt, sondern ehrlich als "keine Quelle" markiert. */
export async function MarketRail() {
  const cards = await getMarketOverview();
  const now = new Date().toISOString();

  return (
    <section aria-labelledby="marktleiste" className="relative">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="marktleiste" className="text-[12px] font-bold uppercase tracking-wide text-faint">
          Märkte
        </h2>
        <span className="ml-auto text-[11px] text-faint">Aktualisiert {formatTime(now)} Uhr</span>
      </div>

      <ul className="rail -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {cards.map((card) => {
          const dir = (card.changePct ?? 0) > 0 ? 1 : (card.changePct ?? 0) < 0 ? -1 : 0;
          const unavailable = card.status === "unavailable";

          return (
            <li
              key={card.def.slug}
              className={cn(
                "w-[164px] shrink-0 snap-start rounded-[12px] border px-3 py-2.5",
                unavailable ? "border-dashed border-line-strong bg-surface-2" : "border-line bg-surface",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", unavailable ? "bg-line-strong" : "bg-pos")}
                  aria-hidden
                />
                <span className="truncate text-[12px] font-bold" title={card.def.fullName}>
                  {card.def.name}
                </span>
              </div>

              {unavailable ? (
                <>
                  <p className="mt-1 text-[13px] font-semibold text-faint">Keine Quelle</p>
                  <p className="mt-1 text-[10px] leading-snug text-faint" title={card.failure?.message}>
                    {card.def.missingNote ?? "Nicht angebunden."}
                  </p>
                </>
              ) : (
                <>
                  <p className="num mt-1 text-[17px] font-extrabold leading-none tracking-[-0.02em]">
                    {formatNumber(card.value, card.value !== null && Math.abs(card.value) < 10 ? 4 : 2)}
                  </p>
                  <div className="mt-1.5 flex items-end justify-between gap-2">
                    <span className={cn("num text-[12px] font-semibold", dir > 0 ? "text-pos" : dir < 0 ? "text-neg" : "text-muted")}>
                      {card.def.kind === "rendite" ? `${(card.changeBp ?? 0) > 0 ? "+" : ""}${card.changeBp ?? "–"} Bp.` : formatPercent(card.changePct)}
                    </span>
                    <Sparkline values={card.spark} direction={dir} width={56} height={20} />
                  </div>
                  <p className="mt-1 text-[10px] text-faint">{card.tradingNote}</p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
