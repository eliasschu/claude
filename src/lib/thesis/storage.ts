"use client";

/**
 * Lokale Speicherung des Thesen-Tagebuchs im Browser (localStorage).
 *
 * - Nur in diesem Browser auf diesem Geraet; Loeschen der Browserdaten loescht die Thesen.
 * - Kein Konto, kein Zugriffsschutz, nicht manipulationssicher.
 * - Es wird nichts an einen Server, Datenanbieter oder KI-Dienst uebertragen.
 * - Gespeichert wird im selben, gepruefte Format wie der Export - ein beschaedigter Speicher wird NICHT
 *   automatisch ueberschrieben, sondern gemeldet.
 */

import { useSyncExternalStore } from "react";
import { emptyStore, exportJson, parseImport, type ThesisStore } from "./model.ts";

export const THESIS_STORAGE_KEY = "djk-thesen-v1";

export type StorageStatus = "loading" | "ok" | "unavailable" | "corrupt";
export interface StorageState { store: ThesisStore; status: StorageStatus; problems: string[] }

const SERVER: StorageState = { store: emptyStore(), status: "loading", problems: [] };
const listeners = new Set<() => void>();
let cache: { raw: string | null; state: StorageState } | null = null;

function read(): StorageState {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(THESIS_STORAGE_KEY);
  } catch {
    return (cache = { raw: null, state: { store: emptyStore(), status: "unavailable", problems: ["Der Browser erlaubt keinen lokalen Speicher (z. B. privates Fenster)."] } }).state;
  }
  if (cache && cache.raw === raw) return cache.state;
  if (raw === null) return (cache = { raw, state: { store: emptyStore(), status: "ok", problems: [] } }).state;
  const parsed = parseImport(raw);
  const state: StorageState = parsed.ok
    ? { store: { ...emptyStore(), theses: parsed.theses }, status: "ok", problems: [] }
    : { store: emptyStore(), status: "corrupt", problems: parsed.errors };
  return (cache = { raw, state }).state;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === THESIS_STORAGE_KEY) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

export function useThesisStore(): StorageState {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}

/** Speichert den gesamten Stand. Wirft bei vollem oder gesperrtem Speicher - die Oberflaeche zeigt das an. */
export function writeStore(store: ThesisStore) {
  window.localStorage.setItem(THESIS_STORAGE_KEY, exportJson(store, new Date().toISOString()));
  listeners.forEach((l) => l());
}

/** Rohinhalt eines beschaedigten Speichers - zum Sichern, bevor bewusst geloescht wird. */
export function readRaw(): string | null {
  try { return window.localStorage.getItem(THESIS_STORAGE_KEY); } catch { return null; }
}

export function deleteAll() {
  window.localStorage.removeItem(THESIS_STORAGE_KEY);
  listeners.forEach((l) => l());
}

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
/** Heutiges Datum in der Zeitzone des Geraets (YYYY-MM-DD). */
export const todayLocal = () => new Date().toLocaleDateString("sv-SE");

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
