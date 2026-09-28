import { SmartSearch } from "@/components/layout/smart-search";
import { Skeleton } from "@/components/ui/primitives";

/** Die Suche steht sofort bereit, auch solange die Unternehmensdaten noch laden. */
export default function Loading() {
  return (
    <div className="space-y-5">
      <SmartSearch scope="stock" size="lg" />
      <div className="space-y-4" aria-busy="true" aria-label="Unternehmensdaten werden geladen">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
