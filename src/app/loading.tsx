"use client";

import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui/primitives";
import { SmartSearch } from "@/components/layout/smart-search";
import { hasPageSearch } from "@/components/layout/header-search";

export default function Loading() {
  // Auf Aktienseiten ersetzt die Seitensuche die Kopfzeilensuche - sie muss daher auch waehrend des Ladens sichtbar sein.
  const stockRoute = hasPageSearch(usePathname());
  return (
    <div className="space-y-4">
      {stockRoute ? <SmartSearch scope="stock" size="lg" /> : null}
      <div className="space-y-4" aria-busy="true" aria-label="Inhalte werden geladen">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
