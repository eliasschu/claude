"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/** Massgeblich ist die Klasse am <html>-Element, die das Inline-Skript im Layout vor dem ersten Anstrich setzt. */
function subscribe(cb: () => void) {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const readTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

/**
 * Umschalter zwischen hellem und dunklem Modus. Die Auswahl liegt im
 * localStorage; das Inline-Skript im Layout setzt sie vor dem ersten Anstrich,
 * damit kein Helligkeitssprung entsteht.
 */
export function ThemeToggle() {
  // Serverseitig unbekannt (null) - dann wie bisher das Mond-Symbol
  const theme = useSyncExternalStore<Theme | null>(subscribe, readTheme, () => null);

  function apply(next: Theme) {
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      window.localStorage.setItem("fw-theme", next);
    } catch {
      // Speicher gesperrt - Auswahl gilt nur fuer diese Seite
    }
  }

  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => apply(next)}
      aria-label={next === "dark" ? "Dunklen Modus einschalten" : "Hellen Modus einschalten"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface text-muted transition-colors hover:text-ink"
    >
      {theme === "dark" ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
    </button>
  );
}
