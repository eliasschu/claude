"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "fw-watchlist";

interface WatchlistContextValue {
  symbols: string[];
  ready: boolean;
  has: (symbol: string) => boolean;
  toggle: (symbol: string) => void;
  remove: (symbol: string) => void;
  clear: () => void;
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

/**
 * Haelt die Watchlist im Browser. Im MVP bewusst lokal: Es werden keine
 * Nutzerdaten an einen Server uebertragen. Mit angebundener Datenbank wandert
 * dieselbe Schnittstelle auf ein Nutzerkonto.
 */
export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setSymbols(parsed.filter((s): s is string => typeof s === "string"));
      }
    } catch {
      // Beschaedigter Eintrag wird ignoriert, die Liste startet leer.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
  }, [symbols, ready]);

  const toggle = useCallback((symbol: string) => {
    setSymbols((current) =>
      current.includes(symbol) ? current.filter((s) => s !== symbol) : [...current, symbol],
    );
  }, []);

  const remove = useCallback((symbol: string) => {
    setSymbols((current) => current.filter((s) => s !== symbol));
  }, []);

  const clear = useCallback(() => setSymbols([]), []);

  const value = useMemo<WatchlistContextValue>(
    () => ({ symbols, ready, has: (s) => symbols.includes(s), toggle, remove, clear }),
    [symbols, ready, toggle, remove, clear],
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistContextValue {
  const context = useContext(WatchlistContext);
  if (!context) throw new Error("useWatchlist muss innerhalb von WatchlistProvider verwendet werden.");
  return context;
}
