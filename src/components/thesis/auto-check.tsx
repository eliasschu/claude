"use client";

import { useState } from "react";
import { addAutoCheck, current, describeCriterion, latestAutoResults, lastAutoRun, ThesisError, type AutoCheckRun, type Thesis } from "@/lib/thesis/model";
import { AUTO_STATUS_LABEL, isDecided, periodText, supportedCount, SUPPORTED, type AutoStatus, type CriterionResult, type Evidence } from "@/lib/thesis/criteria-eval";
import { buildRun, fetchFacts } from "@/lib/thesis/auto-check";
import { newId, nowIso, todayLocal, updateThesis } from "@/lib/thesis/storage";
import { Chip } from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/finance/format";

const TONE: Record<AutoStatus, "neutral" | "neg" | "pos" | "warn"> = {
  ausgeloest: "neg", nicht_ausgeloest: "pos", unzureichende_daten: "warn", veraltete_daten: "warn", nicht_unterstuetzt: "neutral",
};

function age(iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 48) return `vor ${h} Std.`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

const mio = (n: number) => (n / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** Kopfzeile: Abdeckung, letzter Lauf, „Jetzt prüfen“. Prueft nur auf Klick - keine Hintergrundueberwachung. */
export function AutoCheckBar({ t }: { t: Thesis }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const criteria = current(t).content.criteria;
  if (criteria.length === 0) return null;
  const latest = latestAutoResults(t);
  const decided = criteria.filter((k) => { const r = latest.get(k.id); return r && !r.criterionChanged && isDecided(r.result); }).length;
  const supported = supportedCount(criteria);
  const last = lastAutoRun(t);

  async function run() {
    setRunning(true);
    setError(null);
    const ticker = current(t).content.ticker;
    const response = await fetchFacts(ticker);
    try {
      updateThesis(t.id, (fresh) => addAutoCheck(fresh, buildRun(fresh, response, nowIso(), todayLocal(), newId())));
    } catch (e) {
      setError(e instanceof ThesisError ? e.message : "Speichern im Browser fehlgeschlagen (Speicher voll oder gesperrt).");
    }
    setRunning(false);
  }

  return (
    <div className="space-y-1.5 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          {latest.size === 0 ? `${supported} von ${criteria.length} Kriterien grundsätzlich automatisch prüfbar`
            : `${decided} von ${criteria.length} Kriterien automatisch prüfbar`}
        </span>
        <button type="button" onClick={run} disabled={running}
          className="ml-auto h-8 rounded-[10px] border border-accent px-3 text-[12px] font-bold text-accent disabled:opacity-50">
          {running ? "Prüfe …" : "Jetzt prüfen"}
        </button>
      </div>
      <p className="text-muted">
        Geprüft wird nur, wenn du auf „Jetzt prüfen“ klickst - es gibt keine laufende Überwachung und keine Benachrichtigung.
        Dafür wird nur das Börsenkürzel an die SEC-Schnittstelle dieser Website gesendet, nie deine Thesentexte. Das Ergebnis
        ersetzt keine eigene Prüfung und ändert weder die These noch deine manuellen Bewertungen.
      </p>
      {last ? (
        <p className={last.fetch.ok ? "text-faint" : "text-neg"} role={last.fetch.ok ? undefined : "alert"}>
          {last.fetch.ok
            ? <>Letzte Prüfung {formatDateTime(last.at)} ({age(last.at)}) · SEC-Daten abgerufen {formatDateTime(last.fetch.fetchedAt)}{last.fetch.stale ? ` · ${last.fetch.staleReason ?? "älterer Abruf"}` : ""}</>
            : <>Letzter Versuch {formatDateTime(last.at)} fehlgeschlagen: {last.fetch.error.replace(/\.?$/, ".")}{latest.size > 0 ? " Unten stehen die Ergebnisse der letzten erfolgreichen Prüfung mit ihrem Alter." : ""}</>}
        </p>
      ) : <p className="text-faint">Noch nie automatisch geprüft.</p>}
      {error ? <p role="alert" className="text-neg">{error}</p> : null}
    </div>
  );
}

function EvidenceList({ items }: { items: Evidence[] }) {
  return (
    <ul className="space-y-1">
      {items.map((e, i) => (
        <li key={i} className="break-words">
          {e.quantity}: <span className="num">{mio(e.value)} Mio. {e.unit}</span> ({periodText(e)}) · Konzept <code className="text-[10px]">{e.concept}</code> ·{" "}
          <a href={e.url} target="_blank" rel="noreferrer" className="underline">{e.form} vom {formatDate(e.filed)}</a>
          {e.derivation ? <span className="block text-faint">Einzelquartal abgeleitet: {e.derivation}</span> : null}
          {e.revisedFrom?.length ? (
            <span className="block text-faint">
              Später angepasst - frühere Meldung{e.revisedFrom.length > 1 ? "en" : ""}: {e.revisedFrom.map((r) => `${mio(r.value)} Mio. (${r.form} vom ${formatDate(r.filed)})`).join(", ")}. Verwendet wird die zuletzt eingereichte.
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ResultDetails({ result, run }: { result: CriterionResult; run: AutoCheckRun }) {
  return (
    <details className="mt-1 text-[11px] text-muted">
      <summary className="cursor-pointer">Werte, Perioden und Quellen</summary>
      <div className="mt-1.5 space-y-2">
        {result.periods.map((p) => (
          <div key={`${p.start}|${p.end}`} className="rounded-[8px] border border-line px-2 py-1.5">
            <p className="font-semibold text-ink">
              {periodText(p)}: {p.value !== null ? `${p.value.toLocaleString("de-DE", { maximumFractionDigits: p.unit === "%" ? 1 : 0 })} ${p.unit}` : "nicht berechenbar"}
              {p.met === true ? " · Bedingung erfüllt" : p.met === false ? " · Bedingung nicht erfüllt" : ""}
            </p>
            {p.note ? <p>{p.note}</p> : null}
            <EvidenceList items={p.inputs} />
          </div>
        ))}
        <p>Berechnung: {result.calculation}</p>
        <p>
          Quelle: SEC EDGAR, XBRL Company Facts{run.fetch.ok && run.fetch.sourceUrl ? <> (<a href={run.fetch.sourceUrl} target="_blank" rel="noreferrer" className="underline">Rohdaten</a>)</> : null}
          {run.fetch.ok ? ` · ${run.fetch.entityName}` : ""} · Regelversion {result.evalVersion}
        </p>
      </div>
    </details>
  );
}

/** Ergebnis an einem Kriterium - getrennt von der manuellen Bewertung. */
export function AutoResult({ t, criterionId }: { t: Thesis; criterionId: string }) {
  const k = current(t).content.criteria.find((x) => x.id === criterionId);
  const entry = latestAutoResults(t).get(criterionId);
  if (!k) return null;
  if (!entry) {
    const reason = SUPPORTED[k.metric];
    return <p className="mt-0.5 text-[11px] text-faint">{reason ? `Automatisch nicht unterstützt: ${reason}` : "Automatisch noch nicht geprüft."}</p>;
  }
  const { run, result, olderVersion, criterionChanged, failedAfter } = entry;
  return (
    <div className="mt-1 text-[12px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={TONE[result.status]}>automatisch: {AUTO_STATUS_LABEL[result.status]}</Chip>
        <span className="text-[11px] text-faint">geprüft {formatDateTime(run.at)} ({age(run.at)}) · Thesenversion {run.thesisVersion}</span>
      </div>
      {criterionChanged ? (
        <p className="mt-0.5 text-[11px] text-warn">Dieses Ergebnis gilt für die frühere Fassung „{describeCriterion(result.criterion)}“. Bitte erneut prüfen.</p>
      ) : olderVersion ? <p className="mt-0.5 text-[11px] text-faint">Ergebnis aus Version {run.thesisVersion}; das Kriterium ist seitdem unverändert.</p> : null}
      {failedAfter ? <p className="mt-0.5 text-[11px] text-neg">Neuerer Abruf am {formatDateTime(failedAfter.at)} fehlgeschlagen ({failedAfter.fetch.ok ? "" : failedAfter.fetch.error}) - gezeigt wird das Ergebnis von {age(run.at)}.</p> : null}
      <p className="mt-0.5 leading-relaxed">{result.sentence}</p>
      {result.periods.length ? <ResultDetails result={result} run={run} /> : null}
    </div>
  );
}
