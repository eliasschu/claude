"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWatchlist } from "./watchlist-provider";
import { Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { Delta } from "@/components/common/data";
import { formatNumber } from "@/lib/finance/format";

interface WatchQuote {
  symbol: string;
  name: string;
  price: number | null;
  currency: string | null;
  changePct: number | null;
  ok: boolean;
  message?: string;
}

export function WatchlistView() {
  const { symbols, ready, remove, clear } = useWatchlist();
  const [rows, setRows] = useState<WatchQuote[] | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (symbols.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setRows(null);
    Promise.all(
      symbols.map(async (symbol) => {
        try {
          const res = await fetch(`/api/quote/${symbol}`, { cache: "no-store" });
          const payload = await res.json();
          return payload as WatchQuote;
        } catch {
          return { symbol, name: symbol, price: null, currency: null, changePct: null, ok: false, message: "Abruf fehlgeschlagen" };
        }
      }),
    ).then((data) => { if (!cancelled) setRows(data); });
    return () => { cancelled = true; };
  }, [symbols, ready]);

  if (!ready || rows === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Ihre Watchlist ist noch leer"
        hint="Merken Sie sich Werte über das Lesezeichen-Symbol auf der Startseite oder auf einer Aktien-Detailseite. Die Liste wird nur in diesem Browser gespeichert."
        action={
          <Link href="/" className="mt-1 rounded-[8px] bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-ink">
            Zur Startseite
          </Link>
        }
      />
    );
  }

  return (
    <Card>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.symbol} className="flex items-center gap-3 px-3 py-3 sm:px-4">
            <Link href={`/aktie/${row.symbol}`} className="min-w-0 flex-1 hover:underline">
              <span className="block truncate text-[14px] font-bold">{row.name}</span>
              <span className="num block text-[11px] text-faint">{row.symbol}</span>
            </Link>
            {row.ok && row.price !== null ? (
              <span className="w-[110px] text-right">
                <span className="num block text-[14px] font-bold">{formatNumber(row.price)} {row.currency}</span>
                <Delta value={row.changePct} size="sm" />
              </span>
            ) : (
              <span className="max-w-[160px] text-right text-[11px] text-neg">{row.message ?? "Kein Kurs verfügbar"}</span>
            )}
            <button
              type="button"
              onClick={() => remove(row.symbol)}
              className="rounded-[8px] border border-line px-2 py-1 text-[11px] text-muted hover:text-neg"
              aria-label={`${row.name} entfernen`}
            >
              Entfernen
            </button>
          </li>
        ))}
      </ul>
      <div className="flex justify-end border-t border-line px-3 py-2 sm:px-4">
        <button type="button" onClick={clear} className="text-[12px] text-faint hover:text-neg">
          Watchlist leeren
        </button>
      </div>
    </Card>
  );
}
