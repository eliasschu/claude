import { Suspense } from "react";
import { MarketRail } from "@/components/market/market-rail";
import { DealOfWeekSection } from "@/components/home/deal-of-week";
import { DealsOfWeek } from "@/components/home/deals-of-week";
import { Termine } from "@/components/home/termine";
import { GrosseFischeTeaser } from "@/components/home/grosse-fische-teaser";
import { MarketRailSkeleton, PanelSkeleton, ListSkeleton } from "@/components/home/skeletons";

/**
 * Jeder Abschnitt ist eine eigene Suspense-Grenze: eine langsame oder
 * ausgefallene Datenquelle blockiert nie die ganze Seite.
 */
export default function HomePage() {
  return (
    <div className="space-y-9">
      <Suspense fallback={<MarketRailSkeleton />}>
        <MarketRail />
      </Suspense>

      <Suspense fallback={<PanelSkeleton />}>
        <DealOfWeekSection />
      </Suspense>

      <Suspense fallback={<ListSkeleton />}>
        <DealsOfWeek />
      </Suspense>

      <div className="grid gap-3 sm:grid-cols-2">
        <GrosseFischeTeaser />
        <Termine />
      </div>
    </div>
  );
}
