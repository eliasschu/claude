"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { SearchHit } from "@/lib/services/search";
import { SEARCH_EXAMPLES, detectIntent } from "@/lib/search/intents";
import { cn } from "@/lib/utils";

const ASSET_LABEL: Record<SearchHit["kind"], string> = {
  stock: "Aktie",
  crypto: "Krypto",
  market: "Markt",
};

const STOCK_EXAMPLES = ["Apple", "NVDA", "Microsoft", "JPM"];

type Status = "idle" | "loading" | "done" | "error";

/**
 * Suche mit Vorschlagsliste (ARIA-Combobox). Fragt den echten Suchdienst ab
 * statt ein Instrumentenarchiv im Browser mitzuschicken.
 *
 * scope="all": Aktien, Krypto und Maerkte (Kopfzeile).
 * scope="stock": nur Aktien nach Firmenname oder Boersenkuerzel, mit Boerse,
 * damit aehnliche Titel unterscheidbar sind (Aktienuebersicht, Aktienseite).
 */
export function SmartSearch({ scope = "all", size = "md", autoFocus = false }: { scope?: "all" | "stock"; size?: "md" | "lg"; autoFocus?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<{ query: string; hits: SearchHit[]; issues: string[]; failed: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const stockOnly = scope === "stock";
  const intent = detectIntent(query);
  const q = query.trim();

  // Ergebnis gilt nur fuer die Eingabe, zu der es geholt wurde - sonst "laedt".
  const current = q.length >= 2 && result?.query === q ? result : null;
  const status: Status = q.length < 2 ? "idle" : !current ? "loading" : current.failed ? "error" : "done";
  const hits = current?.hits ?? [];
  const issues = current?.issues ?? [];

  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${stockOnly ? "&scope=stock" : ""}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const payload = (await res.json()) as { hits: SearchHit[]; issues?: string[] };
        if (cancelled) return;
        setResult({ query: q, hits: payload.hits, issues: payload.issues ?? [], failed: false });
      } catch {
        if (cancelled) return;
        setResult({ query: q, hits: [], issues: [], failed: true });
      }
      setActive(0);
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, stockOnly]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function hrefFor(hit: SearchHit): string {
    return intent.anchor && hit.kind === "stock" ? `${hit.href}${intent.anchor}` : hit.href;
  }

  function go(hit: SearchHit) {
    setOpen(false);
    router.push(hrefFor(hit));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (open) setOpen(false);
      else setQuery("");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (hits[active]) go(hits[active]);
    }
  }

  const examples = stockOnly ? STOCK_EXAMPLES : SEARCH_EXAMPLES;
  const optionId = (index: number) => `${listId}-option-${index}`;
  const blockingIssue = hits.length === 0 && issues.length > 0;
  const liveText =
    status === "loading" ? "Suche läuft" :
    status === "error" ? "Suche fehlgeschlagen" :
    status === "done" ? (hits.length ? `${hits.length} Treffer` : "Kein Treffer") : "";

  return (
    <div ref={boxRef} className="relative w-full">
      <div
        className={cn(
          "flex items-center gap-2 rounded-[12px] border bg-surface px-3 transition-colors focus-within:border-accent",
          open ? "border-accent" : size === "lg" ? "border-line-strong" : "border-line",
        )}
      >
        <Search size={size === "lg" ? 18 : 16} className="shrink-0 text-faint" aria-hidden />
        <input
          type="search"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && hits[active] ? optionId(active) : undefined}
          placeholder={stockOnly ? "Aktie suchen: Firmenname oder Börsenkürzel" : "Name, Ticker, ISIN, WKN oder Frage"}
          aria-label={stockOnly ? "Aktie nach Firmenname oder Börsenkürzel suchen" : "Wertpapiere und Fragen durchsuchen"}
          autoComplete="off"
          spellCheck={false}
          className={cn("w-full bg-transparent outline-none placeholder:text-faint", size === "lg" ? "h-12 text-[15px]" : "h-11 text-[14px]")}
        />
      </div>
      <span className="sr-only" aria-live="polite">{liveText}</span>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Suchergebnisse"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_20px_50px_-24px_rgb(0_0_0_/_0.45)]"
        >
          {q.length === 0 ? (
            <div className="p-3">
              <p className="px-1 pb-2 text-[11px] text-faint">Beispiele</p>
              <ul className="flex flex-wrap gap-1.5">
                {examples.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => setQuery(example)}
                      className="rounded-[8px] border border-line px-2.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-ink"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : q.length === 1 ? (
            <p className="px-3 py-4 text-[13px] text-muted">Mindestens zwei Zeichen eingeben.</p>
          ) : (
            <>
              {!stockOnly || status === "loading" ? (
                <p className="border-b border-line bg-surface-2 px-3 py-2 text-[11px] leading-snug text-muted">
                  {status === "loading" ? "Sucht …" : intent.explanation}
                </p>
              ) : null}

              {status === "error" ? (
                <div className="px-3 py-4">
                  <p className="text-[13px] font-semibold">Suche gerade nicht möglich</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">Die Verbindung zum Suchdienst ist fehlgeschlagen. Bitte gleich noch einmal versuchen.</p>
                </div>
              ) : hits.length > 0 ? (
                <ul className="max-h-[340px] overflow-y-auto p-1.5">
                  {hits.map((hit, index) => (
                    <li
                      key={hit.href}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === active}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(hit)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-[8px] px-2.5 py-2",
                        index === active ? "bg-surface-2" : "",
                      )}
                    >
                      <span className="num inline-flex h-7 min-w-[64px] items-center justify-center rounded-[6px] bg-surface-3 px-1.5 text-[11px] font-bold">
                        {hit.symbol ?? hit.key.toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{hit.label}</span>
                        <span className="block truncate text-[11px] text-faint">
                          {hit.kind === "stock"
                            ? `${stockOnly ? "" : "Aktie · "}${hit.exchange ?? "Börse unbekannt"}`
                            : `${ASSET_LABEL[hit.kind]} · ${hit.sublabel}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : status === "done" ? (
                <div className="px-3 py-4">
                  <p className="text-[13px] font-semibold">{blockingIssue ? "Suche eingeschränkt" : "Kein Treffer"}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    {blockingIssue
                      ? issues.join(" ")
                      : stockOnly
                        ? "Gesucht wird in der Tickerliste der SEC (vor allem an US-Börsen gehandelte Aktien). Prüfen Sie Schreibweise oder Kürzel."
                        : "Aktien werden über die SEC-Tickerliste gesucht (v. a. US-Börsen), Krypto über die CoinGecko-Top-500. Prüfen Sie Schreibweise oder Ticker."}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
