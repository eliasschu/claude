import type { Metadata } from "next";
import { Suspense } from "react";
import { WHALES } from "@/config/whales";
import { WhaleCard } from "@/components/whales/whale-card";
import { ConsensusPicks } from "@/components/whales/consensus-picks";
import { PanelSkeleton, ListSkeleton } from "@/components/home/skeletons";

export const metadata: Metadata = { title: "Große Fische – Der junge Kapitalist" };

/**
 * Jeder Fonds ist eine eigene Suspense-Grenze: ein langsamer oder
 * ausgefallener SEC-Abruf blockiert nie die uebrigen Karten.
 */
export default function GrosseFischePage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Große Fische</h1>
        <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-muted">
          US-Aktienbestände großer institutioneller Investoren laut SEC-Formular 13F-HR. Meldepflichtig nur für
          US-Positionen ab 100 Mio. USD, mit bis zu 45 Tagen Verzug nach Quartalsende – das sind keine aktuellen
          Depots, sondern der letzte veröffentlichte Stand. Kein Leerverkauf, kaum Derivate, keine
          Nicht-US-Positionen enthalten.
        </p>
      </div>

      <Suspense fallback={<ListSkeleton />}>
        <ConsensusPicks />
      </Suspense>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {WHALES.map((profile) => (
          <Suspense key={profile.slug} fallback={<PanelSkeleton />}>
            <WhaleCard profile={profile} rows={5} />
          </Suspense>
        ))}
      </div>
    </div>
  );
}
