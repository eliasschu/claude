"use client";

import { useEffect, useState } from "react";
import { getOnlyFavorites, setOnlyFavorites, FAVORITES_EVENT } from "./favorites-store";

export function FavoritesFilterToggle() {
  const [only, setOnly] = useState(false);

  useEffect(() => {
    setOnly(getOnlyFavorites());
    const onChange = () => setOnly(getOnlyFavorites());
    window.addEventListener(FAVORITES_EVENT, onChange);
    return () => window.removeEventListener(FAVORITES_EVENT, onChange);
  }, []);

  return (
    <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
      <input
        type="checkbox"
        checked={only}
        onChange={(e) => { setOnly(e.target.checked); setOnlyFavorites(e.target.checked); }}
        className="h-3.5 w-3.5 accent-accent"
      />
      Nur Favoriten
    </label>
  );
}
