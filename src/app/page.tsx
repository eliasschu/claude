import { Suspense } from "react";
import { MarketRail } from "@/components/market/market-rail";
import { DealsOfWeek } from "@/components/home/deals-of-week";
import { Termine } from "@/components/home/termine";
import { GrosseFischeTeaser } from "@/components/home/grosse-fische-teaser";
import { BotHeroIntro, BotStatusLine } from "@/components/home/bot-hero";
import { BotFeed, BotFeedSkeleton } from "@/components/home/bot-feed";
import { MarketRailSkeleton, ListSkeleton } from "@/components/home/skeletons";
import { Skeleton } from "@/components/ui/primitives";

/**
 * Startseite: zuerst der Bot (Nutzen, echte Beispielmeldung, aktuelle
 * Ereignisse), danach Marktueberblick und Hintergrund. Jeder datenabhaengige
 * Abschnitt ist eine eigene Suspense-Grenze, damit eine langsame oder
 * ausgefallene Quelle nie die ganze Seite blockiert.
 */
export default function HomePage() {
  return (
    <div className="space-y-9">
      <BotHeroIntro>
        <Suspense fallback={<Skeleton className="h-4 w-72" />}>
          <BotStatusLine />
        </Suspense>
      </BotHeroIntro>

      <Suspense fallback={<BotFeedSkeleton />}>
        <BotFeed />
      </Suspense>

      <Suspense fallback={<MarketRailSkeleton />}>
        <MarketRail />
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
