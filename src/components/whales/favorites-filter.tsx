"use client";

import { useSyncExternalStore } from "react";
import { getOnlyFavorites, setOnlyFavorites, subscribeFavorites } from "./favorites-store";

export function FavoritesFilterToggle() {
  const only = useSyncExternalStore(subscribeFavorites, getOnlyFavorites, () => false);

  return (
    <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
      <input
        type="checkbox"
        checked={only}
        onChange={(e) => setOnlyFavorites(e.target.checked)}
        className="h-3.5 w-3.5 accent-accent"
      />
      Nur Favoriten
    </label>
  );
}
