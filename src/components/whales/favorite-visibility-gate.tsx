"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getOnlyFavorites, isFavorite, FAVORITES_EVENT } from "./favorites-store";

/** Blendet eine Fondskarte aus, wenn "Nur Favoriten" aktiv ist und dieser Fonds nicht markiert ist. */
export function FavoriteVisibilityGate({ slug, children }: { slug: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const update = () => setHidden(getOnlyFavorites() && !isFavorite(slug));
    update();
    window.addEventListener(FAVORITES_EVENT, update);
    return () => window.removeEventListener(FAVORITES_EVENT, update);
  }, [slug]);

  return <div style={hidden ? { display: "none" } : undefined}>{children}</div>;
}
