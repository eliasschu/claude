"use client";

import { useEffect, useMemo, useState } from "react";
import type { NewsItem } from "@/lib/services/news";
import { CATEGORY_LABEL } from "@/lib/services/news";
import type { UiDataMeta } from "@/lib/data/types";
import { NewsCard } from "./news-card";
import { Card, EmptyState, ErrorState } from "@/components/ui/primitives";
import { DataStamp } from "@/components/common/data";
import { cn } from "@/lib/utils";

/** Abstand zwischen zwei Abfragen: 150 Sekunden. */
const POLL_MS = 150_000;

type Status = "leerlauf" | "laedt" | "fehler";

/**
 * Zentraler Nachrichtenbereich.
 *
 * Der Feed fragt regelmaessig nach neuen Meldungen. Erscheint keine neue
 * Meldung, bleibt die Liste unveraendert und die Anzeige sagt das auch – es
 * wird nichts erfunden und nichts dupliziert, nur um ein Intervall zu fuellen.
 */
export function NewsFeed({
  initialItems,
  initialMeta,
  compact = false,
}: {
  initialItems: NewsItem[];
  initialMeta: UiDataMeta;
  compact?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [meta, setMeta] = useState(initialMeta);
  const [status, setStatus] = useState<Status>("leerlauf");
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [category, setCategory] = useState<"Alle" | keyof typeof CATEGORY_LABEL>("Alle");

  const categories = useMemo(() => {
    const set = new Set(items.map((item) => item.category));
    return ["Alle" as const, ...Array.from(set)];
  }, [items]);

  const visible = useMemo(
    () => (category === "Alle" ? items : items.filter((item) => item.category === category)),
    [items, category],
  );

  useEffect(() => {
    let cancelled = false;

    async function check() {
      setStatus("laedt");
      try {
        const response = await fetch("/api/news", { cache: "no-store" });
        if (!response.ok) throw new Error(`Antwort ${response.status}`);
        const payload = (await response.json()) as { data: NewsItem[]; meta: UiDataMeta };
        if (cancelled) return;

        setItems((current) => {
          const known = new Set(current.map((item) => item.id));
          const fresh = payload.data.filter((item) => !known.has(item.id));
          setNewCount(fresh.length);
          return fresh.length > 0 ? [...fresh, ...current] : current;
        });
        setMeta(payload.meta);
        setLastCheck(new Date().toISOString());
        setStatus("leerlauf");
      } catch {
        if (!cancelled) setStatus("fehler");
      }
    }

    const timer = window.setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status === "fehler" ? "bg-neg" : status === "laedt" ? "bg-warn" : "bg-pos",
            )}
            aria-hidden
          />
          {status === "fehler"
            ? "Aktualisierung fehlgeschlagen"
            : status === "laedt"
              ? "Prüft auf neue Meldungen"
              : "Feed aktiv"}
        </span>
        <span className="text-[11px] text-faint">
          {lastCheck
            ? newCount > 0
              ? `${newCount} neue Meldung${newCount === 1 ? "" : "en"} übernommen`
              : "Zuletzt geprüft – keine neue Meldung"
            : "Prüft alle 150 Sekunden"}
        </span>
      </div>

      {!compact ? (
        <div className="rail flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2 sm:px-4">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                "shrink-0 rounded-[8px] border px-2.5 py-1 text-[12px] font-semibold transition-colors",
                category === c ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink",
              )}
            >
              {c === "Alle" ? "Alle" : CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      ) : null}

      {status === "fehler" ? (
        <div className="p-3 sm:p-4">
          <ErrorState
            title="Die Nachrichtenquelle antwortet nicht"
            detail="Die zuletzt geladenen Meldungen bleiben sichtbar. Der Feed versucht es in 150 Sekunden erneut."
          />
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="p-3 sm:p-4">
          <EmptyState
            title="Keine Meldungen zu dieser Kategorie"
            hint="Wählen Sie eine andere Kategorie oder setzen Sie den Filter auf „Alle“ zurück."
          />
        </div>
      ) : (
        <div className="divide-y divide-line">
          {visible.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}

      <div className="border-t border-line px-3 py-2.5 sm:px-4">
        <DataStamp meta={meta} />
      </div>
    </Card>
  );
}
