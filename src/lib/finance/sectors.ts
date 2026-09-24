/**
 * Branchenprofile. Ein Cashflow-DCF passt nicht zu jedem Geschaeftsmodell:
 * Bei Banken und Versicherern sind Schulden Teil des Geschaefts, bei
 * Immobiliengesellschaften zaehlen andere Groessen. Statt ein unpassendes
 * Verfahren zu erzwingen, wird es abgeschaltet und begruendet.
 * Einteilung nach dem SIC-Code der SEC.
 */

export type SectorProfileKey = "standard" | "finanzen" | "immobilien" | "rohstoffe" | "versorger";

export interface SectorProfile {
  key: SectorProfileKey;
  label: string;
  /** Ist ein DCF auf Basis freier Cashflows sinnvoll? */
  dcfSuitable: boolean;
  /** Begruendung, falls nicht. */
  dcfNote?: string;
  /** Kennzahlen, die bei dieser Branche im Vordergrund stehen. */
  focus: string[];
}

export const SECTOR_PROFILES: Record<SectorProfileKey, SectorProfile> = {
  standard: {
    key: "standard", label: "Industrie, Technologie, Konsum und Gesundheit", dcfSuitable: true,
    focus: ["Freier Cashflow", "Operative Marge", "Umsatzwachstum", "Nettoverschuldung zu operativem Cashflow"],
  },
  finanzen: {
    key: "finanzen", label: "Banken, Versicherer und Finanzdienstleister", dcfSuitable: false,
    dcfNote: "Bei Finanzunternehmen sind Schulden Teil des Geschäftsmodells. Freier Cashflow und Nettoverschuldung sind hier nicht aussagekräftig; sinnvoll sind Eigenkapitalrendite, Buchwert und Kapitalquoten.",
    focus: ["Eigenkapitalrendite", "Eigenkapital je Aktie", "Ergebnis je Aktie"],
  },
  immobilien: {
    key: "immobilien", label: "Immobiliengesellschaften und REITs", dcfSuitable: false,
    dcfNote: "Bei Immobiliengesellschaften wird das Ergebnis stark von Abschreibungen und Bewertungseffekten geprägt. Üblich sind Funds from Operations und der Substanzwert; beide liegen in den XBRL-Standarddaten nicht verlässlich vor.",
    focus: ["Eigenkapital je Aktie", "Verschuldung", "Ausschüttung"],
  },
  rohstoffe: {
    key: "rohstoffe", label: "Rohstoffe, Bergbau und Energie", dcfSuitable: true,
    dcfNote: "Ergebnisse schwanken mit den Rohstoffpreisen. Historische Durchschnitte sind hier weniger belastbar als in anderen Branchen.",
    focus: ["Freier Cashflow über den Zyklus", "Verschuldung", "Investitionsquote"],
  },
  versorger: {
    key: "versorger", label: "Versorger und Netzbetreiber", dcfSuitable: true,
    dcfNote: "Versorger investieren dauerhaft hoch und sind reguliert. Der freie Cashflow ist deshalb oft niedrig, ohne dass das Geschäft schwach wäre.",
    focus: ["Investitionsquote", "Verschuldung", "Regulierter Ertrag"],
  },
};

/** Ordnet einen SIC-Code der SEC einem Branchenprofil zu. */
export function sectorProfile(sic: string | null | undefined): SectorProfile {
  const n = Number(sic);
  if (!Number.isFinite(n)) return SECTOR_PROFILES.standard;
  if (n >= 6500 && n <= 6599) return SECTOR_PROFILES.immobilien;
  if (n === 6798) return SECTOR_PROFILES.immobilien;
  if (n >= 6000 && n <= 6799) return SECTOR_PROFILES.finanzen;
  if ((n >= 1000 && n <= 1499) || (n >= 2900 && n <= 2999)) return SECTOR_PROFILES.rohstoffe;
  if (n >= 4900 && n <= 4991) return SECTOR_PROFILES.versorger;
  return SECTOR_PROFILES.standard;
}
