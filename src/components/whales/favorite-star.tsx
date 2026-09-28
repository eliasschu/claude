"use client";

import { useSyncExternalStore } from "react";
import { isFavorite, subscribeFavorites, toggleFavorite } from "./favorites-store";

export function FavoriteStar({ slug, label }: { slug: string; label: string }) {
  // Serverseitig ist localStorage unbekannt (null) - bis zum ersten Client-Render neutral bleiben.
  const fav = useSyncExternalStore(subscribeFavorites, () => isFavorite(slug), () => null);
  if (fav === null) return <span className="inline-block h-6 w-6 shrink-0" aria-hidden />;

  return (
    <button
      type="button"
      onClick={() => toggleFavorite(slug)}
      aria-pressed={fav}
      aria-label={fav ? `${label} aus Favoriten entfernen` : `${label} zu Favoriten hinzufügen`}
      className={`shrink-0 rounded-[6px] p-0.5 text-[16px] leading-none transition-colors ${fav ? "text-warn" : "text-faint hover:text-muted"}`}
    >
      {fav ? "★" : "☆"}
    </button>
  );
}
