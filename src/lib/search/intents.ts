/**
 * Erkennt wiederkehrende Fragemuster in der Sucheingabe, um zur passenden
 * Stelle einer Aktienseite zu springen (z. B. "ist X fair bewertet" -> Bewertungsabschnitt).
 * Erfindet keine Antwort – liefert nur einen Anker und einen Erklaertext.
 */

export const SEARCH_EXAMPLES = [
  "Nvidia",
  "RHM",
  "Ist Rheinmetall fair bewertet?",
  "Bitcoin",
  "DAX",
];

export interface SearchIntent {
  explanation: string;
  anchor: string | null;
  href: string | null;
}

const PATTERNS: { test: RegExp; anchor: string | null; explanation: string }[] = [
  { test: /fair(\s+bewertet)?|bewertung|wert\s*$/i, anchor: "#bewertung", explanation: "Frage nach Bewertung erkannt – Ergebnisse führen zum Bewertungsabschnitt der jeweiligen Aktie." },
  { test: /scorecard|score/i, anchor: "#scorecard", explanation: "Frage nach der Scorecard erkannt." },
];

export function detectIntent(query: string): SearchIntent {
  const q = query.trim();
  if (!q) return { explanation: "Name, Ticker, ISIN oder WKN eingeben, oder eine Frage stellen.", anchor: null, href: null };
  const match = PATTERNS.find((p) => p.test.test(q));
  if (match) return { explanation: match.explanation, anchor: match.anchor, href: null };
  return { explanation: `Ergebnisse für „${q}"`, anchor: null, href: null };
}
