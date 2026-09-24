/** Einheitliche deutsche Formatierung. Prozent und Prozentpunkte bleiben getrennt. */

import { daysBetween } from "../core/time.ts";

export const LOCALE = "de-DE";

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function formatPrice(value: number | null | undefined, currency = "EUR", digits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  const d = digits ?? (Math.abs(value) >= 1 ? 2 : Math.abs(value) >= 0.01 ? 4 : 8);
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(value);
  } catch {
    return `${formatNumber(value, d)} ${currency}`;
  }
}

/** Prozentwert mit Vorzeichen. */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${value > 0 ? "+" : ""}${formatNumber(value, digits)} %`;
}

/** Prozentpunkte – eigene Einheit, nie mit Prozent vermischen. */
export function formatPp(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${value > 0 ? "+" : ""}${formatNumber(value, digits)} Pp.`;
}

/** Basispunkte fuer Renditen: 1 Bp. = 0,01 Prozentpunkte. */
export function formatBp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${value > 0 ? "+" : ""}${formatNumber(value, 0)} Bp.`;
}

export function formatCompact(value: number | null | undefined, currency?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  const abs = Math.abs(value);
  const units: [number, string][] = [[1e12, "Bio."], [1e9, "Mrd."], [1e6, "Mio."], [1e3, "Tsd."]];
  const suffix = currency ? ` ${currencySymbol(currency)}` : "";
  for (const [size, label] of units) {
    if (abs >= size) return `${formatNumber(value / size, abs / size >= 100 ? 0 : 2)} ${label}${suffix}`;
  }
  return `${formatNumber(value, 0)}${suffix}`;
}

export function currencySymbol(currency: string): string {
  const map: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", JPY: "¥", CHF: "CHF" };
  return map[currency] ?? currency;
}

export function formatMultiple(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "–" : `${formatNumber(value, digits)}×`;
}

/** Anteilswert (0,315) als Prozent (31,5 %). */
export function formatShare(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "–" : `${formatNumber(value * 100, digits)} %`;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Deutsches Datum. Zeitzone standardmaessig Wien, fuer Boersendaten ggf. abweichend. */
export function formatDate(value: string | null | undefined, timeZone = "Europe/Vienna"): string {
  const d = parseDate(value);
  return d ? new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(d) : "–";
}

export function formatTime(value: string | null | undefined, timeZone = "Europe/Vienna"): string {
  const d = parseDate(value);
  return d ? new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone }).format(d) : "–";
}

export function formatDateTime(value: string | null | undefined, timeZone = "Europe/Vienna"): string {
  const d = parseDate(value);
  return d ? `${formatDate(value, timeZone)}, ${formatTime(value, timeZone)} Uhr` : "–";
}

/** Spanne zweier gemeldeter Werte, z. B. Congressional-Disclosure-Bandbreiten. */
export function formatRange(low: number | null | undefined, high: number | null | undefined): string {
  if (low === null || low === undefined) return "–";
  if (high === null || high === undefined || high === low) return formatCompact(low, "USD");
  return `${formatCompact(low, "USD")}–${formatCompact(high, "USD")}`;
}

/** Tage zwischen Handelsdatum und Veröffentlichung – nie negativ ausgegeben. */
export function delayInDays(tradeDate: string | null | undefined, publishedDate: string | null | undefined): number | null {
  if (!tradeDate || !publishedDate) return null;
  const days = daysBetween(tradeDate, publishedDate);
  return days === null ? null : Math.max(0, days);
}
