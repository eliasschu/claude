import type { Metadata } from "next";
import { WatchlistView } from "@/components/watchlist/watchlist-view";

export const metadata: Metadata = { title: "Watchlist – Finanzwelt-App" };

export default function WatchlistPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Watchlist</h1>
        <p className="mt-1 text-[13px] text-muted">Gemerkte Werte mit Tageskurs. Gespeichert lokal in Ihrem Browser.</p>
      </div>
      <WatchlistView />
    </div>
  );
}
