/**
 * Darstellungshilfen fuer archivierte Meldungen - reine Funktionen.
 * Vier Zeitpunkte werden nie vermischt: Handel, Veroeffentlichung, Eingang beim Bot, Erkennung.
 */

import type { ArchivedMessage, BotMessageKind, LinkRelation, MessageLink } from "../services/bot-feed.ts";

export interface TimelineStep {
  key: "gehandelt" | "veroeffentlicht" | "eingegangen" | "erkannt";
  label: string;
  /** ISO-Zeitpunkt oder Datum (Handel). null = nicht erfasst. */
  at: string | null;
  precision: "day" | "minute";
  /** Abstand zum vorherigen Schritt, lesbar. */
  sincePrevious: string | null;
  note?: string;
}

/** Lesbarer Abstand; negative Werte werden nicht beschoenigt. */
export function formatDelay(ms: number): string {
  const sign = ms < 0 ? "−" : "";
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60000);
  if (min < 60) return `${sign}${min} Min.`;
  const h = abs / 3600000;
  if (h < 48) return `${sign}${h.toFixed(h < 10 ? 1 : 0).replace(".", ",")} Std.`;
  return `${sign}${Math.round(h / 24)} Tage`;
}

const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Kalendertage zwischen (letztem) Handelstag und Veroeffentlichung - Handelstage haben keine Uhrzeit. */
function tradeToPublication(traded: string, publishedIso: string): string {
  const pubDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(publishedIso));
  const days = Math.round((dayStart(pubDay) - dayStart(traded)) / 86400000);
  return days <= 0 ? "am Handelstag veröffentlicht" : `${days} ${days === 1 ? "Kalendertag" : "Kalendertage"} nach dem (letzten) Handelstag`;
}

export function timeline(m: ArchivedMessage): TimelineStep[] {
  const traded = m.traded_to ?? m.traded_from;
  const steps: TimelineStep[] = [
    { key: "gehandelt", label: "Gehandelt", at: m.traded_from, precision: "day", sincePrevious: null,
      note: m.traded_to && m.traded_to !== m.traded_from ? `bis ${m.traded_to}` : undefined },
    { key: "veroeffentlicht", label: "Veröffentlicht (SEC-Annahme)", at: m.published_at, precision: "minute",
      sincePrevious: traded ? tradeToPublication(traded, m.published_at) : null },
    { key: "eingegangen", label: "Beim Bot eingegangen", at: m.received_at ?? null, precision: "minute",
      sincePrevious: m.received_at ? formatDelay(Date.parse(m.received_at) - Date.parse(m.published_at)) + " nach Veröffentlichung" : null,
      note: m.received_at ? undefined : "Für Meldungen vor Regelversion 1.1 nicht erfasst (wird nicht nachgetragen)." },
    { key: "erkannt", label: "Vom Bot erkannt", at: m.detected_at, precision: "minute",
      sincePrevious: formatDelay(Date.parse(m.detected_at) - Date.parse(m.received_at ?? m.published_at))
        + (m.received_at ? " nach Eingang" : " nach Veröffentlichung") },
  ];
  return steps;
}

/** Wurde die Meldung erst deutlich nach der Veroeffentlichung erkannt (z. B. Rechner im Ruhezustand, Nachladen)? */
export function lateDetection(m: ArchivedMessage, thresholdMs = 2 * 3600000): string | null {
  const delay = Date.parse(m.detected_at) - Date.parse(m.published_at);
  return delay > thresholdMs
    ? `Erst ${formatDelay(delay)} nach der Veröffentlichung erkannt. In dieser Zeit lief der Bot nicht oder hatte die Meldung noch nicht abgerufen. Der Erkennungszeitpunkt ist der tatsächliche, nicht zurückdatiert.`
    : null;
}

export const RELATION_TEXT: Record<LinkRelation, { frueher: string; spaeter: string }> = {
  berichtigt: { frueher: "Berichtigt diese frühere Meldung", spaeter: "Später berichtigt durch" },
  erweitert: { frueher: "Erweitert diese frühere Kaufgruppe", spaeter: "Später erweitert zu" },
  fasst_zusammen: { frueher: "Fasst diese frühere Einzelmeldung zusammen", spaeter: "Später Teil der Kaufgruppe" },
};

export function linkText(l: MessageLink): string {
  return RELATION_TEXT[l.relation][l.direction];
}

/** Status aus Sicht der Meldung selbst - abgeleitet aus Verknuepfungen, das Original wird nie veraendert. */
export function messageStatus(m: ArchivedMessage, links: MessageLink[]): { label: string; tone: "neutral" | "warn" | "accent" } {
  if (links.some((l) => l.direction === "spaeter" && l.relation === "berichtigt")) return { label: "Später berichtigt", tone: "warn" };
  if (links.some((l) => l.direction === "spaeter")) return { label: "Später erweitert", tone: "accent" };
  if (m.amendment) return { label: "Berichtigung", tone: "warn" };
  return { label: "Original", tone: "neutral" };
}

export const KIND_OPTIONS: { value: BotMessageKind; label: string }[] = [
  { value: "insider_cluster", label: "Mehrere Insider kaufen" },
  { value: "insider_buy", label: "Insiderkauf" },
  { value: "insider_sale", label: "Insiderverkauf" },
];

export const PERIOD_OPTIONS = [
  { value: "7", label: "7 Tage" },
  { value: "30", label: "30 Tage" },
  { value: "90", label: "90 Tage" },
  { value: "alle", label: "Gesamtes Archiv" },
] as const;

export interface ArchiveFilters {
  ticker?: string; kind?: BotMessageKind; materiality?: "hoch" | "mittel"; period: string; page: number;
}

/** Filter aus der URL - ungueltige Werte werden verworfen statt still umgedeutet. */
export function parseArchiveFilters(sp: Record<string, string | string[] | undefined>): ArchiveFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const ticker = one("ticker").toUpperCase();
  const kind = KIND_OPTIONS.find((o) => o.value === one("art"))?.value;
  const mat = one("aussagekraft");
  const period = PERIOD_OPTIONS.some((o) => o.value === one("zeitraum")) ? one("zeitraum") : "alle";
  const page = Math.max(1, Math.min(2000, Number.parseInt(one("seite") || "1", 10) || 1));
  return {
    ticker: /^[A-Z0-9.\-]{1,12}$/.test(ticker) ? ticker : undefined,
    kind,
    materiality: mat === "hoch" || mat === "mittel" ? mat : undefined,
    period,
    page,
  };
}

export function sinceFor(period: string, now = new Date()): string | undefined {
  const days = Number(period);
  return Number.isFinite(days) && days > 0 ? new Date(now.getTime() - days * 86400000).toISOString() : undefined;
}

/** URL einer Archivseite mit gegebenen Filtern (fuer Blaettern und Zuruecksetzen). */
export function archiveHref(f: Partial<ArchiveFilters>): string {
  const q = new URLSearchParams();
  if (f.ticker) q.set("ticker", f.ticker);
  if (f.kind) q.set("art", f.kind);
  if (f.materiality) q.set("aussagekraft", f.materiality);
  if (f.period && f.period !== "alle") q.set("zeitraum", f.period);
  if (f.page && f.page > 1) q.set("seite", String(f.page));
  const s = q.toString();
  return s ? `/meldungen?${s}` : "/meldungen";
}
