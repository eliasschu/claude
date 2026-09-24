"use client";

import { useEffect, useRef, useState } from "react";
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

/**
 * Zentrale Suche. Fragt den echten Suchdienst ab (Aktien-Ticker, Krypto-Rangliste,
 * Marktdefinitionen) statt ein Instrumentenarchiv im Browser mitzuschicken.
 */
export function SmartSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const intent = detectIntent(query);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const payload = (await res.json()) as { hits: SearchHit[] };
        if (!cancelled) setHits(payload.hits);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => setActive(0), [hits]);

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
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
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

  const showPanel = open;

  return (
    <div ref={boxRef} className="relative w-full">
      <div
        className={cn(
          "flex items-center gap-2 rounded-[12px] border bg-surface px-3 transition-colors",
          open ? "border-accent" : "border-line",
        )}
      >
        <Search size={16} className="shrink-0 text-faint" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="suchergebnisse"
          aria-autocomplete="list"
          placeholder="Name, Ticker, ISIN, WKN oder Frage"
          aria-label="Wertpapiere und Fragen durchsuchen"
          className="h-11 w-full bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
      </div>

      {showPanel ? (
        <div
          id="suchergebnisse"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_20px_50px_-24px_rgb(0_0_0_/_0.45)]"
        >
          {query.trim().length === 0 ? (
            <div className="p-3">
              <p className="px-1 pb-2 text-[11px] text-faint">Beispiele</p>
              <ul className="space-y-0.5">
                {SEARCH_EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => setQuery(example)}
                      className="w-full rounded-[8px] px-2 py-1.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-ink"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : query.trim().length === 1 ? (
            <p className="px-3 py-4 text-[13px] text-muted">Mindestens zwei Zeichen eingeben.</p>
          ) : (
            <>
              <p className="border-b border-line bg-surface-2 px-3 py-2 text-[11px] leading-snug text-muted">
                {loading ? "Sucht …" : intent.explanation}
              </p>

              {hits.length > 0 ? (
                <ul className="max-h-[320px] overflow-y-auto p-1.5">
                  {hits.map((hit, index) => (
                    <li key={hit.href}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === active}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => go(hit)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left",
                          index === active ? "bg-surface-2" : "",
                        )}
                      >
                        <span className="num inline-flex h-7 min-w-[46px] items-center justify-center rounded-[6px] bg-surface-3 px-1.5 text-[11px] font-bold">
                          {hit.symbol ?? hit.key.toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">{hit.label}</span>
                          <span className="block truncate text-[11px] text-faint">
                            {ASSET_LABEL[hit.kind]} · {hit.sublabel}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : !loading ? (
                <div className="px-3 py-4">
                  <p className="text-[13px] font-semibold">Kein Treffer</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    Aktien werden über die SEC-Tickerliste gesucht (v. a. US-Börsen), Krypto über die CoinGecko-Top-500.
                    Prüfen Sie Schreibweise oder Ticker.
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
