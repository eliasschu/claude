"use client";

import { SmartSearch } from "@/components/layout/smart-search";
import { ErrorState } from "@/components/ui/primitives";

/** Quellenausfall auf der Aktienseite: klar als Fehler benannt, die Suche bleibt nutzbar. */
export default function StockError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-5">
      <SmartSearch scope="stock" size="lg" />
      <div className="space-y-3 py-6">
        <ErrorState
          title="Die Unternehmensdaten konnten gerade nicht geladen werden"
          detail="Die Datenquelle (SEC) ist möglicherweise nicht erreichbar. Das heißt nicht, dass es die Aktie nicht gibt."
        />
        <button type="button" onClick={reset} className="rounded-[8px] border border-line px-3 py-1.5 text-[12px] font-semibold">
          Erneut versuchen
        </button>
      </div>
    </div>
  );
}
