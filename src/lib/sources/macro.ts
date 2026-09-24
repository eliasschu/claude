import { env, upstream } from "../core/env.ts";
import { fetchSource, parseJson, parseText, SourceError } from "../core/http.ts";
import { fail, isStale, ok, type DataMeta, type Result, type SourceId } from "../core/meta.ts";
import { parseEcbCsv, parseEiaSeries, parseTreasuryXml, type DailyPoint } from "./parsers/macro.ts";

export interface DailySeries { points: DailyPoint[]; unit: string; description: string }

function dayMeta(sourceId: SourceId, source: string, sourceUrl: string, observed: string | null, fetchedAt: string,
  stale: boolean, staleReason: string | undefined, freshness: string, maxAgeDays: number): DataMeta {
  const tooOld = isStale(observed, maxAgeDays * 86400000);
  return {
    sourceId, source, sourceUrl, observedAt: observed, observedPrecision: "day", fetchedAt, freshness,
    stale: stale || tooOld,
    staleReason: staleReason ?? (tooOld ? "Der letzte verfügbare Tageswert liegt länger zurück als üblich." : undefined),
  };
}

const failure = <T>(sourceId: SourceId, error: unknown): Result<T> =>
  error instanceof SourceError ? fail(sourceId, error.reason, error.message) : fail(sourceId, "unavailable", "Unbekannter Fehler beim Abruf");

/** EZB-Referenzkurs: US-Dollar je Euro. */
export async function getEurUsd(): Promise<Result<DailySeries>> {
  try {
    const start = new Date(Date.now() - 5.2 * 365 * 86400000).toISOString().slice(0, 10);
    const res = await fetchSource({ sourceId: "ecb", url: upstream(`https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata&startPeriod=${start}`), revalidate: 3600, parse: parseText });
    const points = parseEcbCsv(res.value);
    if (points.length === 0) return fail("ecb", "invalid", "Keine Kurswerte in der Antwort");
    return ok({ points, unit: "US-Dollar je Euro", description: "Euro-Referenzkurs der EZB" },
      dayMeta("ecb", "Europäische Zentralbank", "https://data.ecb.europa.eu/data/datasets/EXR/EXR.D.USD.EUR.SP00.A",
        points.at(-1)!.date, res.fetchedAt, res.stale, res.staleReason, "Tageswert an TARGET-Geschäftstagen gegen 16:00 Uhr", 5));
  } catch (error) {
    return failure("ecb", error);
  }
}

/** Rendite 10-jaehriger US-Staatsanleihen (Par Yield) in Prozent. */
export async function getUs10y(): Promise<Result<DailySeries>> {
  try {
    const year = new Date().getUTCFullYear();
    const all: DailyPoint[] = [];
    let fetchedAt = "";
    let stale = false;
    let staleReason: string | undefined;
    for (const y of [year - 1, year]) {
      const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${y}`;
      const res = await fetchSource({ sourceId: "treasury", url: upstream(url), revalidate: y === year ? 3600 : 86400, parse: parseText, timeoutMs: 15000 });
      all.push(...parseTreasuryXml(res.value));
      if (!fetchedAt || res.fetchedAt < fetchedAt) fetchedAt = res.fetchedAt;
      if (res.stale) { stale = true; staleReason = res.staleReason; }
    }
    const points = [...new Map(all.map((p) => [p.date, p])).values()].sort((a, b) => a.date.localeCompare(b.date));
    if (points.length === 0) return fail("treasury", "invalid", "Keine Renditewerte in der Antwort");
    return ok({ points, unit: "Prozent", description: "Rendite 10-jähriger US-Staatsanleihen (Par Yield)" },
      dayMeta("treasury", "U.S. Department of the Treasury", "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve",
        points.at(-1)!.date, fetchedAt, stale, staleReason, "Tageswert nach US-Handelsschluss", 5));
  } catch (error) {
    return failure("treasury", error);
  }
}

/** Brent-Spotpreis laut EIA (nur mit kostenlosem Schluessel). */
export async function getBrent(): Promise<Result<DailySeries>> {
  const key = env.eiaKey();
  if (!key) return fail("eia", "not_configured", "EIA_API_KEY ist nicht gesetzt.");
  try {
    const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${encodeURIComponent(key)}&frequency=daily&data[0]=value&facets[series][]=RBRTE&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=1400`;
    const res = await fetchSource({ sourceId: "eia", url: upstream(url), revalidate: 3600, parse: parseJson });
    const parsed = parseEiaSeries(res.value);
    if (parsed.points.length === 0) return fail("eia", "invalid", "Keine Preiswerte in der Antwort");
    return ok({ points: parsed.points, unit: "US-Dollar je Barrel", description: parsed.description ?? "Europe Brent Spot Price FOB" },
      dayMeta("eia", "U.S. Energy Information Administration", "https://www.eia.gov/dnav/pet/hist/RBRTED.htm",
        parsed.points.at(-1)!.date, res.fetchedAt, res.stale, res.staleReason, "Tageswert mit einigen Tagen Verzug", 12));
  } catch (error) {
    return failure("eia", error);
  }
}
