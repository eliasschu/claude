import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Datenquellen und Methodik – Der junge Kapitalist" };

const CONNECTED = [
  { area: "Aktienkurse (Intraday, aktuell)", source: "Twelve Data", env: "TWELVEDATA_API_KEY", note: "Gratistarif: 8 Abrufe/Minute, 800/Tag. Kein Bulk-Endpunkt – deshalb kuratierte Beobachtungsliste statt Top-500-Aktien." },
  { area: "Kryptowährungen", source: "CoinGecko", env: "COINGECKO_API_KEY", note: "Top ~500 nach Marktkapitalisierung in einem Abruf – vollständige Liste, kostenlos." },
  { area: "Unternehmenszahlen, Insider (Form 4)", source: "SEC EDGAR", env: "SEC_EDGAR_USER_AGENT", note: "Kostenlos, benötigt aussagekräftigen User-Agent. Nur bei der SEC registrierte (meist US-)Unternehmen." },
  { area: "13F-Meldungen institutioneller Investoren (\"Große Fische\")", source: "SEC EDGAR", env: "SEC_EDGAR_USER_AGENT", note: "Kostenlos, vierteljährlich mit bis zu 45 Tagen Meldeverzug. Siehe /grosse-fische." },
  { area: "Zinsen, Wechselkurs, Rohöl", source: "EZB, US-Finanzministerium, EIA", env: "EIA_API_KEY", note: "EZB und US-Treasury ohne Schlüssel, EIA braucht einen kostenlosen Schlüssel." },
  { area: "Presse-Meldungen", source: "EZB-, Fed- und SEC-Pressefeeds (RSS)", env: "–", note: "Offizielle Pressemitteilungen, keine redaktionelle Einordnung." },
];

const MISSING = [
  {
    area: "Indexstände (DAX, S&P 500, Nasdaq 100, MSCI World)",
    note: "Lizenzpflichtig, in keinem Gratistarif enthalten. ETF-Kurse werden bewusst nicht als Indexstand ausgegeben.",
    provider: "Twelve Data, höherer Tarif (\"Grow\")", cost: "ab ca. 29–79 $/Monat",
    caveat: "Unsicher, ob Indexlevel im Tarif enthalten sind – vor Anmeldung direkt bei Twelve Data klären.",
  },
  {
    area: "Gold- und Silberpreis (echter Spotpreis)",
    note: "Referenzpreise sind durchweg lizenzpflichtig.",
    provider: "–", cost: "kein günstiger Anbieter gefunden",
    caveat: "ETF-Ersatz (GLD/SLV, bereits angebunden) bleibt die pragmatische Lösung.",
  },
  {
    area: "Top-500-Aktien live gerankt",
    note: "Twelve Data Gratistarif erlaubt 8 Abrufe/Minute – 500 Einzelabrufe würden über eine Stunde dauern.",
    provider: "EODHD, Bulk-Fundamentals-API", cost: "\"All-in-One\" 99,99 €/Monat; echter Bulk-Endpunkt braucht zusätzlich einen \"Extended Fundamentals\"-Vertrag (Preis nur auf Anfrage)",
    caveat: "",
  },
  {
    area: "Analystenkonsens und Kursziele",
    note: "Kein Anbieter angebunden.",
    provider: "Financial Modeling Prep", cost: "Free-Tier vorhanden (250 Abrufe/Tag); bezahlte Stufen mit widersprüchlichen Preisangaben in der Recherche – vor Anmeldung live prüfen",
    caveat: "",
  },
  {
    area: "Reiche Unternehmensprofile (Segmente, Wettbewerber, Moat)",
    note: "SEC-Zahlen liefern das nicht.",
    provider: "–", cost: "kein passender Anbieter recherchiert",
    caveat: "",
  },
  {
    area: "Politiker-Offenlegungen (Congressional Disclosures)",
    note: "Rohdaten sind PDFs direkt vom US-Kongress, öffentlich, aber unstrukturiert.",
    provider: "Quiver Quantitative", cost: "Hobbyist 15 $ / Trader 30 $ pro Monat",
    caveat: "Diese Tarife verbieten Weitergabe an Dritte ausdrücklich – für eine App mit zahlenden Nutzern wäre die separate \"Commercial\"-Lizenz nötig (Preis nur auf Anfrage bei Quiver). Deshalb vorerst zurückgestellt.",
  },
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
          <ul className="space-y-3 text-[12px]">
            {MISSING.map((m) => (
              <li key={m.area} className="border-b border-line pb-3 last:border-0">
                <span className="font-semibold">{m.area}</span>
                <p className="mt-0.5 text-muted">{m.note}</p>
                {m.provider !== "–" ? (
                  <p className="mt-1 text-[11px] text-faint">
                    Möglicher Anbieter: <span className="font-semibold text-muted">{m.provider}</span> · {m.cost}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-faint">{m.cost}</p>
                )}
                {m.caveat ? <p className="mt-1 text-[11px] text-warn">{m.caveat}</p> : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Vorschlag: bezahlte Stufen (Recherche-Stand, noch nicht umgesetzt)"
          description="Reine Recherche vom September 2026 – keine Anmeldung, kein Kauf. Preise vor einer echten Umsetzung live gegenprüfen, sie schwankten schon zwischen zwei Recherche-Durchläufen."
        />
        <CardBody className="space-y-2.5 text-[12px] leading-relaxed">
          <p><span className="font-semibold">Free (wie heute):</span> kuratierte Insider-Watchlist, Große Fische inkl. Konsens-Käufe, Kryptowährungen, Marktleiste mit ETF-Ersatzkursen.</p>
          <p><span className="font-semibold">Plus (9,99 €):</span> höherer Twelve-Data-Tarif für mehr/aktuellere Kurse und – falls bestätigt – echte Indexstände; größere Insider-Watchlist.</p>
          <p><span className="font-semibold">Pro (29,99 €):</span> Analystenkonsens/Kursziele (Financial Modeling Prep), Top-500-Live-Ranking (EODHD).</p>
          <p className="text-warn">Politiker-Offenlegungen sind bewusst in keiner Stufe eingeplant, solange die Lizenzfrage bei Quiver Quantitative ungeklärt ist.</p>
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
