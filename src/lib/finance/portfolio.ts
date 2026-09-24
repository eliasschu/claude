/**
 * Portfolio-Rechenlogik (rein, ohne Speicher). Fehlende Angaben bleiben
 * fehlend und werden nie als 0 behandelt. Waehrungen werden nicht vermischt.
 */

export type InstrumentKind = "stock" | "crypto";

export interface PortfolioInstrument {
  kind: InstrumentKind;
  /** stock: Ticker; crypto: CoinGecko-Kennung. */
  key: string;
  symbol: string;
  name: string;
  currency: string;
  exchange?: string | null;
}

export interface Lot { id: string; quantity: number | null; price: number | null; addedAt: string; note?: string }
export interface Position { id: string; instrument: PortfolioInstrument; lots: Lot[] }

export interface ParsedNumber { ok: boolean; value: number | null; error?: string }

/**
 * Deutsches Zahlenformat: Komma trennt Dezimalstellen, Punkt Tausender.
 * Leere Eingabe ist erlaubt und bedeutet "Angabe fehlt" (null), nicht 0.
 */
export function parseGermanNumber(input: string, maxDecimals = 8): ParsedNumber {
  const s = input.trim().replace(/[\s\u00a0]/g, "");
  if (s === "") return { ok: true, value: null };
  if (s.startsWith("-")) return { ok: false, value: null, error: "Negative Werte sind nicht möglich." };
  let normalized: string;
  if (s.includes(",")) {
    if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(s)) return { ok: false, value: null, error: "Ungültiges Zahlenformat." };
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, "");
  else if (/^\d+(\.\d+)?$/.test(s)) normalized = s;
  else return { ok: false, value: null, error: "Ungültiges Zahlenformat." };

  if ((normalized.split(".")[1]?.length ?? 0) > maxDecimals) {
    return { ok: false, value: null, error: `Höchstens ${maxDecimals} Nachkommastellen.` };
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, value: null, error: "Ungültige Zahl." };
  if (value === 0) return { ok: false, value: null, error: "Der Wert muss größer als 0 sein." };
  return { ok: true, value };
}

export interface PositionSummary {
  quantity: number | null;
  quantityIncomplete: boolean;
  averagePrice: number | null;
  invested: number | null;
  investedIncomplete: boolean;
  currentValue: number | null;
  profit: number | null;
  profitPct: number | null;
  /** Was fehlt, damit Gewinn und Verlust berechenbar waeren. */
  missing: string[];
}

export function summarizePosition(position: Position, currentPrice: number | null): PositionSummary {
  const lots = position.lots;
  const withQty = lots.filter((l) => l.quantity !== null);
  const withBoth = lots.filter((l) => l.quantity !== null && l.price !== null);
  const quantity = withQty.length ? withQty.reduce((s, l) => s + l.quantity!, 0) : null;
  const quantityIncomplete = withQty.length < lots.length;
  const invested = withBoth.length ? withBoth.reduce((s, l) => s + l.quantity! * l.price!, 0) : null;
  const qtyWithPrice = withBoth.reduce((s, l) => s + l.quantity!, 0);

  const missing: string[] = [];
  if (quantity === null || quantityIncomplete) missing.push("Stückzahl");
  if (withBoth.length < lots.length) missing.push("Kaufpreis");
  if (currentPrice === null) missing.push("aktueller Kurs");

  const currentValue = quantity !== null && !quantityIncomplete && currentPrice !== null ? quantity * currentPrice : null;
  const complete = missing.length === 0 && invested !== null && currentValue !== null;
  const profit = complete ? currentValue! - invested! : null;

  return {
    quantity, quantityIncomplete,
    averagePrice: withBoth.length && qtyWithPrice > 0 ? invested! / qtyWithPrice : null,
    invested,
    investedIncomplete: withBoth.length < lots.length,
    currentValue, profit,
    profitPct: complete && invested! > 0 ? (profit! / invested!) * 100 : null,
    missing,
  };
}

export interface CurrencyTotal {
  currency: string; invested: number; currentValue: number; profit: number;
  /** Anzahl vollstaendig berechenbarer Positionen. */
  counted: number;
  /** Positionen dieser Waehrung, die mangels Angaben fehlen. */
  excluded: number;
}

export function totalsByCurrency(items: { position: Position; summary: PositionSummary }[]): CurrencyTotal[] {
  const map = new Map<string, CurrencyTotal>();
  for (const { position, summary } of items) {
    const ccy = position.instrument.currency;
    const t = map.get(ccy) ?? { currency: ccy, invested: 0, currentValue: 0, profit: 0, counted: 0, excluded: 0 };
    if (summary.profit !== null && summary.invested !== null && summary.currentValue !== null) {
      t.invested += summary.invested;
      t.currentValue += summary.currentValue;
      t.profit += summary.profit;
      t.counted += 1;
    } else t.excluded += 1;
    map.set(ccy, t);
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface ConcentrationEntry { label: string; sharePct: number; positions: string[] }

/**
 * Klumpenrisiko: Anteil je Gruppe (Branche, Land, Anlageart) an der Summe der
 * bewertbaren Positionen einer Waehrung. Nicht bewertbare Positionen bleiben aussen vor.
 */
export function concentration(
  items: { position: Position; summary: PositionSummary; group: string | null }[],
  currency: string,
): { entries: ConcentrationEntry[]; coveredPositions: number; ignoredPositions: number } {
  const usable = items.filter((i) => i.position.instrument.currency === currency && i.summary.currentValue !== null);
  const total = usable.reduce((s, i) => s + i.summary.currentValue!, 0);
  const map = new Map<string, { value: number; positions: string[] }>();
  for (const i of usable) {
    const label = i.group ?? "Ohne Zuordnung";
    const entry = map.get(label) ?? { value: 0, positions: [] };
    entry.value += i.summary.currentValue!;
    entry.positions.push(i.position.instrument.name);
    map.set(label, entry);
  }
  const entries = total > 0
    ? [...map.entries()].map(([label, v]) => ({ label, sharePct: (v.value / total) * 100, positions: v.positions }))
        .sort((a, b) => b.sharePct - a.sharePct)
    : [];
  return {
    entries,
    coveredPositions: usable.length,
    ignoredPositions: items.filter((i) => i.position.instrument.currency === currency).length - usable.length,
  };
}

/** Liest gespeicherte Positionen defensiv; beschaedigte Eintraege werden verworfen. */
export function sanitizeStoredPortfolio(raw: unknown): Position[] {
  if (!Array.isArray(raw)) return [];
  const out: Position[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    const inst = p?.instrument as Record<string, unknown> | undefined;
    if (!inst || (inst.kind !== "stock" && inst.kind !== "crypto") || typeof inst.key !== "string" || typeof inst.currency !== "string") continue;
    const lots = (Array.isArray(p.lots) ? (p.lots as Record<string, unknown>[]) : [])
      .map((l, i) => ({
        id: typeof l.id === "string" ? l.id : `lot-${i}`,
        quantity: typeof l.quantity === "number" && l.quantity > 0 ? l.quantity : null,
        price: typeof l.price === "number" && l.price > 0 ? l.price : null,
        addedAt: typeof l.addedAt === "string" ? l.addedAt : new Date(0).toISOString(),
        note: typeof l.note === "string" ? l.note.slice(0, 500) : undefined,
      }))
      .slice(0, 200);
    if (lots.length === 0) continue;
    out.push({
      id: typeof p.id === "string" ? p.id : `${inst.kind}:${inst.key}`,
      instrument: {
        kind: inst.kind,
        key: inst.key,
        symbol: String(inst.symbol ?? inst.key),
        name: String(inst.name ?? inst.key),
        currency: inst.currency,
        exchange: typeof inst.exchange === "string" ? inst.exchange : null,
      },
      lots,
    });
  }
  return out;
}
