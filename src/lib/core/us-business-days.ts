/**
 * US-Börsenfeiertage (NYSE/Nasdaq-Kalender) für die Berechnung des
 * Meldeverzugs in Geschäftstagen. Feste und bewegliche Feiertage nach
 * Bundesregel; faellt ein Feiertag auf einen Samstag, wird er (wie in den
 * USA ueblich) am Freitag davor beobachtet, faellt er auf einen Sonntag,
 * am Montag danach.
 */

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, last.getUTCDate() - offset));
}

function observed(date: Date): Date {
  const day = date.getUTCDay();
  if (day === 6) return new Date(date.getTime() - 86400000); // Samstag -> Freitag davor
  if (day === 0) return new Date(date.getTime() + 86400000); // Sonntag -> Montag danach
  return date;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Feste und bewegliche US-Feiertage eines Jahres, als YYYY-MM-DD. */
export function usFederalHolidays(year: number): Set<string> {
  const dates = [
    observed(new Date(Date.UTC(year, 0, 1))), // Neujahr
    nthWeekdayOfMonth(year, 0, 1, 3), // Martin Luther King Jr. Day
    nthWeekdayOfMonth(year, 1, 1, 3), // Washingtons Geburtstag
    lastWeekdayOfMonth(year, 4, 1), // Memorial Day
    observed(new Date(Date.UTC(year, 5, 19))), // Juneteenth
    observed(new Date(Date.UTC(year, 6, 4))), // Unabhängigkeitstag
    nthWeekdayOfMonth(year, 8, 1, 1), // Labor Day
    nthWeekdayOfMonth(year, 10, 4, 4), // Thanksgiving
    observed(new Date(Date.UTC(year, 11, 25))), // Weihnachten
  ];
  return new Set(dates.map(isoDay));
}

const holidayCache = new Map<number, Set<string>>();
function holidaysFor(year: number): Set<string> {
  let set = holidayCache.get(year);
  if (!set) { set = usFederalHolidays(year); holidayCache.set(year, set); }
  return set;
}

function isBusinessDay(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidaysFor(d.getUTCFullYear()).has(iso);
}

/**
 * Anzahl der US-Geschäftstage zwischen zwei Tagesdaten (Handelstag exklusive,
 * Meldetag inklusive) – der Standardmassstab für Form-4-Meldeverzug.
 * `null` bei fehlenden oder ungültigen Daten.
 */
export function usBusinessDaysBetween(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  let count = 0;
  let cursor = start + 86400000;
  while (cursor <= end) {
    if (isBusinessDay(new Date(cursor).toISOString().slice(0, 10))) count++;
    cursor += 86400000;
  }
  return count;
}
