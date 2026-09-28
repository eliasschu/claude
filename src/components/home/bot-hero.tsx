import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function BotHeroIntro({ children }: { children?: React.ReactNode }) {
  return (
    <section aria-labelledby="bot-nutzen" className="pt-2">
      <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-accent">Der Bot</p>
      <h1 id="bot-nutzen" className="mt-2 max-w-[22ch] text-[28px] font-extrabold leading-[1.1] tracking-[-0.035em] sm:text-[40px]">
        Er meldet, wenn sich etwas Wichtiges verändert, mit Begründung und Quelle.
      </h1>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted">
        Der Bot liest Pflichtmeldungen und Marktdaten, ordnet sie nach festen Regeln ein und schreibt dazu, was dagegen
        spricht. Er handelt nicht und gibt keine Kauf- oder Verkaufsempfehlungen.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href="/bot"
          className="inline-flex h-11 items-center gap-2 rounded-[12px] bg-accent px-4 text-[14px] font-bold text-accent-ink hover:opacity-90"
        >
          Bot entdecken <ArrowRight size={16} aria-hidden />
        </Link>
        <a
          href="#beispiel"
          className="inline-flex h-11 items-center rounded-[12px] border border-line-strong bg-surface px-4 text-[14px] font-bold hover:bg-surface-2"
        >
          Beispiel ansehen
        </a>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
