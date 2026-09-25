"use client";

import { useEffect, useState } from "react";
import { isFavorite, toggleFavorite, FAVORITES_EVENT } from "./favorites-store";

export function FavoriteStar({ slug, label }: { slug: string; label: string }) {
  const [mounted, setMounted] = useState(false);
  const [fav, setFav] = useState(false);

  useEffect(() => {
    setMounted(true);
    setFav(isFavorite(slug));
    const onChange = () => setFav(isFavorite(slug));
    window.addEventListener(FAVORITES_EVENT, onChange);
    return () => window.removeEventListener(FAVORITES_EVENT, onChange);
  }, [slug]);

  // Serverseitig ist localStorage unbekannt - bis zum ersten Client-Render neutral bleiben.
  if (!mounted) return <span className="inline-block h-6 w-6 shrink-0" aria-hidden />;

  return (
    <button
      type="button"
      onClick={() => setFav(toggleFavorite(slug))}
      aria-pressed={fav}
      aria-label={fav ? `${label} aus Favoriten entfernen` : `${label} zu Favoriten hinzufügen`}
      className={`shrink-0 rounded-[6px] p-0.5 text-[16px] leading-none transition-colors ${fav ? "text-warn" : "text-faint hover:text-muted"}`}
    >
      {fav ? "★" : "☆"}
    </button>
  );
}
