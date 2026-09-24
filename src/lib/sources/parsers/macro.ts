import { child, findAll, parseXml, textOf } from "../../core/xml.ts";
import { parseCsv } from "./csv.ts";

export interface DailyPoint {
  /** Kalendertag YYYY-MM-DD des Messwerts. */
  date: string;
  value: number;
}

const byDate = (points: DailyPoint[]) =>
  [...new Map(points.map((p) => [p.date, p])).values()].sort((a, b) => a.date.localeCompare(b.date));

/** EZB Data Portal, Format csvdata: Spalten TIME_PERIOD und OBS_VALUE. */
export function parseEcbCsv(text: string): DailyPoint[] {
  return byDate(
    parseCsv(text)
      .map((r) => ({ date: r.TIME_PERIOD, value: Number(r.OBS_VALUE) }))
      .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value) && p.value > 0),
  );
}

/** US Treasury, Daily Treasury Par Yield Curve Rates (Atom-XML). */
export function parseTreasuryXml(text: string, field = "BC_10YEAR"): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (const props of findAll(parseXml(text), "properties")) {
    const date = textOf(child(props, "NEW_DATE")).slice(0, 10);
    const value = Number(textOf(child(props, field)));
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value)) out.push({ date, value });
  }
  return byDate(out);
}

/** EIA API v2 (Serie RBRTE = Europe Brent Spot Price FOB). */
export function parseEiaSeries(raw: unknown): { points: DailyPoint[]; units: string | null; description: string | null } {
  const data = (raw as { response?: { data?: unknown[] } })?.response?.data;
  if (!Array.isArray(data)) return { points: [], units: null, description: null };
  let units: string | null = null;
  let description: string | null = null;
  const points: DailyPoint[] = [];
  for (const row of data as Record<string, unknown>[]) {
    const date = String(row.period ?? "");
    const value = Number(row.value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value)) points.push({ date, value });
    if (!units && typeof row.units === "string") units = row.units;
    if (!description && typeof row["series-description"] === "string") description = row["series-description"] as string;
  }
  return { points: byDate(points), units, description };
}
