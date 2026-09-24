import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Datenquellen und Methodik – Finanzwelt-App" };

const CONNECTED = [
  { area: "Aktienkurse (Intraday, aktuell)", source: "Twelve Data", env: "TWELVEDATA_API_KEY", note: "Gratistarif: 8 Abrufe/Minute, 800/Tag. Kein Bulk-Endpunkt – deshalb kuratierte Beobachtungsliste statt Top-500-Aktien." },
  { area: "Kryptowährungen", source: "CoinGecko", env: "COINGECKO_API_KEY", note: "Top ~500 nach Marktkapitalisierung in einem Abruf – vollständige Liste, kostenlos." },
  { area: "Unternehmenszahlen, Insider (Form 4)", source: "SEC EDGAR", env: "SEC_EDGAR_USER_AGENT", note: "Kostenlos, benötigt aussagekräftigen User-Agent. Nur bei der SEC registrierte (meist US-)Unternehmen." },
  { area: "Zinsen, Wechselkurs, Rohöl", source: "EZB, US-Finanzministerium, EIA", env: "EIA_API_KEY", note: "EZB und US-Treasury ohne Schlüssel, EIA braucht einen kostenlosen Schlüssel." },
  { area: "Presse-Meldungen", source: "EZB-, Fed- und SEC-Pressefeeds (RSS)", env: "–", note: "Offizielle Pressemitteilungen, keine redaktionelle Einordnung." },
];

const MISSING = [
  { area: "Indexstände (DAX, S&P 500, Nasdaq 100, MSCI World)", note: "Lizenzpflichtig, in keinem Gratistarif enthalten. ETF-Kurse werden bewusst nicht als Indexstand ausgegeben." },
  { area: "Gold- und Silberpreis", note: "Referenzpreise sind lizenzpflichtig." },
  { area: "Top-500-Aktien live gerankt", note: "Twelve Data Gratistarif erlaubt 8 Abrufe/Minute – 500 Einzelabrufe würden über eine Stunde dauern. Braucht einen Massendaten-Anbieter (z. B. EODHD, Financial Modeling Prep)." },
  { area: "Analystenkonsens und Kursziele", note: "Kein Anbieter angebunden. Würde z. B. Financial Modeling Prep erfordern." },
  { area: "Reiche Unternehmensprofile (Segmente, Wettbewerber, Moat)", note: "SEC-Zahlen liefern das nicht; braucht einen redaktionellen oder KI-gestützten Datenanbieter." },
  { area: "Politiker-Offenlegungen (Congressional Disclosures)", note: "Rohdaten sind PDFs; ein Aufbereitungsdienst ist nötig." },
  { area: "13F-Meldungen institutioneller Investoren", note: "Bei der SEC verfügbar, aber noch nicht als Dienst angebunden." },
];

export default function SourcesPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Datenquellen und Methodik</h1>
        <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-muted">
          Es gibt keinen Demo-Modus mehr. Jeder Wert kommt entweder von einer echten, unten genannten Quelle – oder
          fehlt sichtbar, statt erfunden zu werden.
        </p>
      </div>

      <Card>
        <CardHeader title="Angebundene Quellen" />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-line text-[11px] text-faint">
                  <th className="py-1.5 pr-3 font-semibold">Bereich</th>
                  <th className="py-1.5 pr-3 font-semibold">Quelle</th>
                  <th className="py-1.5 pr-3 font-semibold">Variable</th>
                  <th className="py-1.5 font-semibold">Hinweis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {CONNECTED.map((n) => (
                  <tr key={n.area}>
                    <td className="py-2 pr-3 font-semibold">{n.area}</td>
                    <td className="py-2 pr-3">{n.source}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{n.env}</td>
                    <td className="py-2 text-muted">{n.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Noch nicht verfügbar" description="Bewusst leer statt erfunden. Diese Bereiche brauchen eine zusätzliche, meist kostenpflichtige Quelle." />
        <CardBody>
          <ul className="space-y-2.5 text-[12px]">
            {MISSING.map((m) => (
              <li key={m.area} className="border-b border-line pb-2.5 last:border-0">
                <span className="font-semibold">{m.area}</span>
                <p className="mt-0.5 text-muted">{m.note}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Modellbewertung" />
        <CardBody className="space-y-2 text-[13px] leading-relaxed text-muted">
          <p>Der faire Wert ist ein zweiphasiges Discounted-Cashflow-Modell mit drei Szenarien (pessimistisch, Basis, optimistisch). Für Branchen, in denen ein Cashflow-DCF ungeeignet ist (Banken, Versicherer, Immobilien), schaltet das Modell sich ab und nennt den Grund.</p>
          <p>Abschlag und Potenzial werden getrennt ausgewiesen und nie vermischt. Ein Reverse-DCF zeigt zusätzlich, welches Wachstum der heutige Kurs voraussetzt.</p>
        </CardBody>
      </Card>
    </div>
  );
}
