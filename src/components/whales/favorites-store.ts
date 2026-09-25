/**
 * Favoriten leben nur im Browser (localStorage) - kein Konto, kein Server,
 * daher auch keine Benachrichtigungen möglich. Wer den Browser wechselt,
 * verliert die Auswahl; das ist eine bewusste Grenze, kein Bug.
 */
const FAVORITES_KEY = "djk-whale-favorites";
const ONLY_FAVORITES_KEY = "djk-whale-only-favorites";
export const FAVORITES_EVENT = "djk:favorites-changed";

function readFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeFavorites(slugs: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...slugs]));
  } catch {
    // localStorage nicht verfuegbar (z. B. privater Modus) - Auswahl bleibt fluechtig.
  }
  window.dispatchEvent(new Event(FAVORITES_EVENT));
}

export function isFavorite(slug: string): boolean {
  return readFavorites().has(slug);
}

export function toggleFavorite(slug: string): boolean {
  const favorites = readFavorites();
  const next = !favorites.has(slug);
  if (next) favorites.add(slug); else favorites.delete(slug);
  writeFavorites(favorites);
  return next;
}

export function getOnlyFavorites(): boolean {
  try {
    return localStorage.getItem(ONLY_FAVORITES_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOnlyFavorites(value: boolean) {
  try {
    localStorage.setItem(ONLY_FAVORITES_KEY, value ? "1" : "0");
  } catch {
    // s.o.
  }
  window.dispatchEvent(new Event(FAVORITES_EVENT));
}
