"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  METRICS, OPERATORS, PERIODS, validateContent, normalizeContent,
  type MeasurableCriterion, type MetricKey, type Operator, type Period, type ThesisContent,
} from "@/lib/thesis/model";
import { newId } from "@/lib/thesis/storage";
import { cn } from "@/lib/utils";

const input = "w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-accent";
const label = "block text-[12px] font-semibold text-muted";

function Field({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{title}</label>
      {hint ? <p className="mb-1 text-[11px] text-faint">{hint}</p> : null}
      <div className={hint ? "" : "mt-1"}>{children}</div>
    </div>
  );
}

export const emptyContent = (ticker: string, companyName: string): ThesisContent => ({
  ticker, companyName, stance: "beobachten", reason: "", expectations: "", counterArguments: "", changeMyMind: "",
  horizonMonths: null, nextReviewDate: null, criteria: [], checkpoints: [],
});

/**
 * Anlegen oder Bearbeiten einer These. Beim Bearbeiten ist ein Aenderungsgrund Pflicht - daraus entsteht
 * eine neue Version; die bisherige bleibt unveraendert erhalten.
 */
export function ThesisForm({ initial, mode, onSubmit, onCancel }: {
  initial: ThesisContent;
  mode: "neu" | "bearbeiten";
  onSubmit: (content: ThesisContent, reason: string) => string | null;
  onCancel: () => void;
}) {
  const [c, setC] = useState<ThesisContent>(initial);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const set = <K extends keyof ThesisContent>(k: K, v: ThesisContent[K]) => setC((x) => ({ ...x, [k]: v }));
  const setCrit = (id: string, patch: Partial<MeasurableCriterion>) =>
    set("criteria", c.criteria.map((k) => (k.id === id ? { ...k, ...patch } : k)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const problems = validateContent(normalizeContent(c));
    if (mode === "bearbeiten" && !reason.trim()) problems.push("Bitte einen Änderungsgrund angeben.");
    if (problems.length) { setErrors(problems); return; }
    const err = onSubmit(c, reason);
    setErrors(err ? [err] : []);
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset>
        <legend className="mb-2 text-[13px] font-bold">1 · Warum dieses Unternehmen?</legend>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Haltung">
            {(["beobachten", "besitzen"] as const).map((s) => (
              <label key={s} className={cn("cursor-pointer rounded-[10px] border px-3 py-2 text-[13px] font-semibold",
                c.stance === s ? "border-accent bg-accent-soft text-accent" : "border-line")}>
                <input type="radio" name="stance" value={s} checked={c.stance === s} onChange={() => set("stance", s)} className="sr-only" />
                {s === "beobachten" ? "Ich beobachte" : "Ich besitze"}
              </label>
            ))}
          </div>
          <Field id="reason" title="Kauf- oder Beobachtungsgrund *">
            <textarea id="reason" rows={3} className={input} value={c.reason} onChange={(e) => set("reason", e.target.value)} />
          </Field>
          <Field id="expect" title="Welche Entwicklung erwarte ich?">
            <textarea id="expect" rows={2} className={input} value={c.expectations} onChange={(e) => set("expectations", e.target.value)} />
          </Field>
          <Field id="counter" title="Gegenargumente">
            <textarea id="counter" rows={2} className={input} value={c.counterArguments} onChange={(e) => set("counterArguments", e.target.value)} />
          </Field>
          <Field id="mind" title="Was würde mich umstimmen?">
            <textarea id="mind" rows={2} className={input} value={c.changeMyMind} onChange={(e) => set("changeMyMind", e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-[13px] font-bold">2 · Messbare Widerlegungskriterien</legend>
        <p className="mb-2 text-[11px] leading-relaxed text-faint">
          Wann wäre die These aus deiner Sicht widerlegt? Die automatische Prüfung gegen Geschäftszahlen kommt in einer späteren
          Etappe. Bis dahin bewertest du die Kriterien bei jeder Prüfung selbst.
        </p>
        <ul className="space-y-2">
          {c.criteria.map((k, i) => (
            <li key={k.id} className="rounded-[12px] border border-line p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
                <label className="col-span-2 text-[11px] text-faint sm:col-span-1">Kennzahl
                  <select className={cn(input, "mt-0.5")} value={k.metric} onChange={(e) => setCrit(k.id, { metric: e.target.value as MetricKey })}>
                    {(Object.keys(METRICS) as MetricKey[]).map((m) => <option key={m} value={m}>{METRICS[m].label}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-faint">Vergleich
                  <select className={cn(input, "mt-0.5")} value={k.operator} onChange={(e) => setCrit(k.id, { operator: e.target.value as Operator })}>
                    {(Object.keys(OPERATORS) as Operator[]).map((o) => <option key={o} value={o}>{OPERATORS[o]}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-faint">Schwelle ({METRICS[k.metric].unit})
                  <input type="number" step="any" inputMode="decimal" className={cn(input, "mt-0.5")} value={Number.isFinite(k.threshold) ? k.threshold : ""}
                    onChange={(e) => setCrit(k.id, { threshold: e.target.value === "" ? Number.NaN : Number(e.target.value) })} />
                </label>
                <label className="text-[11px] text-faint">Periode
                  <select className={cn(input, "mt-0.5")} value={k.period} onChange={(e) => setCrit(k.id, { period: e.target.value as Period })}>
                    {(Object.keys(PERIODS) as Period[]).map((p) => <option key={p} value={p}>{PERIODS[p]}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-faint">In Folge
                  <input type="number" min={1} max={8} step={1} className={cn(input, "mt-0.5")} value={k.consecutive}
                    onChange={(e) => setCrit(k.id, { consecutive: Number(e.target.value) })} />
                </label>
                <button type="button" onClick={() => set("criteria", c.criteria.filter((x) => x.id !== k.id))}
                  className="self-end justify-self-end rounded-[8px] p-2 text-faint hover:text-neg" aria-label={`Kriterium ${i + 1} entfernen`}>
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
              <p className="mt-1 text-[11px] text-faint">{METRICS[k.metric].explain}</p>
            </li>
          ))}
        </ul>
        <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent"
          onClick={() => set("criteria", [...c.criteria, { id: newId(), metric: "operating_margin", operator: "<", threshold: Number.NaN, period: "quartal", consecutive: 1 }])}>
          <Plus size={15} aria-hidden /> Kriterium hinzufügen
        </button>

        <p className="mt-4 text-[12px] font-semibold text-muted">Freie Prüfpunkte (manuell)</p>
        <ul className="mt-1 space-y-2">
          {c.checkpoints.map((k, i) => (
            <li key={k.id} className="flex gap-2">
              <input className={input} value={k.text} aria-label={`Prüfpunkt ${i + 1}`} placeholder="z. B. Neues Produkt kommt 2027 auf den Markt"
                onChange={(e) => set("checkpoints", c.checkpoints.map((x) => (x.id === k.id ? { ...x, text: e.target.value } : x)))} />
              <button type="button" onClick={() => set("checkpoints", c.checkpoints.filter((x) => x.id !== k.id))}
                className="rounded-[8px] p-2 text-faint hover:text-neg" aria-label={`Prüfpunkt ${i + 1} entfernen`}><Trash2 size={16} aria-hidden /></button>
            </li>
          ))}
        </ul>
        <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent"
          onClick={() => set("checkpoints", [...c.checkpoints, { id: newId(), text: "" }])}>
          <Plus size={15} aria-hidden /> Prüfpunkt hinzufügen
        </button>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[13px] font-bold">3 · Zeitraum und nächste Prüfung</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field id="horizon" title="Zeithorizont (Monate)">
            <input id="horizon" type="number" min={1} max={600} className={input} value={c.horizonMonths ?? ""}
              onChange={(e) => set("horizonMonths", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
          <Field id="review" title="Nächste Prüfung">
            <input id="review" type="date" className={input} value={c.nextReviewDate ?? ""} onChange={(e) => set("nextReviewDate", e.target.value || null)} />
          </Field>
        </div>
      </fieldset>

      {mode === "bearbeiten" ? (
        <Field id="change" title="Änderungsgrund * (wird mit der neuen Version gespeichert)">
          <input id="change" className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Neue Quartalszahlen, Einschätzung angepasst" />
        </Field>
      ) : null}

      {errors.length ? (
        <ul role="alert" className="rounded-[10px] border border-neg/30 bg-neg-soft px-3 py-2 text-[12px] text-ink">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="h-10 rounded-[10px] bg-accent px-4 text-[13px] font-bold text-accent-ink">
          {mode === "neu" ? "These speichern" : "Neue Version speichern"}
        </button>
        <button type="button" onClick={onCancel} className="h-10 rounded-[10px] border border-line px-4 text-[13px] font-semibold">Abbrechen</button>
      </div>
    </form>
  );
}
