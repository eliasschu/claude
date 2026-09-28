import { SmartSearch } from "@/components/layout/smart-search";
import { ErrorState } from "@/components/ui/primitives";

/** Quellenausfall auf der Aktienseite: klar als Fehler benannt, nicht als "nicht gefunden"; die Suche bleibt nutzbar. */
export function StockUnavailable({ detail }: { detail?: string }) {
  return (
    <div className="space-y-5">
      <SmartSearch scope="stock" size="lg" />
      <div className="py-6">
        <ErrorState
          title="Die Unternehmensdaten konnten gerade nicht geladen werden"
          detail={`${detail ? `${detail} ` : ""}Das heißt nicht, dass es die Aktie nicht gibt. Bitte später erneut versuchen.`}
        />
      </div>
    </div>
  );
}
