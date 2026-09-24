/**
 * Termine aus offiziellen Kalendern, redaktionell uebernommen und am
 * 22.09.2026 geprueft:
 *   Fed: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 *   EZB: https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html
 */

export interface OfficialEvent {
  id: string; title: string; institution: string;
  /** Tag der Entscheidung (YYYY-MM-DD). */
  date: string;
  /** Uhrzeit laut Quelle als Wanduhrzeit in `timezone`; fehlt, wenn keine genannt ist. */
  time?: { hour: number; minute: number; timezone: string };
  note: string; sourceUrl: string;
}

export const CALENDAR_CHECKED_AT = "2026-09-22";

export const OFFICIAL_EVENTS: OfficialEvent[] = [
  { id: "fomc-2026-10", title: "Zinsentscheidung der Fed", institution: "Federal Reserve", date: "2026-10-28", time: { hour: 14, minute: 0, timezone: "America/New_York" },
    note: "Sitzung am 27. und 28. Oktober; Erklärung um 14:00 Uhr Ortszeit Washington.", sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  { id: "ecb-2026-10", title: "Zinsentscheidung der EZB", institution: "Europäische Zentralbank", date: "2026-10-29",
    note: "Geldpolitische Sitzung am 28. und 29. Oktober, anschließend Pressekonferenz.", sourceUrl: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html" },
  { id: "fomc-2026-12", title: "Zinsentscheidung der Fed", institution: "Federal Reserve", date: "2026-12-09", time: { hour: 14, minute: 0, timezone: "America/New_York" },
    note: "Sitzung am 8. und 9. Dezember mit neuen Projektionen.", sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  { id: "ecb-2026-12", title: "Zinsentscheidung der EZB", institution: "Europäische Zentralbank", date: "2026-12-17",
    note: "Geldpolitische Sitzung am 16. und 17. Dezember, anschließend Pressekonferenz.", sourceUrl: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html" },
];

/** Nur kommende Termine, aufsteigend. */
export function upcomingEvents(now = new Date()): OfficialEvent[] {
  const today = now.toISOString().slice(0, 10);
  return OFFICIAL_EVENTS.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}
