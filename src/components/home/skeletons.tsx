import { Skeleton } from "@/components/ui/primitives";

export function MarketRailSkeleton() {
  return (
    <div>
      <Skeleton className="mb-2 h-4 w-24" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] w-[164px] shrink-0" />
        ))}
      </div>
    </div>
  );
}

export function PanelSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <Skeleton className="h-64" />
      <div className="grid gap-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div>
      <Skeleton className="mb-2 h-4 w-20" />
      <Skeleton className="h-64" />
    </div>
  );
}
