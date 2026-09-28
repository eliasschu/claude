"use client";

import { useState } from "react";
import Link from "next/link";
import { addReview, createThesis, current, saveVersion, setLifecycle, ThesisError, type Thesis, type ThesisContent } from "@/lib/thesis/model";
import { newId, nowIso, todayLocal, useThesisStore, writeStore } from "@/lib/thesis/storage";
import { Card, CardBody, Skeleton } from "@/components/ui/primitives";
import { emptyContent, ThesisForm } from "./thesis-form";
import { History, ReviewForm, StorageNotice, ThesisView } from "./thesis-parts";
import { formatDate } from "@/lib/finance/format";

type Mode = "ansicht" | "neu" | "bearbeiten" | "pruefen" | "verlauf" | "archivieren";

function useThesisActions() {
  const { store, status, problems } = useThesisStore();
  function persist(update: (theses: Thesis[]) => Thesis[]): string | null {
    try {
      writeStore({ ...store, theses: update(store.theses) });
      return null;
    } catch (e) {
      if (e instanceof ThesisError) return e.message;
      return "Speichern im Browser fehlgeschlagen (Speicher voll oder gesperrt). Bitte exportiere deine Thesen.";
    }
  }
  const replace = (t: Thesis) => (list: Thesis[]) => list.map((x) => (x.id === t.id ? t : x));
  return { store, status, problems, persist, replace };
}

/** Thesen-Tagebuch auf der Aktienseite: eine aktive These je Unternehmen, fruehere bleiben archiviert sichtbar. */
export function ThesisPanel({ ticker, companyName }: { ticker: string; companyName: string }) {
  const { store, status, problems, persist, replace } = useThesisActions();
  const [mode, setMode] = useState<Mode>("ansicht");
  const [error, setError] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const today = todayLocal();
  const mine = store.theses.filter((t) => current(t).content.ticker === ticker.toUpperCase());
  // Mehrere aktive Thesen zum selben Unternehmen sind moeglich (z. B. importierte Kopie) - gezeigt wird die zuletzt bearbeitete
  const actives = mine.filter((t) => t.lifecycle === "aktiv").sort((a, b) => current(b).savedAt.localeCompare(current(a).savedAt));
  const active = actives[0] ?? null;
  const archived = mine.filter((t) => t.lifecycle === "archiviert");

  function run(fn: () => Thesis[] | ((l: Thesis[]) => Thesis[])): string | null {
    try {
      const result = fn();
      const err = persist(typeof result === "function" ? result : () => result);
      if (!err) setMode("ansicht");
      return err;
    } catch (e) {
      return e instanceof ThesisError ? e.message : "Unerwarteter Fehler.";
    }
  }

  if (status === "loading") return <Skeleton className="h-32" />;
  if (status === "unavailable" || status === "corrupt") {
    return (
      <Card><CardBody className="space-y-2 pt-4 text-[13px] sm:pt-5">
        <p className="font-semibold">{status === "unavailable" ? "Lokaler Speicher nicht verfügbar" : "Gespeicherte Thesen sind beschädigt"}</p>
        <p className="text-muted">{problems.join(" ")}</p>
        {status === "corrupt" ? <p className="text-muted">Es wurde nichts überschrieben. Unter <Link href="/thesen" className="underline">Meine Thesen</Link> kannst du den Rohinhalt sichern und den Speicher bewusst zurücksetzen.</p> : null}
      </CardBody></Card>
    );
  }

  return (
    <Card>
      <CardBody className="space-y-4 pt-4 sm:pt-5">
        {mode === "neu" ? (
          <>
            <StorageNotice compact />
            <ThesisForm mode="neu" initial={emptyContent(ticker.toUpperCase(), companyName)} onCancel={() => setMode("ansicht")}
              onSubmit={(c: ThesisContent) => run(() => [...store.theses, createThesis(c, nowIso(), newId())])} />
          </>
        ) : !active ? (
          <div className="space-y-3">
            <p className="text-[14px]">Noch keine aktive These zu {companyName}. Halte fest, warum du das Unternehmen beobachtest oder besitzt, was dagegen spricht und woran du erkennen würdest, dass du falsch liegst.</p>
            <button type="button" onClick={() => setMode("neu")} className="h-10 rounded-[10px] bg-accent px-4 text-[13px] font-bold text-accent-ink">These festhalten</button>
            <StorageNotice compact />
          </div>
        ) : mode === "bearbeiten" ? (
          <ThesisForm mode="bearbeiten" initial={current(active).content} onCancel={() => setMode("ansicht")}
            onSubmit={(c, reason) => run(() => replace(saveVersion(active, c, reason, nowIso())))} />
        ) : mode === "pruefen" ? (
          <ReviewForm t={active} onCancel={() => setMode("ansicht")}
            onSubmit={(r) => run(() => replace(addReview(active, { ...r, id: newId(), at: "" }, nowIso())))} />
        ) : (
          <>
            <ThesisView t={active} today={today} />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setMode("pruefen")} className="h-9 rounded-[10px] bg-accent px-3 text-[13px] font-bold text-accent-ink">Prüfung dokumentieren</button>
              <button type="button" onClick={() => setMode("bearbeiten")} className="h-9 rounded-[10px] border border-line px-3 text-[13px] font-semibold">Bearbeiten</button>
              <button type="button" onClick={() => setMode(mode === "verlauf" ? "ansicht" : "verlauf")} className="h-9 rounded-[10px] border border-line px-3 text-[13px] font-semibold">
                Verlauf ({active.versions.length} {active.versions.length === 1 ? "Version" : "Versionen"}, {active.reviews.length} {active.reviews.length === 1 ? "Prüfung" : "Prüfungen"})
              </button>
              <button type="button" onClick={() => setMode("archivieren")} className="h-9 rounded-[10px] border border-line px-3 text-[13px] font-semibold">Archivieren</button>
            </div>
            {mode === "verlauf" ? <History t={active} /> : null}
            {mode === "archivieren" ? (
              <div className="space-y-2 rounded-[10px] border border-line p-3">
                <label className="block text-[12px] font-semibold text-muted">Warum archivieren? *
                  <input className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px]" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} />
                </label>
                <p className="text-[11px] text-faint">Archivierte Thesen bleiben mit allen Versionen erhalten und können wieder aktiviert werden.</p>
                <div className="flex gap-2">
                  <button type="button" className="h-9 rounded-[10px] bg-accent px-3 text-[13px] font-bold text-accent-ink"
                    onClick={() => setError(run(() => replace(setLifecycle(active, "archiviert", archiveReason, nowIso()))))}>Archivieren</button>
                  <button type="button" className="h-9 rounded-[10px] border border-line px-3 text-[13px]" onClick={() => setMode("ansicht")}>Abbrechen</button>
                </div>
              </div>
            ) : null}
            {error ? <p role="alert" className="text-[12px] text-neg">{error}</p> : null}
          </>
        )}

        {actives.length > 1 && mode === "ansicht" ? (
          <p className="rounded-[10px] border border-warn/40 bg-warn-soft px-3 py-2 text-[12px]">
            Es gibt {actives.length} aktive Thesen zu diesem Unternehmen. Hier siehst du die zuletzt bearbeitete; alle findest du unter{" "}
            <Link href="/thesen" className="underline">Meine Thesen</Link>.
          </p>
        ) : null}
        {archived.length > 0 && mode === "ansicht" ? (
          <details className="text-[12px] text-muted">
            <summary className="cursor-pointer">Frühere Thesen ({archived.length}, archiviert)</summary>
            <ul className="mt-2 space-y-1">
              {archived.map((t) => (
                <li key={t.id}>
                  {current(t).content.reason.slice(0, 120) || "ohne Grund"} · angelegt {formatDate(t.createdAt)} ·{" "}
                  <Link href={`/thesen#${t.id}`} className="underline">in „Meine Thesen“ ansehen</Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}

export { useThesisActions };
