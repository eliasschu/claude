import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, Chip } from "@/components/ui/primitives";
import { FEED_RULES } from "@/lib/services/bot-feed";
import { MATERIALITY_THRESHOLDS } from "@/lib/finance/insider-materiality";
import { STOCK_MOVER_UNIVERSE } from "@/config/movers";

export const metadata: Metadata = {
  title: "Der Bot – Der junge Kapitalist",
  description: "Was der Bot heute erkennt, wie eine Meldung aufgebaut ist und nach welchen Regeln ausgewählt wird.",
};

type Stage = "live" | "intern" | "daten" | "geplant";

const STAGE: Record<Stage, { label: string; tone: "pos" | "accent" | "warn" | "neutral" }> = {
  live: { label: "läuft öffentlich", tone: "pos" },
  intern: { label: "gebaut, nicht öffentlich", tone: "accent" },
  daten: { label: "Daten angebunden, Meldung fehlt noch", tone: "warn" },
  geplant: { label: "geplant", tone: "neutral" },
};

/** Nur Faehigkeiten, deren Stand im Code nachpruefbar ist. Aenderungen hier nur zusammen mit dem Code. */
const CAPABILITIES: { title: string; stage: Stage; text: string }[] = [
  {
    title: "Insidermeldungen einordnen",
    stage: "live",
    text: `Liest SEC-Form-4-Meldungen, speichert jede Erkennung unveränderlich im Archiv des Bots (solange er läuft) und zeigt sie hier. Beobachtungsliste der Website: ${STOCK_MOVER_UNIVERSE.length} US-Aktien (${STOCK_MOVER_UNIVERSE.join(", ")}). Trennt Käufe und Verkäufe am offenen Markt von Zuteilungen, Ausübungen und Steuereinbehalten, erkennt Handelspläne (Rule 10b5-1) und Käufe mehrerer Insider.`,
  },
  {
    title: "Marktsignale (Krypto und US-Aktien)",
    stage: "intern",
    text: "Fünf regelbasierte Strategien mit Risikoprüfung, unveränderlichem Signalprotokoll und Backtest mit Kosten. Läuft nur im Research- und Paper-Betrieb und ist noch nicht im Dauerbetrieb. Veröffentlicht wird erst nach rechtlicher Prüfung.",
  },
  {
    title: "Warnung vor überhitzter Hebel-Positionierung",
    stage: "daten",
    text: "Funding, Open Interest und Liquidationen von Binance werden bereits erfasst. Die verständliche Meldung dazu ist noch nicht gebaut.",
  },
  {
    title: "Makro-Lage",
    stage: "daten",
    text: "US-Makrodaten (FRED mit Datenständen) und CFTC-Positionierung werden erfasst. Die Meldung dazu ist noch nicht gebaut.",
  },
  {
    title: "Käufe und Verkäufe von Kongressmitgliedern",
    stage: "geplant",
    text: "Offizielle Meldungen von Repräsentantenhaus und Senat. Sie erscheinen bis zu 45 Tage nach dem Handel, der Verzug wird immer angezeigt.",
  },
  {
    title: "Prognosemärkte",
    stage: "geplant",
    text: "Erst nach Prüfung von Datenlizenz und Datenschutz. Positionen auf Prognosemärkten werden nie als Aktienkäufe oder Insiderwissen dargestellt.",
  },
];

export default function BotPage() {
  return (
    <div className="mx-auto max-w-[820px] space-y-8">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-accent">Der Bot</p>
        <h1 className="mt-2 text-[28px] font-extrabold leading-tight tracking-[-0.03em] sm:text-[34px]">
          Was er erkennt, und wie du es nachprüfen kannst
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Der Bot beobachtet Pflichtmeldungen und Marktdaten. Er meldet sich, wenn eine feste Regel anschlägt, und sagt dazu,
          warum das relevant ist und was dagegen spricht. Er handelt nicht mit Kundengeldern und gibt keine Kauf- oder
          Verkaufsempfehlungen.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/#beispiel" className="inline-flex h-10 items-center rounded-[12px] bg-accent px-4 text-[13px] font-bold text-accent-ink hover:opacity-90">
            Aktuelle Beispielmeldung
          </Link>
          <Link href="/meldungen" className="inline-flex h-10 items-center rounded-[12px] border border-line-strong bg-surface px-4 text-[13px] font-bold hover:bg-surface-2">
            Meldungsarchiv
          </Link>
        </div>
      </header>

      <section aria-labelledby="faehigkeiten">
        <h2 id="faehigkeiten" className="mb-3 text-[18px] font-bold tracking-[-0.01em]">Was der Bot heute kann</h2>
        <ul className="grid gap-2.5">
          {CAPABILITIES.map((c) => (
            <li key={c.title}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-bold">{c.title}</h3>
                  <Chip tone={STAGE[c.stage].tone} className="ml-auto">{STAGE[c.stage].label}</Chip>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{c.text}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="aufbau">
        <h2 id="aufbau" className="mb-3 text-[18px] font-bold tracking-[-0.01em]">So ist jede Meldung aufgebaut</h2>
        <Card>
          <CardBody className="pt-4 sm:pt-5">
            <dl className="grid gap-3 text-[13px] leading-relaxed sm:grid-cols-2">
              <div><dt className="font-semibold">Was ist passiert?</dt><dd className="text-muted">Ein Satz mit Person, Unternehmen, Richtung und Betrag, so wie gemeldet.</dd></div>
              <div><dt className="font-semibold">Warum relevant?</dt><dd className="text-muted">Die Regel, die angeschlagen hat, und die Angaben aus der Meldung, auf die sie sich stützt.</dd></div>
              <div><dt className="font-semibold">Welche Unsicherheit?</dt><dd className="text-muted">Was die Meldung nicht beweist und welche anderen Erklärungen möglich sind.</dd></div>
              <div><dt className="font-semibold">Drei Zeitpunkte</dt><dd className="text-muted">Wann gehandelt wurde, wann die Meldung veröffentlicht wurde und wann der Bot sie vorliegen hatte. Diese Zeiten werden nie vermischt.</dd></div>
            </dl>
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="auswahl" className="scroll-mt-32">
        <h2 id="auswahl" className="mb-3 text-[18px] font-bold tracking-[-0.01em]">Nach welchen Regeln ausgewählt wird</h2>
        <Card>
          <CardBody className="pt-4 sm:pt-5">
            <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-muted">
              <li>Nur Käufe und Verkäufe am offenen Markt, veröffentlicht in den letzten {FEED_RULES.maxAgeDays} Tagen.</li>
              <li>
                Aussagekraft <strong className="text-ink">hoch</strong>: Kauf ohne erkennbaren Handelsplan, oder mindestens{" "}
                {MATERIALITY_THRESHOLDS.clusterMinOwners} Insider derselben Firma kaufen innerhalb von{" "}
                {MATERIALITY_THRESHOLDS.clusterWindowDays} Tagen.
              </li>
              <li>
                Aussagekraft <strong className="text-ink">mittel</strong>: Verkauf ohne Plan ab{" "}
                {(MATERIALITY_THRESHOLDS.largeSaleValueUsd / 1_000_000).toFixed(0)} Mio. US-Dollar oder ab{" "}
                {(MATERIALITY_THRESHOLDS.largeSaleShareOfHolding * 100).toFixed(0)} % des eigenen Bestands.
              </li>
              <li>Käufe mehrerer Insider werden zu einer Meldung je Unternehmen zusammengefasst, ebenso mehrere Zeilen derselben Person.</li>
              <li>Reihenfolge: mehrere Insider vor Einzelkauf vor Verkauf, danach der Betrag, dann die Aktualität.</li>
              <li>Höchstens {FEED_RULES.limit} Ereignisse auf der Startseite. Gibt es weniger, erscheinen weniger. Es wird nichts aufgefüllt.</li>
            </ol>
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="wo">
        <h2 id="wo" className="mb-3 text-[18px] font-bold tracking-[-0.01em]">Wo der Bot läuft</h2>
        <div className="space-y-2 text-[13px] leading-relaxed text-muted">
          <p>
            Der Bot läuft derzeit auf einem privaten Rechner, nicht auf einem Server. Er ruft alle 30 Minuten neue Meldungen ab und
            speichert jede Erkennung dauerhaft. <strong className="text-ink">Das passiert nur, solange der Rechner eingeschaltet, wach
            und online ist.</strong> Im Ruhezustand gibt es keine Erkennungen. Was in dieser Zeit veröffentlicht wurde, wird beim
            nächsten Abruf nachgeholt und trägt dann den späteren, tatsächlichen Erkennungszeitpunkt.
          </p>
          <p>
            Über den Meldungen steht deshalb immer der Zustand der Verbindung und der letzte erfolgreiche Abruf. Ist der Bot nicht
            erreichbar, rechnet die Website dieselben Regeln live nach. Diese Karten tragen das Etikett „Live-Auswertung · nicht
            archiviert“ und gelten nicht als Erkennung des Bots.
          </p>
        </div>
      </section>

      <section aria-labelledby="nicht">
        <h2 id="nicht" className="mb-3 text-[18px] font-bold tracking-[-0.01em]">Was der Bot nicht tut</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-muted">
          <li>Er handelt nicht mit Kundengeldern und löst keine Orders aus.</li>
          <li>Er gibt keine Kauf- oder Verkaufsempfehlungen und keine Kursziele.</li>
          <li>Er verspricht keine Rendite. Trefferquoten nennt er erst, wenn sie aus laufend erfassten Meldungen stammen.</li>
        </ul>
      </section>

      <section aria-labelledby="nachvollziehbarkeit">
        <h2 id="nachvollziehbarkeit" className="mb-3 text-[18px] font-bold tracking-[-0.01em]">Nachvollziehbarkeit</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          Jede archivierte Meldung hat eine <Link href="/meldungen" className="underline">Detailseite</Link> mit vier getrennten
          Zeitpunkten (Handel, Veröffentlichung, Eingang beim Bot, Erkennung), den Einzelangaben aus der SEC-Meldung, Auswahlregel,
          Gegenargumenten, Originalquellen, nachrechenbarer Prüfsumme und dem späteren Kursverlauf (sofern Kursdaten verbunden sind).
          Berichtigungen und größer werdende Kaufgruppen erscheinen als neue, verknüpfte Meldungen; das Original bleibt unverändert.
          Das Archiv zeigt alle Fälle, auch die ohne späteren Kursanstieg, und die Zeiten, in denen der Bot nicht lief.
          <strong className="text-ink"> Trefferquoten gibt es bewusst noch nicht</strong>: Dafür fehlen genug laufend erfasste Fälle.
        </p>
      </section>
    </div>
  );
}
