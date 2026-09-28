import { Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[900px] space-y-4" aria-busy="true" aria-label="Archiv wird geladen">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-16" />
      <Skeleton className="h-72" />
    </div>
  );
}
