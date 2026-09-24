/**
 * SEC-Meldungen fuehren Namen meist in Grossbuchstaben als "NACHNAME VORNAME
 * [ZWEITNAME]" ohne Komma. Eine automatische Umkehrung ist eine Heuristik -
 * bei manchen mehrteiligen Nachnamen (z. B. "DE LA CRUZ") ist sie falsch.
 * Fuer einige oeffentlich bekannte Fuehrungskraefte, deren SEC-Meldename vom
 * gebraeuchlichen Namen abweicht (z. B. Jensen statt Jen-Hsun Huang), steht
 * eine manuell gepflegte Liste bereit - echte, oeffentlich bekannte Namen,
 * keine Erfindung.
 */

const KNOWN_ALIASES: Record<string, string> = {
  "HUANG JEN HSUN": "Jensen Huang",
  "HUANG JEN-HSUN": "Jensen Huang",
  "MUSK ELON R": "Elon Musk",
  "MUSK ELON": "Elon Musk",
  "COOK TIMOTHY D": "Tim Cook",
  "COOK TIMOTHY": "Tim Cook",
  "NADELLA SATYA": "Satya Nadella",
  "PICHAI SUNDARARAJAN": "Sundar Pichai",
  "ZUCKERBERG MARK": "Mark Zuckerberg",
  "JASSY ANDREW R": "Andy Jassy",
  "DIMON JAMES": "Jamie Dimon",
};

function titleCase(word: string): string {
  if (word.length <= 3 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) return word; // Initialen wie "A" oder "JR" stehenlassen
  return word.charAt(0) + word.slice(1).toLowerCase();
}

/** Formt einen SEC-Meldenamen in Lesbare Form um. Ohne verlaessliche Trennung bestmoeglich, nie erfunden. */
export function formatInsiderName(raw: string): string {
  const clean = raw.trim().replace(/\s+/g, " ");
  if (!clean) return "Unbekannt";
  const key = clean.toUpperCase();
  if (KNOWN_ALIASES[key]) return KNOWN_ALIASES[key];

  if (clean.includes(",")) {
    const [last, ...rest] = clean.split(",").map((p) => p.trim());
    const given = rest.join(" ").split(" ").filter(Boolean);
    return [...given, last].filter(Boolean).map(titleCase).join(" ");
  }

  const parts = clean.split(" ").filter(Boolean);
  if (parts.length < 2) return titleCase(clean);
  const [last, ...given] = parts;
  return [...given, last].map(titleCase).join(" ");
}

const ROLE_TITLE_PATTERNS: [RegExp, string][] = [
  [/chief executive officer|^ceo$/i, "CEO"],
  [/chief financial officer|^cfo$/i, "Finanzchef(in)"],
  [/chief operating officer|^coo$/i, "Betriebschef(in)"],
  [/chief technology officer|^cto$/i, "Technikchef(in)"],
  [/chief legal officer|general counsel/i, "Chefjurist(in)"],
  [/president/i, "Präsident(in)"],
  [/chairman|chair of the board/i, "Vorsitzende(r)"],
];

/** Kurzform einer Rollenbezeichnung fuer Tabellenanzeigen, faellt auf die Originalbezeichnung zurueck. */
export function shortRole(roles: string[]): string {
  for (const role of roles) {
    const title = role.replace(/^Führungskraft:\s*/, "");
    for (const [pattern, label] of ROLE_TITLE_PATTERNS) if (pattern.test(title)) return label;
  }
  if (roles.some((r) => r.startsWith("Führungskraft"))) return "Führungskraft";
  if (roles.some((r) => r === "Mitglied des Board of Directors")) return "Aufsichtsrat";
  if (roles.some((r) => r.includes("10 %"))) return "Großaktionär";
  return roles[0] ?? "Insider";
}
