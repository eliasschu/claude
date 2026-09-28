import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SmartSearch } from "@/components/layout/smart-search";
import { Card, Skeleton } from "@/components/ui/primitives";
import { getTickerIndex } from "@/lib/sources/sec";
import { STOCK_MOVER_UNIVERSE } from "@/config/movers";
import { bot } from "@/lib/bot/client";

export const metadata: Metadata = { title: "Aktien – Der junge Kapitalist" };

const MONITOR_LABEL: Record<string, string> = { sec_form4_insider: "Insidermeldungen (SEC Form 4)" };

/**
 * Beobachtungsliste mit den tatsaechlich ueberwachten Ereignisarten. Ist der Bot erreichbar, gilt seine Liste;
 * sonst die Standardliste der Website (identisch, per Test abgesichert), dann nur als Live-Auswertung.
 */
async function WatchUniverse() {
  const [index, status] = await Promise.all([getTickerIndex(), bot.archiveStatus()]);
  const botList = status.ok ? status.value.data.watchlist : null;
  const tickers = botList ? botList.map((w) => w.ticker) : STOCK_MOVER_UNIVERSE;
  const differs = botList !== null && tickers.join(",") !== STOCK_MOVER_UNIVERSE.join(",");
  return (
    <>
      <p className="mb-2 text-[12px] text-faint">
        {botList
          ? "Überwacht vom lokalen Bot (Liste aus dem Bot)."
          : "Bot nicht verbunden: Diese Liste wertet die Website nur live aus, es wird nichts archiviert."}
        {differs ? " Achtung: Die Liste des Bots weicht von der Standardliste der Website ab (INSIDER_WATCHLIST prüfen)." : ""}
      </p>
      {!index.ok ? <p className="mb-2 text-[12px] text-warn">Firmennamen gerade nicht abrufbar: {index.message}</p> : null}
      <Card>
        <ul className="divide-y divide-line">
          {tickers.map((t) => {
            const l = index.ok ? index.data.byTicker.get(t) : undefined;
            const monitors = botList?.find((w) => w.ticker === t)?.monitors ?? ["sec_form4_insider"];
            return (
              <li key={t}>
                <Link href={`/aktie/${t}`} className="flex items-center gap-3 px-3 py-3 hover:bg-surface-2 sm:px-4">
                  <span className="num inline-flex h-7 min-w-[64px] items-center justify-center rounded-[6px] bg-surface-3 px-1.5 text-[11px] font-bold">{t}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{l?.name ?? t}</span>
                    <span className="block text-[11px] text-faint">
                      {l?.exchange ?? "Börse unbekannt"} · überwacht: {monitors.map((m) => MONITOR_LABEL[m] ?? m).join(", ")}
                      {botList ? "" : " (nur live)"}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

export default function StocksPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-[680px]">
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Aktien</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Suche nach Firmenname oder Börsenkürzel. Gesucht wird in der Tickerliste der SEC, also vor allem in Aktien, die an
          US-Börsen gehandelt werden.
        </p>
        <div className="mt-4">
          <SmartSearch scope="stock" size="lg" />
        </div>
      </div>

      <section aria-labelledby="beobachtungsliste">
        <h2 id="beobachtungsliste" className="mb-2 text-[13px] font-bold uppercase tracking-wide text-faint">
          Beobachtungsliste des Bots
        </h2>
        <p className="mb-3 max-w-[72ch] text-[13px] leading-relaxed text-muted">
          Für diese Aktien wertet der Bot Insidermeldungen aus. Andere Ereignisarten (Berichte, Prognosen) sind geplant. Kurse
          und Tagesveränderungen stehen unter{" "}
          <Link href="/maerkte" className="underline">Märkte</Link>.
        </p>
        <Suspense fallback={<Skeleton className="h-72" />}>
          <WatchUniverse />
        </Suspense>
      </section>
    </div>
  );
}
