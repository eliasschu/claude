import type { Metadata } from "next";
import { ThesisManager } from "@/components/thesis/thesis-manager";

export const metadata: Metadata = { title: "Meine Thesen – Der junge Kapitalist" };

export default function ThesesPage() {
  return (
    <div className="mx-auto max-w-[900px] space-y-5">
      <header>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Meine Thesen</h1>
        <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">
          Dein Tagebuch: warum du ein Unternehmen beobachtest oder besitzt, was dagegen spricht und woran du erkennen würdest, dass
          du falsch liegst. Jede Änderung wird als neue Version mit Begründung gespeichert, jede Prüfung als eigener datierter
          Eintrag. Ein Gesamturteil wie „These intakt“ gibt es bewusst nicht. Automatische Prüfungen gegen Geschäftszahlen folgen
          in einer späteren Etappe.
        </p>
      </header>
      <ThesisManager />
    </div>
  );
}
