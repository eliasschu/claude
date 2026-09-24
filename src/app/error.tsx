"use client";

import { ErrorState } from "@/components/ui/primitives";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3 py-10">
      <ErrorState
        title="Die Daten konnten nicht geladen werden"
        detail={error.message.includes("nicht eingerichtet") ? error.message : "Bitte versuchen Sie es erneut. Bleibt der Fehler bestehen, ist die Datenquelle möglicherweise nicht erreichbar."}
      />
      <button type="button" onClick={reset} className="rounded-[8px] border border-line px-3 py-1.5 text-[12px] font-semibold">
        Erneut versuchen
      </button>
    </div>
  );
}
