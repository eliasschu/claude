/**
 * Kuratierte Liste institutioneller 13F-Filer. CIK-Nummern stammen aus einer
 * vom Nutzer bereitgestellten Liste - ich konnte sie in dieser Umgebung
 * nicht gegen sec.gov gegenpruefen (Netzwerkzugriff dort gesperrt). Deshalb
 * prueft der Dienst bei jedem Abruf, ob der bei der SEC hinterlegte Name zum
 * erwarteten Fonds passt (nameHints); bei Nichtuebereinstimmung wird die
 * Position ehrlich als nicht verfuegbar behandelt statt falsche Daten zu
 * zeigen.
 */
export interface WhaleProfile {
  slug: string;
  displayName: string;
  cik: number;
  /** Mindestens ein Begriff muss im bei der SEC hinterlegten Namen vorkommen. */
  nameHints: string[];
  note: string;
}

export const WHALES: WhaleProfile[] = [
  { slug: "berkshire-hathaway", displayName: "Warren Buffett / Berkshire Hathaway", cik: 1067983, nameHints: ["BERKSHIRE"], note: "" },
  { slug: "bridgewater", displayName: "Ray Dalio / Bridgewater Associates", cik: 1350694, nameHints: ["BRIDGEWATER"], note: "" },
  { slug: "citadel", displayName: "Ken Griffin / Citadel Advisors", cik: 1423053, nameHints: ["CITADEL"], note: "" },
  { slug: "millennium", displayName: "Israel Englander / Millennium Management", cik: 1273087, nameHints: ["MILLENNIUM"], note: "" },
  { slug: "point72", displayName: "Steve Cohen / Point72 Asset Management", cik: 1603466, nameHints: ["POINT72", "POINT 72"], note: "" },
  { slug: "renaissance", displayName: "Jim Simons / Renaissance Technologies", cik: 1037389, nameHints: ["RENAISSANCE"], note: "" },
  { slug: "pershing-square", displayName: "Bill Ackman / Pershing Square Capital", cik: 1336528, nameHints: ["PERSHING SQUARE"], note: "" },
  { slug: "elliott", displayName: "Paul Singer / Elliott Investment Management", cik: 1791786, nameHints: ["ELLIOTT"], note: "" },
  { slug: "appaloosa", displayName: "David Tepper / Appaloosa Management", cik: 1006438, nameHints: ["APPALOOSA"], note: "" },
  { slug: "de-shaw", displayName: "David E. Shaw / D. E. Shaw & Co.", cik: 1009207, nameHints: ["D E SHAW", "D. E. SHAW", "DE SHAW"], note: "" },
  { slug: "duquesne", displayName: "Stanley Druckenmiller / Duquesne Family Office", cik: 1536411, nameHints: ["DUQUESNE"], note: "" },
  { slug: "tiger-global", displayName: "Chase Coleman / Tiger Global Management", cik: 1167483, nameHints: ["TIGER GLOBAL"], note: "" },
  { slug: "ark", displayName: "Cathie Wood / ARK Investment Management", cik: 1605941, nameHints: ["ARK INVESTMENT"], note: "" },
  { slug: "coatue", displayName: "Philippe Laffont / Coatue Management", cik: 1166683, nameHints: ["COATUE"], note: "" },
  { slug: "baupost", displayName: "Seth Klarman / The Baupost Group", cik: 1061705, nameHints: ["BAUPOST"], note: "" },
  { slug: "third-point", displayName: "Daniel Loeb / Third Point", cik: 1040273, nameHints: ["THIRD POINT"], note: "" },
  { slug: "aqr", displayName: "Cliff Asness / AQR Capital Management", cik: 1167557, nameHints: ["AQR CAPITAL"], note: "" },
  { slug: "oaktree", displayName: "Howard Marks / Oaktree Capital Management", cik: 1020224, nameHints: ["OAKTREE"], note: "" },
  { slug: "tci", displayName: "Chris Hohn / TCI Fund Management", cik: 1647251, nameHints: ["TCI FUND"], note: "" },
  { slug: "viking-global", displayName: "Ole Andreas Halvorsen / Viking Global Investors", cik: 1103804, nameHints: ["VIKING GLOBAL"], note: "" },
  { slug: "lone-pine", displayName: "Stephen Mandel / Lone Pine Capital", cik: 1061219, nameHints: ["LONE PINE"], note: "" },
  { slug: "gamco", displayName: "Mario Gabelli / GAMCO Investors", cik: 807249, nameHints: ["GAMCO", "GABELLI"], note: "" },
  { slug: "farallon", displayName: "Farallon Capital Management", cik: 1025826, nameHints: ["FARALLON"], note: "" },
  { slug: "omega", displayName: "Leon Cooperman / Omega Advisors", cik: 1061165, nameHints: ["OMEGA ADVISORS", "OMEGA ASSOCIATES"], note: "" },
  { slug: "fairfax", displayName: "Prem Watsa / Fairfax Financial", cik: 1113000, nameHints: ["FAIRFAX"], note: "" },
  { slug: "pabrai", displayName: "Mohnish Pabrai / Pabrai Funds", cik: 1163368, nameHints: ["PABRAI"], note: "" },
  { slug: "fundsmith", displayName: "Terry Smith / Fundsmith", cik: 1551804, nameHints: ["FUNDSMITH"], note: "" },
];

export const whaleBySlug = (slug: string) => WHALES.find((w) => w.slug === slug);
