"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useWatchlist } from "./watchlist-provider";
import { cn } from "@/lib/utils";

export function WatchButton({
  symbol,
  name,
  variant = "icon",
}: {
  symbol: string;
  name?: string;
  variant?: "icon" | "full";
}) {
  const { has, toggle, ready } = useWatchlist();
  const active = ready && has(symbol);
  const label = active ? `${name ?? symbol} aus der Watchlist entfernen` : `${name ?? symbol} zur Watchlist hinzufügen`;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => toggle(symbol)}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-[8px] border transition-colors",
          active ? "border-accent bg-accent-soft text-accent" : "border-line text-faint hover:text-ink",
        )}
      >
        {active ? <BookmarkCheck size={15} aria-hidden /> : <Bookmark size={15} aria-hidden />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => toggle(symbol)}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-semibold transition-colors",
        active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface hover:border-line-strong",
      )}
    >
      {active ? <BookmarkCheck size={15} aria-hidden /> : <Bookmark size={15} aria-hidden />}
      {active ? "Gemerkt" : "Merken"}
    </button>
  );
}
