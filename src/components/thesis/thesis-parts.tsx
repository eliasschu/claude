"use client";

import { useState } from "react";
import {
  ASSESSMENT_LABEL, OUTCOME_LABEL, current, describeCriterion, diffVersions, latestAssessments, reviewState,
  type ManualAssessment, type ReviewOutcome, type Thesis,
} from "@/lib/thesis/model";
import { Chip } from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/finance/format";
import { cn } from "@/lib/utils";

const input = "w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-accent";

/** Hinweis zur lokalen Speicherung - erscheint ueberall, wo Thesen angelegt oder verwaltet werden. */
export function StorageNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p className={cn("rounded-[10px] border border-line bg-surface-2 px-3 py-2 leading-relaxed text-muted", compact ? "text-[11px]" : "text-[12px]")}>
      Deine Thesen liegen <strong className="text-ink">nur in diesem Browser</strong> auf diesem Gerät. Wer die Browserdaten löscht,
      einen anderen Browser nutzt oder im privaten Fenster arbeitet, sieht sie nicht oder verliert sie. Sichere sie deshalb regelmäßig
      über den Export unter „Meine Thesen“. Es gibt kein Konto und keinen Zugriffsschutz, und die Einträge sind nicht manipulationssicher.
      Nichts davon wird an einen Server oder Dienst übertragen.
    </p>
  );
}

function DueChip({ t, today }: { t: Thesis; today: string }) {
  const s = reviewState(t, today);
  if (t.lifecycle === "archiviert") return <Chip tone="neutral">archiviert</Chip>;
  if (!s.nextReviewDate) return <Chip tone="neutral">kein Prüftermin</Chip>;
  if (s.due) return <Chip tone="warn">Prüfung fällig{s.daysOverdue > 0 ? ` seit ${s.daysOverdue} ${s.daysOverdue === 1 ? "Tag" : "Tagen"}` : " heute"}</Chip>;
  return <Chip tone="neutral">nächste Prüfung {formatDate(s.nextReviewDate)}</Chip>;
}

export { DueChip };

function Text({ title, value }: { title: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</p>
      <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed">{value}</p>
    </div>
  );
}

/**
 * Aktueller Stand einer These. Bewusst KEIN Gesamturteil wie "These intakt": Manuelle Einschaetzungen,
 * faellige Pruefung und fehlende automatische Pruefung stehen getrennt nebeneinander.
 */
export function ThesisView({ t, today }: { t: Thesis; today: string }) {
  const v = current(t);
  const c = v.content;
  const manual = latestAssessments(t);
  const state = reviewState(t, today);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="accent">{c.stance === "besitzen" ? "Ich besitze" : "Ich beobachte"}</Chip>
        <DueChip t={t} today={today} />
        <span className="text-[11px] text-faint">Version {v.version} vom {formatDateTime(v.savedAt)} · angelegt {formatDate(t.createdAt)}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Text title="Grund" value={c.reason} />
        <Text title="Erwartete Entwicklung" value={c.expectations} />
        <Text title="Gegenargumente" value={c.counterArguments} />
        <Text title="Was mich umstimmen würde" value={c.changeMyMind} />
      </div>
      <p className="text-[12px] text-muted">
        Zeithorizont: {c.horizonMonths ? `${c.horizonMonths} Monate` : "nicht festgelegt"}
        {state.lastReview ? ` · letzte Prüfung ${formatDate(state.lastReview.at)} (${OUTCOME_LABEL[state.lastReview.outcome]})` : " · noch keine Prüfung dokumentiert"}
      </p>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Messbare Widerlegungskriterien</p>
        {c.criteria.length === 0 ? <p className="mt-1 text-[13px] text-muted">Keine festgelegt.</p> : (
          <ul className="mt-1 space-y-1.5">
            {c.criteria.map((k) => {
              const m = manual.get(k.id);
              return (
                <li key={k.id} className="rounded-[10px] border border-line px-3 py-2 text-[13px]">
                  <p className="font-semibold">{describeCriterion(k)}</p>
                  <p className="mt-0.5 text-[11px] text-faint">Automatische Prüfung noch nicht verfügbar.</p>
                  <p className="mt-0.5 text-[11px]">
                    {m ? <>Manuell bewertet am {formatDate(m.at)}: <strong>{ASSESSMENT_LABEL[m.assessment]}</strong></> : <span className="text-faint">Noch nicht manuell bewertet.</span>}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Freie Prüfpunkte (manuell)</p>
        {c.checkpoints.length === 0 ? <p className="mt-1 text-[13px] text-muted">Keine festgelegt.</p> : (
          <ul className="mt-1 space-y-1.5">
            {c.checkpoints.map((k) => {
              const m = manual.get(k.id);
              return (
                <li key={k.id} className="rounded-[10px] border border-line px-3 py-2 text-[13px]">
                  <p>{k.text}</p>
                  <p className="mt-0.5 text-[11px]">
                    {m ? <>Manuell bewertet am {formatDate(m.at)}: <strong>{ASSESSMENT_LABEL[m.assessment]}</strong></> : <span className="text-faint">Noch nicht bewertet.</span>}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Eine manuelle Pruefung dokumentieren - eigener datierter Eintrag, aendert die These nicht. */
export function ReviewForm({ t, onSubmit, onCancel }: {
  t: Thesis;
  onSubmit: (r: { outcome: ReviewOutcome; note: string; assessments: { targetId: string; assessment: ManualAssessment }[]; nextReviewDate: string | null }) => string | null;
  onCancel: () => void;
}) {
  const c = current(t).content;
  const targets = [...c.criteria.map((k) => ({ id: k.id, text: describeCriterion(k) })), ...c.checkpoints.map((k) => ({ id: k.id, text: k.text }))];
  const [outcome, setOutcome] = useState<ReviewOutcome>("beibehalten");
  const [note, setNote] = useState("");
  const [next, setNext] = useState("");
  const [values, setValues] = useState<Record<string, ManualAssessment | "">>({});
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const assessments = Object.entries(values).filter(([, a]) => a !== "").map(([targetId, a]) => ({ targetId, assessment: a as ManualAssessment }));
    setError(onSubmit({ outcome, note, assessments, nextReviewDate: next || null }));
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-[12px] text-muted">Die Prüfung wird mit Datum gespeichert und ändert den Inhalt der These nicht. Willst du die These anpassen, speichere danach eine neue Version.</p>
      {targets.length ? (
        <ul className="space-y-2">
          {targets.map((x) => (
            <li key={x.id} className="rounded-[10px] border border-line p-3">
              <p className="text-[13px]">{x.text}</p>
              <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Einschätzung: ${x.text}`}>
                {(["", "nicht_eingetreten", "eingetreten", "unklar"] as const).map((a) => (
                  <label key={a || "leer"} className={cn("cursor-pointer rounded-[8px] border px-2.5 py-1 text-[12px]",
                    (values[x.id] ?? "") === a ? "border-accent bg-accent-soft text-accent" : "border-line")}>
                    <input type="radio" className="sr-only" name={`a-${x.id}`} checked={(values[x.id] ?? "") === a}
                      onChange={() => setValues((v) => ({ ...v, [x.id]: a }))} />
                    {a === "" ? "nicht bewertet" : ASSESSMENT_LABEL[a]}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="block text-[12px] font-semibold text-muted">Ergebnis
        <select className={cn(input, "mt-1")} value={outcome} onChange={(e) => setOutcome(e.target.value as ReviewOutcome)}>
          {(Object.keys(OUTCOME_LABEL) as ReviewOutcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
        </select>
      </label>
      <label className="block text-[12px] font-semibold text-muted">Begründung *
        <textarea rows={3} className={cn(input, "mt-1")} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="block text-[12px] font-semibold text-muted">Nächste Prüfung
        <input type="date" className={cn(input, "mt-1")} value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      {error ? <p role="alert" className="rounded-[10px] border border-neg/30 bg-neg-soft px-3 py-2 text-[12px]">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="h-10 rounded-[10px] bg-accent px-4 text-[13px] font-bold text-accent-ink">Prüfung speichern</button>
        <button type="button" onClick={onCancel} className="h-10 rounded-[10px] border border-line px-4 text-[13px] font-semibold">Abbrechen</button>
      </div>
    </form>
  );
}

/** Versionen und Pruefungen chronologisch, mit Vergleich zweier Versionen. */
export function History({ t }: { t: Thesis }) {
  const [a, setA] = useState(Math.max(1, t.versions.length - 1));
  const [b, setB] = useState(t.versions.length);
  const va = t.versions[a - 1], vb = t.versions[b - 1];
  const changes = va && vb && a !== b ? diffVersions(va, vb) : [];
  const events = [
    ...t.versions.map((v) => ({ at: v.savedAt, text: `Version ${v.version}: ${v.reason}` })),
    ...t.reviews.map((r) => ({ at: r.at, text: `Prüfung zu Version ${r.version}: ${OUTCOME_LABEL[r.outcome]} – ${r.note}` })),
    ...t.lifecycleEvents.map((e) => ({ at: e.at, text: `${e.to === "archiviert" ? "Archiviert" : "Wieder aktiviert"}: ${e.reason}` })),
    ...(t.importedFrom ? [{ at: t.importedFrom.at, text: `Als Kopie importiert (Original-ID ${t.importedFrom.originalId})` }] : []),
  ].sort((x, y) => y.at.localeCompare(x.at));

  return (
    <div className="space-y-4">
      <ol className="space-y-1.5 text-[12px]">
        {events.map((e) => (
          <li key={`${e.at}-${e.text}`} className="flex gap-2"><span className="num w-[118px] shrink-0 text-faint">{formatDateTime(e.at)}</span><span>{e.text}</span></li>
        ))}
      </ol>
      {t.versions.length > 1 ? (
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-semibold">Vergleichen:</span>
            <select aria-label="Ältere Version" className="rounded-[8px] border border-line bg-surface px-2 py-1" value={a} onChange={(e) => setA(Number(e.target.value))}>
              {t.versions.map((v) => <option key={v.version} value={v.version}>Version {v.version}</option>)}
            </select>
            <span>mit</span>
            <select aria-label="Neuere Version" className="rounded-[8px] border border-line bg-surface px-2 py-1" value={b} onChange={(e) => setB(Number(e.target.value))}>
              {t.versions.map((v) => <option key={v.version} value={v.version}>Version {v.version}</option>)}
            </select>
          </div>
          {a === b ? <p className="mt-2 text-[12px] text-faint">Zwei verschiedene Versionen wählen.</p> : changes.length === 0 ? (
            <p className="mt-2 text-[12px] text-faint">Keine Unterschiede in den vergleichbaren Feldern.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {changes.map((ch) => (
                <li key={ch.field} className="rounded-[10px] border border-line p-3 text-[12px]">
                  <p className="font-semibold">{ch.field}</p>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    <p className="whitespace-pre-line rounded-[8px] bg-neg-soft px-2 py-1"><span className="sr-only">Vorher: </span>{ch.before}</p>
                    <p className="whitespace-pre-line rounded-[8px] bg-pos-soft px-2 py-1"><span className="sr-only">Nachher: </span>{ch.after}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
