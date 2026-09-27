/**
 * Datenaktualitaet. Jede angezeigte Zahl bekommt genau eine Aktualitaetsklasse,
 * abgeleitet aus zwei Dingen:
 *   1. dem Takt der Quelle (Kadenz): wie oft liefert sie ueberhaupt neue Werte?
 *   2. dem gemessenen Alter des Datenzeitpunkts (observedAt), nicht des Abrufs.
 *
 * Die Klassen sind bewusst konservativ: Solange keine Streaming-Quelle
 * angebunden ist, wird nie "LIVE" vergeben. Laesst sich das Alter nicht
 * belegen, lautet die Klasse "UNKNOWN" statt einer freundlichen Vermutung.
 */

import type { DataMeta, SourceId } from "./meta.ts";

export type Cadence =
  /** Laufender Datenstrom (Websocket o. ae.) - derzeit keine Quelle. */
  | "stream"
  /** Abfragebasierte Kurse waehrend des Handels. */
  | "intraday"
  /** Tagesschlusskurse. */
  | "end_of_day"
  /** Taeglich veroeffentlichte Werte (Referenzkurse, Renditen, Spotpreise). */
  | "daily"
  | "weekly"
  /** Quartalsmeldungen, z. B. 13F. */
  | "quarterly"
  /** Jahresabschluesse. */
  | "annual"
  /** Einzelne Meldungen bei Veroeffentlichung (Pressemitteilungen, Form 4, 8-K). */
  | "event";

export type FreshnessClass =
  | "live" | "under_1_min" | "delayed_15_min" | "end_of_day" | "daily" | "weekly"
  | "quarterly" | "annual" | "event" | "stale" | "unknown";

/** Standardtakt je Quelle, falls ein Adapter keinen genaueren angibt. */
export const SOURCE_CADENCE: Record<SourceId, Cadence> = {
  coingecko: "intraday",
  twelvedata: "intraday",
  sec: "event",
  ecb: "daily",
  treasury: "daily",
  eia: "daily",
  "ecb-press": "event",
  "fed-press": "event",
  "sec-press": "event",
  calendar: "event",
};

/** Ab diesem Alter gilt ein Wert als "live" (nur bei Streaming-Quellen). */
export const LIVE_MAX_AGE_MS = 5_000;
export const UNDER_1_MIN_MAX_AGE_MS = 60_000;
export const DELAYED_15_MAX_AGE_MS = 15 * 60_000;
/** Toleranz fuer Uhrabweichungen zwischen Quelle und Server. */
export const FUTURE_TOLERANCE_MS = 2 * 60_000;

/** Deutsche Bezeichnung mit englischem Fachbegriff (fuer Tooltip und Methodikseite). */
export const FRESHNESS_TEXT: Record<FreshnessClass, { label: string; term: string; explain: string }> = {
  live: { label: "Live", term: "Live", explain: "Wert aus einem laufenden Datenstrom, höchstens wenige Sekunden alt." },
  under_1_min: { label: "< 1 Min.", term: "< 1 min", explain: "Der Datenzeitpunkt liegt weniger als eine Minute zurück." },
  delayed_15_min: { label: "bis 15 Min. verzögert", term: "Delayed ≤ 15 min", explain: "Der Datenzeitpunkt liegt zwischen einer und fünfzehn Minuten zurück." },
  end_of_day: { label: "Schlusskurs", term: "End of Day", explain: "Letzter Kurs des Handelstags; die Börse ist geschlossen oder die Quelle liefert nur Tageswerte." },
  daily: { label: "Tageswert", term: "Daily", explain: "Die Quelle veröffentlicht einen Wert je Geschäftstag." },
  weekly: { label: "Wochenwert", term: "Weekly", explain: "Die Quelle veröffentlicht einen Wert je Woche." },
  quarterly: { label: "Quartalswert", term: "Quarterly", explain: "Die Quelle meldet einmal je Quartal, mit gesetzlicher Meldefrist. Kein Echtzeitbild." },
  annual: { label: "Jahreswert", term: "Annual", explain: "Wert aus dem letzten eingereichten Jahresabschluss." },
  event: { label: "Meldung", term: "Event", explain: "Einzelne Meldung, gültig ab ihrer Veröffentlichung." },
  stale: { label: "Veraltet", term: "Stale", explain: "Der Wert ist älter, als es für diese Datenart üblich ist. Nicht als aktuellen Stand lesen." },
  unknown: { label: "Stand unbekannt", term: "Unknown", explain: "Der Datenzeitpunkt ist nicht belegt. Die Aktualität lässt sich nicht beurteilen." },
};

export interface Freshness {
  cls: FreshnessClass;
  /** Alter des Datenzeitpunkts in Millisekunden; null, wenn unbelegt. */
  ageMs: number | null;
  /** Kurze Begruendung fuer genau diese Einstufung. */
  reason: string;
}

export type FreshnessInput = Pick<DataMeta, "sourceId" | "observedAt" | "observedPrecision" | "stale" | "staleReason" | "cadence" | "sessionClosed">;

function parseObserved(observedAt: string): number {
  return Date.parse(observedAt.length === 10 ? `${observedAt}T00:00:00Z` : observedAt);
}

export function classifyFreshness(meta: FreshnessInput, now = Date.now()): Freshness {
  const observed = meta.observedAt ? parseObserved(meta.observedAt) : NaN;
  const ageMs = Number.isNaN(observed) ? null : now - observed;

  if (meta.stale) return { cls: "stale", ageMs, reason: meta.staleReason ?? FRESHNESS_TEXT.stale.explain };
  if (ageMs === null) return { cls: "unknown", ageMs, reason: FRESHNESS_TEXT.unknown.explain };
  if (ageMs < -FUTURE_TOLERANCE_MS) {
    return { cls: "unknown", ageMs, reason: "Der Datenzeitpunkt liegt in der Zukunft. Uhrzeit der Quelle oder des Servers prüfen." };
  }
  const age = Math.max(0, ageMs);
  const cadence = meta.cadence ?? SOURCE_CADENCE[meta.sourceId];

  switch (cadence) {
    case "stream":
      if (age <= LIVE_MAX_AGE_MS) return { cls: "live", ageMs, reason: FRESHNESS_TEXT.live.explain };
      return classifyIntraday(meta, age, ageMs);
    case "intraday":
      return classifyIntraday(meta, age, ageMs);
    case "end_of_day":
      return { cls: "end_of_day", ageMs, reason: FRESHNESS_TEXT.end_of_day.explain };
    default:
      return { cls: cadence, ageMs, reason: FRESHNESS_TEXT[cadence].explain };
  }
}

function classifyIntraday(meta: FreshnessInput, age: number, ageMs: number): Freshness {
  if (meta.sessionClosed === true) {
    return { cls: "end_of_day", ageMs, reason: "Die Börse ist geschlossen; gezeigt wird der letzte Kurs des Handelstags." };
  }
  // Ein nur tagesgenauer Zeitpunkt belegt keine Minutenaktualitaet.
  if (meta.observedPrecision === "day") {
    return { cls: "unknown", ageMs, reason: "Die Quelle nennt für diesen Kurs nur das Datum, nicht die Uhrzeit." };
  }
  if (age <= UNDER_1_MIN_MAX_AGE_MS) return { cls: "under_1_min", ageMs, reason: FRESHNESS_TEXT.under_1_min.explain };
  if (age <= DELAYED_15_MAX_AGE_MS) return { cls: "delayed_15_min", ageMs, reason: FRESHNESS_TEXT.delayed_15_min.explain };
  if (meta.sessionClosed === false) {
    return { cls: "stale", ageMs, reason: "Die Börse ist geöffnet, der Kurs ist aber älter als 15 Minuten." };
  }
  return { cls: "stale", ageMs, reason: "Der Kurs ist älter als 15 Minuten; ob die Börse geschlossen ist, meldet die Quelle nicht." };
}

/** Kompakte Altersangabe fuer die Oberflaeche. */
export function formatAge(ageMs: number | null): string | null {
  if (ageMs === null || ageMs < 0) return null;
  const s = Math.round(ageMs / 1000);
  if (s < 60) return `${s} Sek.`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} Std.`;
  return `${Math.round(h / 24)} Tage`;
}
