/**
 * Serverseitiger Client fuer die interne Bot-API (services/quant).
 *
 * Rechtlicher Entwicklungsmodus: Die Daten sind INTERN (Research/Paper).
 * Dieser Client darf nur in Server Components oder Route Handlern laufen,
 * das Token gelangt nie in den Browser. Es gibt bewusst keine schreibenden
 * Aufrufe.
 */

import { assertServer, env } from "../core/env.ts";

export type BotDecision = "LONG_CANDIDATE" | "SHORT_CANDIDATE" | "WATCH" | "NO_TRADE" | "REJECTED_BY_RISK";

export interface BotMeta {
  audience: "internal";
  mode: "research" | "paper";
  disclaimer: string;
  signal_strength_note: string;
  bot_version: string;
  generated_at: string;
}

export interface Envelope<T> { data: T; meta: BotMeta }

export interface Evidence { key: string; text: string; features: string[]; points: number | null }

export interface SignalRow {
  signal_id: string; created_at: string; instrument_id: string; instrument_name: string;
  strategy_id: string; strategy_version: string; direction: "long" | "short" | "none"; decision: BotDecision;
  /** 0–100, keine Wahrscheinlichkeit. */
  signal_strength: string; price_at_signal: number | null; price_basis: string | null;
  time_horizon: "intraday" | "swing" | "position"; regime_labels: string[]; summary: string | null;
}

export interface SignalDetail {
  signal: SignalRow & {
    positive_evidence: Evidence[]; negative_evidence: Evidence[];
    invalidation: { rule: string | null; level?: number | null; text: string };
    exit_plan: { stop_price?: number; target_price?: number | null; max_holding_hours?: number; text?: string };
    risk_assessment: { approved: boolean; checks: { name: string; passed: boolean; detail: string }[]; reasons: string[] };
    market_regime: { scope: string; labels: string[]; explanation: string };
    data_sources: { source_id: string }[];
    data_freshness: Record<string, unknown>;
    feature_version: string; model_version: string; risk_version: string; content_hash: string;
  };
  outcomes: { horizon: string; return_pct: number; mfe_pct: number | null; mae_pct: number | null; result: string | null }[];
  features: Record<string, unknown> | null;
}

export interface BotEvent {
  event_id: number; created_at: string; event_type: string;
  severity: "debug" | "info" | "notice" | "warning" | "error" | "critical";
  instrument_id: string | null; signal_id: string | null; message: string;
}

export interface BotStatus {
  online: boolean;
  cycles: { scope: string; started_at: string; finished_at: string | null; status: string; counts: Record<string, number> | null }[];
  regimes: { scope: string; as_of: string; labels: string[]; explanation: string }[];
  current_decisions: Partial<Record<BotDecision, number>>;
  universe_monitored: { crypto?: number; equity?: number };
  last_data_update: string | null;
  last_kill_switch: { created_at: string; message: string } | null;
}

export type BotResult<T> = { ok: true; value: Envelope<T> } | { ok: false; message: string };

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function botGet<T>(path: string, fetcher: Fetcher = fetch): Promise<BotResult<T>> {
  assertServer("Bot-API-Client");
  const base = env.botApiUrl();
  const token = env.botApiToken();
  if (!base || !token) return { ok: false, message: "Bot-API ist nicht eingerichtet (BOT_API_URL, BOT_API_TOKEN)." };
  try {
    const response = await fetcher(`${base.replace(/\/$/, "")}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ok: false, message: `Bot-API antwortete mit ${response.status}` };
    return { ok: true, value: (await response.json()) as Envelope<T> };
  } catch {
    return { ok: false, message: "Bot-API nicht erreichbar" };
  }
}

export const bot = {
  status: (f?: Fetcher) => botGet<BotStatus>("/bot/status", f),
  events: (limit = 100, f?: Fetcher) => botGet<BotEvent[]>(`/bot/events?limit=${limit}`, f),
  signals: (params: { decision?: BotDecision; limit?: number } = {}, f?: Fetcher) => {
    const q = new URLSearchParams();
    if (params.decision) q.set("decision", params.decision);
    q.set("limit", String(params.limit ?? 100));
    return botGet<SignalRow[]>(`/signals?${q}`, f);
  },
  signal: (id: string, f?: Fetcher) => botGet<SignalDetail>(`/signals/${encodeURIComponent(id)}`, f),
};
