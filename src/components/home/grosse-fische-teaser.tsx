import { Card } from "@/components/ui/primitives";

/**
 * Ehrlicher Platzhalter statt erfundener Daten: Buffett/Burry-Portfolios
 * (SEC-13F) sind noch nicht angebunden - kommt als eigene Etappe.
 */
export function GrosseFischeTeaser() {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-faint">Große Fische</h2>
      <p className="text-[13px] leading-relaxed text-muted">
        Vierteljährliche Portfolios bekannter Investoren (z. B. Warren Buffett, Michael Burry) über echte SEC-13F-Meldungen
        sind in Arbeit und noch nicht angebunden.
      </p>
      <p className="mt-2 text-[11px] text-faint">Bis dahin: echte Einzel-Insidergeschäfte oben unter „Deal der Woche".</p>
    </Card>
  );
}
