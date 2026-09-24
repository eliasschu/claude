import { getMarketOverview } from "@/lib/services/markets";
import { Sparkline } from "@/components/common/data";
import { formatNumber, formatPercent, formatTime } from "@/lib/finance/format";
import { cn } from "@/lib/utils";

/**
 * Marktleiste - nur Kacheln mit echtem Wert, eine kompakte Zeile. Werte ohne
 * angebundene Quelle werden nicht angezeigt (siehe /datenquellen für die
 * vollständige Liste inklusive der fehlenden).
 */
export async function MarketRail() {
  const cards = (await getMarketOverview()).filter((c) => c.status === "ok");
  const now = new Date().toISOString();

  if (cards.length === 0) {
    return (
      <section aria-labelledby="marktleiste">
        <h2 id="marktleiste" className="text-[12px] font-bold uppercase tracking-wide text-faint">Märkte</h2>
        <p className="mt-2 text-[13px] text-muted">Derzeit keine Marktdaten verfügbar.</p>
      </section>
    );
  }

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

          return (
            <li
              key={card.def.slug}
              className="w-[150px] shrink-0 snap-start rounded-[12px] border border-line bg-surface px-3 py-2"
              title={card.def.definition}
            >
              <span className="block truncate text-[11px] font-bold text-muted" title={card.def.fullName}>
                {card.def.name}
              </span>
              <p className="num mt-0.5 text-[16px] font-extrabold leading-none tracking-[-0.02em]">
                {formatNumber(card.value, card.value !== null && Math.abs(card.value) < 10 ? 4 : 2)}
                {card.def.unit === "USD" ? <span className="ml-0.5 text-[11px] font-semibold text-faint">$</span> : null}
              </p>
              <div className="mt-1 flex items-end justify-between gap-2">
                <span className={cn("num text-[11px] font-semibold", dir > 0 ? "text-pos" : dir < 0 ? "text-neg" : "text-muted")}>
                  {card.def.kind === "rendite" ? `${(card.changeBp ?? 0) > 0 ? "+" : ""}${card.changeBp ?? "–"} Bp.` : formatPercent(card.changePct)}
                </span>
                <Sparkline values={card.spark} direction={dir} width={48} height={18} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
