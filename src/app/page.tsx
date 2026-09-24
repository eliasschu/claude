import { Suspense } from "react";
import { MarketRail } from "@/components/market/market-rail";
import { TodayPanel } from "@/components/home/today-panel";
import { CryptoTeaser } from "@/components/home/crypto-teaser";
import { NewsSection } from "@/components/news/news-section";
import { MarketRailSkeleton, PanelSkeleton, ListSkeleton } from "@/components/home/skeletons";

/**
 * Jeder Abschnitt ist eine eigene Suspense-Grenze: eine langsame oder
 * ausgefallene Datenquelle blockiert nie die ganze Seite. Kopf- und
 * Fußzeile (im Layout) sowie diese Hülle erscheinen sofort; jeder Block
 * lädt für sich mit eigenem Platzhalter nach.
 */
export default function HomePage() {
  return (
    <div className="space-y-9">
      <Suspense fallback={<MarketRailSkeleton />}>
        <MarketRail />
      </Suspense>

      <Suspense fallback={<PanelSkeleton />}>
        <TodayPanel />
      </Suspense>

      <Suspense fallback={<ListSkeleton />}>
        <CryptoTeaser />
      </Suspense>

      <Suspense fallback={<ListSkeleton />}>
        <NewsSection />
      </Suspense>
    </div>
  );
}
