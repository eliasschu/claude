/** Sprechende Texte fuer Modell-Enums, damit sie in der Oberflaeche nicht dupliziert werden. */

import type { BandVerdict } from "./valuation.ts";

export const VERDICT_TEXT: Record<BandVerdict, string> = {
  "Bewertung erscheint attraktiv": "Attraktiv bewertet",
  "Eher fair bewertet": "Ungefähr fair bewertet",
  "Hohe Erwartungen eingepreist": "Hohe Erwartungen eingepreist",
  "Datenlage unzureichend": "Datenlage unzureichend",
};
