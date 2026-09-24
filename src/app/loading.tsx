import { Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Inhalte werden geladen">
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
      <Skeleton className="h-40" />
    </div>
  );
}
