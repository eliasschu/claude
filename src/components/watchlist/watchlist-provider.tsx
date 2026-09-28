"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

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

const EVENT = "fw:watchlist-changed";

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) cb(); };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", onStorage); };
}

// Rohtext als Momentaufnahme (stabiler Vergleich); "" = leer oder Speicher gesperrt, null = Server
function readRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function parse(raw: string): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    // Beschaedigter Eintrag wird ignoriert, die Liste startet leer.
    return [];
  }
}

function write(update: (current: string[]) => string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(update(parse(readRaw()))));
  } catch {
    // Speicher gesperrt (z. B. privates Fenster) - Aenderung geht verloren.
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Haelt die Watchlist im Browser. Im MVP bewusst lokal: Es werden keine
 * Nutzerdaten an einen Server uebertragen. Mit angebundener Datenbank wandert
 * dieselbe Schnittstelle auf ein Nutzerkonto.
 */
export function WatchlistProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore<string | null>(subscribe, readRaw, () => null);
  const ready = raw !== null;
  const symbols = useMemo(() => parse(raw ?? ""), [raw]);

  const toggle = useCallback((symbol: string) => {
    write((current) => (current.includes(symbol) ? current.filter((s) => s !== symbol) : [...current, symbol]));
  }, []);

  const remove = useCallback((symbol: string) => {
    write((current) => current.filter((s) => s !== symbol));
  }, []);

  const clear = useCallback(() => write(() => []), []);

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
