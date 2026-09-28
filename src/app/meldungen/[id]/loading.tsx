import { Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[900px] space-y-4" aria-busy="true" aria-label="Meldung wird geladen">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-28" />
      <Skeleton className="h-56" />
      <Skeleton className="h-40" />
    </div>
  );
}
