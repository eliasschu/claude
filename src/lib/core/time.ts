/** Zeitlogik. Anzeige immer in Wiener Zeit mit korrekter Sommer- und Winterzeit. */

export const APP_TIMEZONE = "Europe/Vienna";
const LOCALE = "de-DE";

function zonedParts(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== "literal") map[p.type] = Number(p.value);
  return map as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

export function timezoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()) / 60000);
}

/** Wanduhrzeit einer Zeitzone in einen UTC-Zeitpunkt umrechnen. */
export function zonedWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const first = new Date(guess.getTime() - timezoneOffsetMinutes(guess, timeZone) * 60000);
  const second = timezoneOffsetMinutes(first, timeZone);
  return timezoneOffsetMinutes(guess, timeZone) === second ? first : new Date(guess.getTime() - second * 60000);
}

export function formatDateTimeVienna(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "–";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: APP_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  }).format(d);
}

export function formatTimeVienna(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "–";
  return new Intl.DateTimeFormat(LOCALE, { timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(d);
}

/** Reine Tageswerte (YYYY-MM-DD) werden nicht in eine Zeitzone verschoben. */
export function formatDateOnly(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-");
    return `${d}.${m}.${y}`;
  }
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "–";
  return new Intl.DateTimeFormat(LOCALE, { timeZone: APP_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(from.length === 10 ? `${from}T00:00:00Z` : from);
  const b = Date.parse(to.length === 10 ? `${to}T00:00:00Z` : to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** Nur fuer Abrufzeitpunkte, nie allein fuer Kurszeitpunkte. */
export function relativeAge(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.round(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  return h < 48 ? `vor ${h} Std.` : `vor ${Math.round(h / 24)} Tagen`;
}
