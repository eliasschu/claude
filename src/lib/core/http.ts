import type { FailureReason, SourceId } from "./meta.ts";

/**
 * Abruf fremder Quellen mit Zeitlimit, Wiederholung bei Netzfehlern, 429 und
 * 5xx, Drosselung je Quelle, Next-Datencache und Rueckgriff auf den letzten
 * guten Stand – dieser wird ausdruecklich als "veraltet" markiert.
 * Es gibt keinen stillen Rueckgriff auf Ersatz- oder Demowerte.
 */

export class SourceError extends Error {
  readonly sourceId: SourceId;
  readonly reason: FailureReason;
  readonly status?: number;

  constructor(sourceId: SourceId, reason: FailureReason, message: string, status?: number) {
    super(message);
    this.name = "SourceError";
    this.sourceId = sourceId;
    this.reason = reason;
    this.status = status;
  }
}

export interface FetchedValue<T> {
  value: T;
  /** Zeitpunkt der Antwort laut Quelle (Date-Header), sonst Abrufzeit. */
  fetchedAt: string;
  stale: boolean;
  staleReason?: string;
}

interface FetchOptions<T> {
  sourceId: SourceId;
  url: string;
  headers?: Record<string, string>;
  /** Sekunden im Next-Datencache. */
  revalidate: number;
  timeoutMs?: number;
  retries?: number;
  /** Wie lange ein letzter guter Stand bei Ausfall noch gezeigt werden darf. */
  maxStaleMs?: number;
  parse: (response: Response) => Promise<T>;
  /** Mindestabstand zwischen zwei Abrufen derselben Quelle (Abruflimits). */
  minIntervalMs?: number;
  noStore?: boolean;
}

const lastGood = new Map<string, { value: unknown; fetchedAt: string; storedAt: number }>();
const nextSlot = new Map<SourceId, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle(sourceId: SourceId, minIntervalMs: number) {
  if (minIntervalMs <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(sourceId) ?? 0);
  nextSlot.set(sourceId, slot + minIntervalMs);
  if (slot > now) await sleep(slot - now);
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export async function fetchSource<T>(options: FetchOptions<T>): Promise<FetchedValue<T>> {
  const {
    sourceId, url, headers, revalidate, timeoutMs = 10_000, retries = 2,
    maxStaleMs = 24 * 3600 * 1000, parse, minIntervalMs = 0, noStore = false,
  } = options;

  let lastError: SourceError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await throttle(sourceId, minIntervalMs);
      const init: RequestInit & { next?: { revalidate: number } } = {
        headers: { Accept: "application/json, text/xml, application/xml, text/csv, */*", ...headers },
        signal: controller.signal,
      };
      if (noStore) init.cache = "no-store";
      else init.next = { revalidate };

      const response = await fetch(url, init);

      if (response.status === 404) throw new SourceError(sourceId, "not_found", "Eintrag nicht gefunden", 404);
      if (response.status === 401 || response.status === 403) {
        throw new SourceError(sourceId, "not_configured", `Zugriff verweigert (${response.status})`, response.status);
      }
      if (response.status === 429 || response.status >= 500) {
        const wait = response.status === 429 ? retryAfterMs(response) : null;
        lastError = new SourceError(sourceId, response.status === 429 ? "rate_limited" : "unavailable",
          `Quelle antwortete mit ${response.status}`, response.status);
        if (attempt < retries) {
          await sleep(Math.min(wait ?? 600 * 2 ** attempt, 5000));
          continue;
        }
        break;
      }
      if (!response.ok) throw new SourceError(sourceId, "unavailable", `Quelle antwortete mit ${response.status}`, response.status);

      let value: T;
      try {
        value = await parse(response);
      } catch (parseError) {
        if (parseError instanceof SourceError) throw parseError;
        throw new SourceError(sourceId, "invalid", "Antwort der Quelle war unvollständig oder ungültig");
      }

      const dateHeader = response.headers.get("date");
      const fetchedAt = dateHeader && !Number.isNaN(Date.parse(dateHeader))
        ? new Date(dateHeader).toISOString()
        : new Date().toISOString();
      lastGood.set(url, { value, fetchedAt, storedAt: Date.now() });
      return { value, fetchedAt, stale: false };
    } catch (error) {
      if (error instanceof SourceError) {
        if (error.reason === "not_found" || error.reason === "not_configured" || error.reason === "invalid") throw error;
        lastError = error;
      } else {
        const aborted = error instanceof Error && error.name === "AbortError";
        lastError = new SourceError(sourceId, "unavailable", aborted ? "Zeitlimit überschritten" : "Netzwerkfehler");
      }
      if (attempt < retries) await sleep(600 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  const cached = lastGood.get(url);
  if (cached && Date.now() - cached.storedAt <= maxStaleMs) {
    return {
      value: cached.value as T,
      fetchedAt: cached.fetchedAt,
      stale: true,
      staleReason: `Letzter erfolgreicher Abruf wird angezeigt – ${lastError?.message ?? "Quelle nicht erreichbar"}.`,
    };
  }
  throw lastError ?? new SourceError(sourceId, "unavailable", "Quelle nicht erreichbar");
}

export const parseJson = <T>(response: Response): Promise<T> => response.json() as Promise<T>;
export const parseText = (response: Response): Promise<string> => response.text();

/** Nur fuer Tests. */
export function __resetHttpState() {
  lastGood.clear();
  nextSlot.clear();
}
