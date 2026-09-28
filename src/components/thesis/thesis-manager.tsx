"use client";

import { useState } from "react";
import Link from "next/link";
import {
  applyImport, current, exportJson, parseImport, planImport, reviewState, setLifecycle, ThesisError,
  type ImportChoice, type ImportItem, type Thesis,
} from "@/lib/thesis/model";
import { deleteAll, download, newId, nowIso, readRaw, todayLocal } from "@/lib/thesis/storage";
import { Card, CardBody, Chip, EmptyState, Skeleton } from "@/components/ui/primitives";
import { DueChip, History, StorageNotice, ThesisView } from "./thesis-parts";
import { useThesisActions } from "./thesis-panel";
import { formatDate } from "@/lib/finance/format";
import { cn } from "@/lib/utils";

const KIND_TEXT: Record<ImportItem["kind"], string> = {
  neu: "Neu – gibt es hier noch nicht.",
  identisch: "Identisch mit dem vorhandenen Stand – nichts zu tun.",
  erweitert: "Enthält den vorhandenen Stand vollständig plus neuere Einträge.",
  abweichend: "Weicht vom vorhandenen Stand ab – wird nie überschrieben, nur als Kopie importierbar.",
};

function ImportPanel({ onDone }: { onDone: (msg: string) => void }) {
  const { store, persist } = useThesisActions();
  const [plan, setPlan] = useState<ImportItem[] | null>(null);
  const [choices, setChoices] = useState<Record<string, ImportChoice>>({});
  const [errors, setErrors] = useState<string[]>([]);

  async function onFile(file: File | undefined) {
    setErrors([]); setPlan(null);
    if (!file) return;
    if (file.size > 5_000_000) { setErrors(["Datei zu groß (höchstens 5 MB)."]); return; }
    const parsed = parseImport(await file.text());
    if (!parsed.ok) { setErrors(parsed.errors); return; }
    const p = planImport(store, parsed.theses);
    setPlan(p);
    // Voreinstellung: neue und erweiterte Thesen vorschlagen, abweichende auslassen - alles bleibt aenderbar
    setChoices(Object.fromEntries(p.map((i) => [i.incoming.id, i.kind === "neu" || i.kind === "erweitert" ? "uebernehmen" : "auslassen"])));
  }

  function apply() {
    if (!plan) return;
    try {
      const r = applyImport(store, plan, choices, nowIso(), newId);
      const err = persist(() => r.store.theses);
      if (err) setErrors([err]);
      else { setPlan(null); onDone(`${r.applied} ${r.applied === 1 ? "These" : "Thesen"} importiert.`); }
    } catch (e) {
      setErrors([e instanceof ThesisError ? e.message : "Import fehlgeschlagen."]);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-[12px] font-semibold text-muted">Exportdatei auswählen (JSON)
        <input type="file" accept="application/json,.json" className="mt-1 block w-full text-[13px]" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {errors.length ? <ul role="alert" className="rounded-[10px] border border-neg/30 bg-neg-soft px-3 py-2 text-[12px]">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
      {plan ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted">Vorschau: Nichts wird ohne deine Auswahl geändert. Vorhandene Thesen werden nie still überschrieben.</p>
          <ul className="space-y-2">
            {plan.map((i) => {
              const c = current(i.incoming).content;
              const options: ImportChoice[] = i.kind === "identisch" ? ["auslassen"] : i.kind === "abweichend" ? ["auslassen", "kopie"] : ["uebernehmen", "kopie", "auslassen"];
              return (
                <li key={i.incoming.id} className="rounded-[10px] border border-line p-3 text-[12px]">
                  <p className="font-semibold">{c.ticker} · {c.companyName} <span className="font-normal text-faint">({i.incoming.versions.length} Versionen)</span></p>
                  <p className="mt-0.5 text-muted">{KIND_TEXT[i.kind]}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {options.map((o) => (
                      <label key={o} className={cn("cursor-pointer rounded-[8px] border px-2.5 py-1", choices[i.incoming.id] === o ? "border-accent bg-accent-soft text-accent" : "border-line")}>
                        <input type="radio" className="sr-only" name={`imp-${i.incoming.id}`} checked={choices[i.incoming.id] === o}
                          onChange={() => setChoices((x) => ({ ...x, [i.incoming.id]: o }))} />
                        {o === "uebernehmen" ? (i.existing ? "Aktualisieren" : "Übernehmen") : o === "kopie" ? "Als Kopie anlegen" : "Auslassen"}
                      </label>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={apply} className="h-9 rounded-[10px] bg-accent px-3 text-[13px] font-bold text-accent-ink">Auswahl importieren</button>
        </div>
      ) : null}
    </div>
  );
}

function DeleteAll({ onDone }: { onDone: (msg: string) => void }) {
  const [confirm, setConfirm] = useState("");
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted">Löscht alle Thesen, Versionen und Prüfungen in diesem Browser endgültig. Exportiere vorher, wenn du sie behalten willst.</p>
      <label className="block text-[12px] font-semibold text-muted">Zur Bestätigung LÖSCHEN eingeben
        <input className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px]" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <button type="button" disabled={confirm !== "LÖSCHEN"} onClick={() => { deleteAll(); setConfirm(""); onDone("Alle Thesen in diesem Browser wurden gelöscht."); }}
        className="h-9 rounded-[10px] bg-neg px-3 text-[13px] font-bold text-white disabled:opacity-40">Alles endgültig löschen</button>
    </div>
  );
}

function ThesisCard({ t, today }: { t: Thesis; today: string }) {
  const { persist, replace } = useThesisActions();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const c = current(t).content;
  function reactivate() {
    try {
      setError(persist(replace(setLifecycle(t, "aktiv", reason, nowIso()))));
    } catch (e) { setError(e instanceof ThesisError ? e.message : "Fehler."); }
  }
  return (
    <li id={t.id} className="scroll-mt-32">
      <Card>
        <details>
          <summary className="cursor-pointer list-none px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link href={`/aktie/${c.ticker}#these`} className="num text-[13px] font-bold hover:underline">{c.ticker}</Link>
              <span className="text-[12px] text-muted">{c.companyName}</span>
              <DueChip t={t} today={today} />
              {t.importedFrom ? <Chip tone="neutral">importierte Kopie</Chip> : null}
            </div>
            <p className="mt-1 line-clamp-2 text-[13px]">{c.reason}</p>
            <p className="mt-0.5 text-[11px] text-faint">Version {current(t).version} · angelegt {formatDate(t.createdAt)} · {t.reviews.length} {t.reviews.length === 1 ? "Prüfung" : "Prüfungen"}</p>
          </summary>
          <CardBody className="space-y-4 border-t border-line pt-4">
            <ThesisView t={t} today={today} />
            <History t={t} />
            {t.lifecycle === "archiviert" ? (
              <div className="space-y-2">
                <label className="block text-[12px] font-semibold text-muted">Wieder aktivieren – Grund *
                  <input className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px]" value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <button type="button" onClick={reactivate} className="h-9 rounded-[10px] border border-line px-3 text-[13px] font-semibold">Wieder aktivieren</button>
                {error ? <p role="alert" className="text-[12px] text-neg">{error}</p> : null}
              </div>
            ) : (
              <Link href={`/aktie/${c.ticker}#these`} className="inline-block text-[13px] font-semibold text-accent">Auf der Aktienseite bearbeiten oder prüfen →</Link>
            )}
          </CardBody>
        </details>
      </Card>
    </li>
  );
}

/** "Meine Thesen": Ueberblick, faellige Pruefungen zuerst, dazu Export, Import und Loeschen. */
export function ThesisManager() {
  const { store, status, problems } = useThesisActions();
  const [filter, setFilter] = useState<"aktiv" | "faellig" | "archiviert">("aktiv");
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "import" | "delete">("none");
  const today = todayLocal();

  if (status === "loading") return <Skeleton className="h-40" />;
  if (status === "unavailable") return <EmptyState title="Lokaler Speicher nicht verfügbar" hint={problems.join(" ")} />;
  if (status === "corrupt") {
    return (
      <Card><CardBody className="space-y-3 pt-4 text-[13px] sm:pt-5">
        <p className="font-semibold">Die gespeicherten Thesen sind beschädigt</p>
        <ul className="list-disc pl-5 text-muted">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        <p className="text-muted">Es wurde nichts überschrieben. Sichere zuerst den Rohinhalt, bevor du den Speicher zurücksetzt.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="h-9 rounded-[10px] border border-line px-3 font-semibold" onClick={() => download(`thesen-rohinhalt-${today}.json`, readRaw() ?? "")}>Rohinhalt herunterladen</button>
        </div>
        <DeleteAll onDone={(m) => setMessage(m)} />
      </CardBody></Card>
    );
  }

  const theses = [...store.theses].sort((a, b) => current(b).savedAt.localeCompare(current(a).savedAt));
  const due = theses.filter((t) => reviewState(t, today).due);
  const shown = filter === "faellig" ? due : theses.filter((t) => t.lifecycle === filter);
  const counts = { aktiv: theses.filter((t) => t.lifecycle === "aktiv").length, faellig: due.length, archiviert: theses.filter((t) => t.lifecycle === "archiviert").length };

  return (
    <div className="space-y-5">
      <StorageNotice />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={theses.length === 0} onClick={() => download(`thesen-${today}.json`, exportJson(store, nowIso()))}
          className="h-9 rounded-[10px] bg-accent px-3 text-[13px] font-bold text-accent-ink disabled:opacity-40">Exportieren (JSON)</button>
        <button type="button" onClick={() => setPanel(panel === "import" ? "none" : "import")} className="h-9 rounded-[10px] border border-line px-3 text-[13px] font-semibold">Importieren</button>
        <button type="button" onClick={() => setPanel(panel === "delete" ? "none" : "delete")} className="h-9 rounded-[10px] border border-line px-3 text-[13px] font-semibold">Alle löschen</button>
      </div>
      {message ? <p role="status" className="rounded-[10px] border border-pos/30 bg-pos-soft px-3 py-2 text-[12px]">{message}</p> : null}
      {panel === "import" ? <Card><CardBody className="pt-4"><ImportPanel onDone={(m) => { setMessage(m); setPanel("none"); }} /></CardBody></Card> : null}
      {panel === "delete" ? <Card><CardBody className="pt-4"><DeleteAll onDone={(m) => { setMessage(m); setPanel("none"); }} /></CardBody></Card> : null}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Thesen filtern">
        {([["aktiv", "Aktiv"], ["faellig", "Prüfung fällig"], ["archiviert", "Archiviert"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={cn("rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold", filter === k ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>
            {l} ({counts[k]})
          </button>
        ))}
      </div>

      {theses.length === 0 ? (
        <EmptyState title="Noch keine Thesen" hint="Öffne eine Aktie und wähle „These festhalten“. Hier erscheinen dann alle Thesen mit fälligen Prüfungen." />
      ) : shown.length === 0 ? (
        <p className="text-[13px] text-muted">{filter === "faellig" ? "Keine Prüfung fällig." : "Keine Thesen in dieser Ansicht."}</p>
      ) : (
        <ul className="space-y-2">{shown.map((t) => <ThesisCard key={t.id} t={t} today={today} />)}</ul>
      )}
    </div>
  );
}
