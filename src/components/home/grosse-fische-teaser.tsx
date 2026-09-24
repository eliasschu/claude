import Link from "next/link";
import { WHALES } from "@/config/whales";
import { WhaleCard } from "@/components/whales/whale-card";

/** Reale SEC-13F-Bestände - vierteljährlich, mit bis zu 45 Tagen Meldeverzug. */
export async function GrosseFischeTeaser() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-faint">Große Fische</h2>
        <Link href="/grosse-fische" className="ml-auto text-[11px] font-semibold text-accent">
          Alle {WHALES.length} Fonds ↗
        </Link>
      </div>
      <WhaleCard profile={WHALES[0]} rows={5} />
    </div>
  );
}
