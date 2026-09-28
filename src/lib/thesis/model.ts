/**
 * Investmentthesen-Tagebuch - Datenmodell und reine Funktionen (ohne Speicherzugriff, ohne Oberflaeche).
 *
 * Grundsaetze
 *  - Jede inhaltliche Aenderung ist eine NEUE Version mit Zeitpunkt und Pflicht-Begruendung; fruehere Versionen
 *    und das urspruengliche Erstellungsdatum bleiben erhalten.
 *  - Lebenszyklus (aktiv/archiviert) ist getrennt vom Pruefstatus (manuelle Pruefungen, Wiedervorlage).
 *  - Manuelle Pruefungen sind eigene, datierte Eintraege. Automatische Kennzahlpruefungen gibt es erst in Etappe D.
 *  - Nichts hier ist manipulationssicher: Die Daten liegen im Browser und koennen dort veraendert werden.
 */

export const THESIS_FORMAT = "der-junge-kapitalist.thesen";
export const THESIS_FORMAT_VERSION = 1;

/* ------------------------------------------------------------------ Kennzahlen fuer Widerlegungskriterien */

export type MetricKey = "operating_margin" | "revenue_growth_yoy" | "fcf_margin" | "free_cash_flow" | "revenue" | "net_debt_to_ocf";
export type Unit = "%" | "Mio. (Berichtswährung)" | "×";

export const METRICS: Record<MetricKey, { label: string; unit: Unit; explain: string }> = {
  operating_margin: { label: "Operative Marge", unit: "%", explain: "Operatives Ergebnis in Prozent des Umsatzes." },
  revenue_growth_yoy: { label: "Umsatzwachstum ggü. Vorjahresperiode", unit: "%", explain: "Veränderung des Umsatzes gegenüber derselben Periode des Vorjahres, relativ in Prozent." },
  fcf_margin: { label: "Freier Cashflow in % vom Umsatz", unit: "%", explain: "Operativer Cashflow minus Investitionen in Sachanlagen, in Prozent des Umsatzes." },
  free_cash_flow: { label: "Freier Cashflow", unit: "Mio. (Berichtswährung)", explain: "Operativer Cashflow minus Investitionen in Sachanlagen, in Millionen der Berichtswährung." },
  revenue: { label: "Umsatz", unit: "Mio. (Berichtswährung)", explain: "Umsatz in Millionen der Berichtswährung." },
  net_debt_to_ocf: { label: "Nettoverschuldung ÷ operativer Cashflow", unit: "×", explain: "Finanzschulden minus Zahlungsmittel, geteilt durch den operativen Cashflow." },
};

export type Operator = "<" | "<=" | ">" | ">=";
export const OPERATORS: Record<Operator, string> = { "<": "unter", "<=": "höchstens", ">": "über", ">=": "mindestens" };

export type Period = "quartal" | "jahr";
export const PERIODS: Record<Period, string> = { quartal: "Quartal", jahr: "Geschäftsjahr" };

export interface MeasurableCriterion {
  id: string;
  metric: MetricKey;
  operator: Operator;
  threshold: number;
  period: Period;
  /** Wie viele aufeinanderfolgende Perioden die Bedingung erfuellen muessen (1-8). Fehlende Perioden werden nie uebersprungen. */
  consecutive: number;
}

export interface ManualCheckpoint { id: string; text: string }

export type Stance = "beobachten" | "besitzen";

/** Inhalt einer These - das, was versioniert wird. */
export interface ThesisContent {
  ticker: string;
  companyName: string;
  stance: Stance;
  reason: string;
  expectations: string;
  counterArguments: string;
  changeMyMind: string;
  horizonMonths: number | null;
  /** YYYY-MM-DD oder null */
  nextReviewDate: string | null;
  criteria: MeasurableCriterion[];
  checkpoints: ManualCheckpoint[];
}

export interface ThesisVersion { version: number; savedAt: string; reason: string; content: ThesisContent }

export type ManualAssessment = "eingetreten" | "nicht_eingetreten" | "unklar";
export const ASSESSMENT_LABEL: Record<ManualAssessment, string> = {
  eingetreten: "eingetreten", nicht_eingetreten: "nicht eingetreten", unklar: "unklar",
};

export type ReviewOutcome = "beibehalten" | "anpassen" | "verwerfen";
export const OUTCOME_LABEL: Record<ReviewOutcome, string> = {
  beibehalten: "These beibehalten", anpassen: "These anpassen", verwerfen: "These verwerfen",
};

/** Eine dokumentierte manuelle Pruefung - eigener, datierter Eintrag, veraendert keine Version. */
export interface ReviewEntry {
  id: string;
  at: string;
  /** Version, auf die sich die Pruefung bezog */
  version: number;
  outcome: ReviewOutcome;
  note: string;
  /** Manuelle Einschaetzung je Kriterium bzw. Pruefpunkt (per ID) - ausdruecklich manuell, nicht automatisch geprueft */
  assessments: { targetId: string; assessment: ManualAssessment }[];
  /** Neue Wiedervorlage, gesetzt mit dieser Pruefung */
  nextReviewDate: string | null;
}

export type Lifecycle = "aktiv" | "archiviert";

export interface Thesis {
  id: string;
  createdAt: string;
  lifecycle: Lifecycle;
  lifecycleEvents: { at: string; to: Lifecycle; reason: string }[];
  versions: ThesisVersion[];
  reviews: ReviewEntry[];
  /** Nur bei Import als Kopie: Herkunft der These */
  importedFrom?: { originalId: string; at: string };
}

export interface ThesisStore { formatVersion: number; theses: Thesis[] }

export const emptyStore = (): ThesisStore => ({ formatVersion: THESIS_FORMAT_VERSION, theses: [] });

/* ------------------------------------------------------------------ Hilfen */

export class ThesisError extends Error {}

export const current = (t: Thesis): ThesisVersion => t.versions[t.versions.length - 1];

const trim = (s: string) => s.trim();

export function normalizeContent(c: ThesisContent): ThesisContent {
  return {
    ...c,
    ticker: c.ticker.trim().toUpperCase(),
    companyName: c.companyName.trim(),
    reason: trim(c.reason), expectations: trim(c.expectations), counterArguments: trim(c.counterArguments), changeMyMind: trim(c.changeMyMind),
    criteria: c.criteria.map((k) => ({ ...k })),
    checkpoints: c.checkpoints.map((k) => ({ ...k, text: k.text.trim() })).filter((k) => k.text !== ""),
  };
}

/** Pflichtangaben und Wertebereiche; Rueckgabe: Liste verstaendlicher Fehler (leer = gueltig). */
export function validateContent(c: ThesisContent): string[] {
  const e: string[] = [];
  if (!/^[A-Z0-9.\-]{1,12}$/.test(c.ticker)) e.push("Börsenkürzel fehlt oder ist ungültig.");
  if (!c.reason) e.push("Bitte den Kauf- oder Beobachtungsgrund angeben.");
  if (c.stance !== "beobachten" && c.stance !== "besitzen") e.push("Bitte angeben, ob du beobachtest oder besitzt.");
  if (c.horizonMonths !== null && (!Number.isInteger(c.horizonMonths) || c.horizonMonths < 1 || c.horizonMonths > 600)) {
    e.push("Zeithorizont: ganze Monate zwischen 1 und 600.");
  }
  if (c.nextReviewDate !== null && !isIsoDate(c.nextReviewDate)) e.push("Nächstes Prüfdatum ist kein gültiges Datum.");
  for (const k of c.criteria) {
    if (!(k.metric in METRICS)) e.push("Unbekannte Kennzahl in einem Kriterium.");
    if (!(k.operator in OPERATORS)) e.push("Unbekannter Vergleich in einem Kriterium.");
    if (!Number.isFinite(k.threshold)) e.push(`Schwellenwert für „${METRICS[k.metric]?.label ?? k.metric}“ fehlt.`);
    if (!(k.period in PERIODS)) e.push("Unbekannte Berichtsperiode in einem Kriterium.");
    if (!Number.isInteger(k.consecutive) || k.consecutive < 1 || k.consecutive > 8) e.push("Aufeinanderfolgende Perioden: 1 bis 8.");
  }
  for (const [label, v] of [["Grund", c.reason], ["Erwartungen", c.expectations], ["Gegenargumente", c.counterArguments], ["Was dich umstimmen würde", c.changeMyMind]] as const) {
    if (v.length > 5000) e.push(`${label}: höchstens 5000 Zeichen.`);
  }
  return e;
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
    && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

export const sameContent = (a: ThesisContent, b: ThesisContent) => stable(normalizeContent(a)) === stable(normalizeContent(b));

export function describeCriterion(k: MeasurableCriterion): string {
  const m = METRICS[k.metric];
  const value = `${String(k.threshold).replace(".", ",")} ${m.unit}`;
  const span = k.consecutive > 1 ? `in ${k.consecutive} aufeinanderfolgenden ${k.period === "quartal" ? "Quartalen" : "Geschäftsjahren"}` : `im ${PERIODS[k.period]}`;
  return `${m.label} ${OPERATORS[k.operator]} ${value} ${span}`;
}

/* ------------------------------------------------------------------ Aenderungen (liefern immer neue Objekte) */

export function createThesis(content: ThesisContent, now: string, id: string): Thesis {
  const c = normalizeContent(content);
  const errors = validateContent(c);
  if (errors.length) throw new ThesisError(errors.join(" "));
  return { id, createdAt: now, lifecycle: "aktiv", lifecycleEvents: [], versions: [{ version: 1, savedAt: now, reason: "Erstfassung", content: c }], reviews: [] };
}

export function saveVersion(t: Thesis, content: ThesisContent, reason: string, now: string): Thesis {
  const c = normalizeContent(content);
  if (!reason.trim()) throw new ThesisError("Bitte einen Änderungsgrund angeben.");
  const errors = validateContent(c);
  if (errors.length) throw new ThesisError(errors.join(" "));
  if (sameContent(current(t).content, c)) throw new ThesisError("Keine inhaltliche Änderung - es wird keine neue Version angelegt.");
  if (c.ticker !== current(t).content.ticker) throw new ThesisError("Das Unternehmen einer These kann nicht geändert werden. Lege dafür eine neue These an.");
  return { ...t, versions: [...t.versions, { version: current(t).version + 1, savedAt: now, reason: reason.trim(), content: c }] };
}

export function addReview(t: Thesis, review: Omit<ReviewEntry, "version">, now: string): Thesis {
  if (!review.note.trim()) throw new ThesisError("Bitte die Prüfung kurz begründen.");
  if (review.nextReviewDate !== null && !isIsoDate(review.nextReviewDate)) throw new ThesisError("Neues Prüfdatum ist ungültig.");
  const known = new Set([...current(t).content.criteria.map((k) => k.id), ...current(t).content.checkpoints.map((k) => k.id)]);
  if (review.assessments.some((a) => !known.has(a.targetId))) throw new ThesisError("Bewertung bezieht sich auf einen unbekannten Punkt.");
  return { ...t, reviews: [...t.reviews, { ...review, at: now, note: review.note.trim(), version: current(t).version }] };
}

export function setLifecycle(t: Thesis, to: Lifecycle, reason: string, now: string): Thesis {
  if (t.lifecycle === to) return t;
  if (!reason.trim()) throw new ThesisError("Bitte einen Grund angeben.");
  return { ...t, lifecycle: to, lifecycleEvents: [...t.lifecycleEvents, { at: now, to, reason: reason.trim() }] };
}

/* ------------------------------------------------------------------ Pruefstatus (ohne automatische Pruefung) */

export interface ReviewState {
  nextReviewDate: string | null;
  /** fällig = Datum erreicht; bei archivierten Thesen nie fällig */
  due: boolean;
  daysOverdue: number;
  lastReview: ReviewEntry | null;
}

/** Wirksame Wiedervorlage: die zuletzt gesetzte - aus der neuesten Version oder einer spaeteren Pruefung. */
export function reviewState(t: Thesis, today: string): ReviewState {
  const v = current(t);
  const lastReview = t.reviews.at(-1) ?? null;
  const next = lastReview && lastReview.at > v.savedAt ? lastReview.nextReviewDate : v.content.nextReviewDate;
  const days = next ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${next}T00:00:00Z`)) / 86400000) : 0;
  return { nextReviewDate: next, due: t.lifecycle === "aktiv" && next !== null && days >= 0, daysOverdue: Math.max(0, days), lastReview };
}

/** Letzte manuelle Einschaetzung je Kriterium/Pruefpunkt (mit Datum), getrennt von automatischen Pruefungen. */
export function latestAssessments(t: Thesis): Map<string, { assessment: ManualAssessment; at: string }> {
  const out = new Map<string, { assessment: ManualAssessment; at: string }>();
  for (const r of t.reviews) for (const a of r.assessments) out.set(a.targetId, { assessment: a.assessment, at: r.at });
  return out;
}

/* ------------------------------------------------------------------ Versionen vergleichen */

const FIELD_LABEL: Record<Exclude<keyof ThesisContent, "ticker" | "companyName">, string> = {
  stance: "Haltung", reason: "Kauf- bzw. Beobachtungsgrund", expectations: "Erwartete Entwicklung", counterArguments: "Gegenargumente",
  changeMyMind: "Was mich umstimmen würde", horizonMonths: "Zeithorizont (Monate)", nextReviewDate: "Nächste Prüfung",
  criteria: "Messbare Kriterien", checkpoints: "Manuelle Prüfpunkte",
};

export interface FieldChange { field: string; before: string; after: string }

function show(key: keyof ThesisContent, c: ThesisContent): string {
  if (key === "criteria") return c.criteria.map(describeCriterion).join("\n") || "–";
  if (key === "checkpoints") return c.checkpoints.map((k) => k.text).join("\n") || "–";
  const v = c[key];
  return v === null || v === "" ? "–" : String(v);
}

export function diffVersions(a: ThesisVersion, b: ThesisVersion): FieldChange[] {
  return (Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[])
    .map((k) => ({ field: FIELD_LABEL[k], before: show(k, a.content), after: show(k, b.content) }))
    .filter((c) => c.before !== c.after);
}

/* ------------------------------------------------------------------ Export, Import, Loeschen */

export function exportJson(store: ThesisStore, now: string): string {
  return JSON.stringify({ format: THESIS_FORMAT, formatVersion: THESIS_FORMAT_VERSION, exportedAt: now, theses: store.theses }, null, 2);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown, max = 5000): x is string => typeof x === "string" && x.length <= max;
const isTime = (x: unknown): x is string => typeof x === "string" && x.length <= 40 && !Number.isNaN(Date.parse(x));

function checkContent(c: unknown, where: string, errors: string[]): c is ThesisContent {
  if (!isObj(c)) { errors.push(`${where}: Inhalt fehlt.`); return false; }
  const needStr = ["ticker", "companyName", "reason", "expectations", "counterArguments", "changeMyMind"] as const;
  for (const k of needStr) if (!isStr(c[k])) errors.push(`${where}: Feld „${k}“ fehlt oder ist zu lang.`);
  if (!Array.isArray(c.criteria) || !Array.isArray(c.checkpoints)) { errors.push(`${where}: Kriterien oder Prüfpunkte fehlen.`); return false; }
  if (!(c.horizonMonths === null || typeof c.horizonMonths === "number")) errors.push(`${where}: Zeithorizont ungültig.`);
  if (!(c.nextReviewDate === null || typeof c.nextReviewDate === "string")) errors.push(`${where}: Prüfdatum ungültig.`);
  for (const k of c.criteria as unknown[]) if (!isObj(k) || !isStr(k.id, 100)) errors.push(`${where}: Kriterium ohne ID.`);
  for (const k of c.checkpoints as unknown[]) if (!isObj(k) || !isStr(k.id, 100) || !isStr(k.text)) errors.push(`${where}: Prüfpunkt ungültig.`);
  if (errors.length === 0) for (const e of validateContent(normalizeContent(c as unknown as ThesisContent))) errors.push(`${where}: ${e}`);
  return errors.length === 0;
}

/** Strenge Pruefung einer Exportdatei. Nichts wird ergaenzt oder repariert; ungueltige Dateien werden abgelehnt. */
export function parseImport(text: string): { ok: true; theses: Thesis[] } | { ok: false; errors: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, errors: ["Die Datei ist kein gültiges JSON."] }; }
  if (!isObj(raw) || raw.format !== THESIS_FORMAT) return { ok: false, errors: ["Das ist keine Thesen-Exportdatei dieser App."] };
  if (raw.formatVersion !== THESIS_FORMAT_VERSION) {
    return { ok: false, errors: [`Formatversion ${String(raw.formatVersion)} wird nicht unterstützt (erwartet: ${THESIS_FORMAT_VERSION}).`] };
  }
  if (!Array.isArray(raw.theses)) return { ok: false, errors: ["Die Liste der Thesen fehlt."] };
  const errors: string[] = [];
  const ids = new Set<string>();
  raw.theses.forEach((t: unknown, i: number) => {
    const where = `These ${i + 1}`;
    if (!isObj(t) || !isStr(t.id, 100) || !isTime(t.createdAt)) { errors.push(`${where}: ID oder Erstellungsdatum fehlt.`); return; }
    if (ids.has(t.id)) errors.push(`${where}: doppelte ID.`);
    ids.add(t.id);
    if (t.lifecycle !== "aktiv" && t.lifecycle !== "archiviert") errors.push(`${where}: Lebenszyklus ungültig.`);
    if (!Array.isArray(t.versions) || t.versions.length === 0) { errors.push(`${where}: keine Versionen.`); return; }
    if (!Array.isArray(t.reviews) || !Array.isArray(t.lifecycleEvents)) errors.push(`${where}: Prüfungen oder Statuswechsel fehlen.`);
    (t.versions as unknown[]).forEach((v, j) => {
      if (!isObj(v) || v.version !== j + 1 || !isTime(v.savedAt) || !isStr(v.reason, 1000) || !String(v.reason).trim()) {
        errors.push(`${where}, Version ${j + 1}: Nummer, Zeitpunkt oder Änderungsgrund ungültig.`);
      } else checkContent(v.content, `${where}, Version ${j + 1}`, errors);
    });
    for (const r of (Array.isArray(t.reviews) ? t.reviews : []) as unknown[]) {
      if (!isObj(r) || !isStr(r.id, 100) || !isTime(r.at) || !isStr(r.note) || !(String(r.outcome) in OUTCOME_LABEL) || !Array.isArray(r.assessments)) {
        errors.push(`${where}: eine Prüfung ist unvollständig.`);
      }
    }
  });
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, theses: raw.theses as Thesis[] };
}

export type ImportKind = "neu" | "identisch" | "erweitert" | "abweichend";
export interface ImportItem { incoming: Thesis; existing: Thesis | null; kind: ImportKind }

const history = (t: Thesis) => [...t.versions.map((v) => stable(v)), ...t.reviews.map((r) => stable(r)), ...t.lifecycleEvents.map((e) => stable(e))];

/**
 * Einordnung je importierter These:
 *  neu         ID unbekannt
 *  identisch   gleicher Verlauf - nichts zu tun
 *  erweitert   der Import enthaelt den lokalen Verlauf vollstaendig und zusaetzlich neuere Eintraege
 *  abweichend  beide Seiten haben unterschiedliche Eintraege - nie automatisch zusammenfuehren
 */
export function planImport(store: ThesisStore, incoming: Thesis[]): ImportItem[] {
  return incoming.map((t) => {
    const existing = store.theses.find((x) => x.id === t.id) ?? null;
    if (!existing) return { incoming: t, existing, kind: "neu" };
    const a = history(existing), b = history(t);
    if (stable(existing) === stable(t)) return { incoming: t, existing, kind: "identisch" };
    const bSet = new Set(b);
    const containsLocal = a.every((x) => bSet.has(x)) && existing.versions.every((v, i) => stable(t.versions[i]) === stable(v)) && existing.createdAt === t.createdAt;
    return { incoming: t, existing, kind: containsLocal && b.length > a.length ? "erweitert" : "abweichend" };
  });
}

/** Wahl je These: uebernehmen (nur neu/erweitert), als Kopie anlegen (neue ID) oder auslassen. Standard ist Auslassen. */
export type ImportChoice = "uebernehmen" | "kopie" | "auslassen";

export function applyImport(store: ThesisStore, plan: ImportItem[], choices: Record<string, ImportChoice>, now: string,
  newId: () => string): { store: ThesisStore; applied: number } {
  let theses = [...store.theses];
  let applied = 0;
  for (const item of plan) {
    const choice = choices[item.incoming.id] ?? "auslassen";
    if (choice === "auslassen" || item.kind === "identisch") continue;
    if (choice === "uebernehmen") {
      if (item.kind === "abweichend") throw new ThesisError("Abweichende Thesen werden nicht überschrieben - nur als Kopie importierbar.");
      theses = item.existing ? theses.map((x) => (x.id === item.incoming.id ? item.incoming : x)) : [...theses, item.incoming];
    } else {
      // Kopie mit neuer ID; Verlauf unveraendert, Herkunft vermerkt (keine kuenstliche Version)
      theses = [...theses, { ...item.incoming, id: newId(), importedFrom: { originalId: item.incoming.id, at: now } }];
    }
    applied += 1;
  }
  return { store: { ...store, theses }, applied };
}
