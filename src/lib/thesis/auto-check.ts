/**
 * Fuehrt „Jetzt prüfen“ aus: holt die normalisierten SEC-Zahlen ueber die eigene Route (nur das Boersenkuerzel
 * verlaesst den Browser) und wertet die Kriterien lokal aus. Es gibt keine Hintergrundpruefung.
 */

import type { NormalizedFacts } from "../finance/sec-facts.ts";
import { evaluateCriterion } from "./criteria-eval.ts";
import { current, type AutoCheckRun, type Thesis } from "./model.ts";

export type FactsResponse =
  | { ok: true; ticker: string; facts: NormalizedFacts; fetchedAt: string; stale: boolean; staleReason: string | null; sourceUrl: string | null }
  | { ok: false; reason: string; message: string };

/** Reiner Teil: aus einer Antwort (oder einem Abruffehler) einen Pruefdurchlauf bauen. */
export function buildRun(t: Thesis, response: FactsResponse | { ok: false; message: string }, at: string, today: string, id: string): AutoCheckRun {
  const v = current(t);
  if (!response.ok) return { id, at, thesisVersion: v.version, fetch: { ok: false, error: response.message }, results: [] };
  return {
    id, at, thesisVersion: v.version,
    fetch: {
      ok: true, fetchedAt: response.fetchedAt, stale: response.stale, staleReason: response.staleReason, sourceUrl: response.sourceUrl,
      entityName: response.facts.entityName, cik: response.facts.cik,
    },
    results: v.content.criteria.map((k) => evaluateCriterion(k, response.facts, today)),
  };
}

export async function fetchFacts(ticker: string, fetcher: typeof fetch = fetch): Promise<FactsResponse | { ok: false; message: string }> {
  try {
    const res = await fetcher(`/api/kennzahlen/${encodeURIComponent(ticker)}`, { cache: "no-store" });
    const body = (await res.json()) as FactsResponse;
    if (typeof body?.ok !== "boolean") return { ok: false, message: `Unerwartete Antwort (HTTP ${res.status}).` };
    return body;
  } catch {
    return { ok: false, message: "Die Website konnte die SEC-Daten nicht abrufen (Netzwerkfehler)." };
  }
}
