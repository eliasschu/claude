/**
 * Echtdatenpruefung der Kennzahlen (Etappe D) - nur ECHTE SEC-Antworten, kein Mock, keine Zugangsdaten in der Ausgabe.
 *
 *   ./bot-lokal.sh kennzahlen-pruefen [TICKER ...]        (empfohlen)
 *   node --experimental-strip-types scripts/kennzahlen-pruefen.ts [TICKER ...] [--website http://localhost:3000]
 *
 * Ablauf
 *  1. Konfiguration: SEC_EDGAR_USER_AGENT (Umgebung, .env.local oder services/quant/.env) muss Name und E-Mail enthalten.
 *     Der Wert wird nie ausgegeben. Ist eine Umleitung auf einen Testserver (FW_UPSTREAM_OVERRIDE) gesetzt, bricht das
 *     Skript ab - es faellt nie still auf Testdaten zurueck.
 *  2. Direkt bei der SEC: Tickerverzeichnis und Company Facts je Unternehmen (hoechstens ca. 6 Anfragen je Sekunde).
 *  3. Dieselben Regeln wie die Website (normalizeCompanyFacts, evaluateCriterion) - Tabelle der juengsten Perioden mit
 *     Links auf die Originalberichte zum Abgleich von Hand.
 *  4. Optional die laufende lokale Website (/api/kennzahlen): gleiche Zahlen wie der Direktabruf?
 *  5. Bericht nach pruefberichte-lokal/kennzahlen-<Zeit>.md (nicht im Repository).
 *
 * Unterschieden wird: Abruffehler (SEC nicht erreichbar, lehnt ab, Abrufgrenze) - keine XBRL-Daten (404) - Abruf
 * erfolgreich, aber Kennzahl nicht gemeldet.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filingIndexUrl, normalizeCompanyFacts, type CompanyFactsJson, type NormalizedFacts, type PeriodValue, type Quantity } from "../src/lib/finance/sec-facts.ts";
import { AUTO_STATUS_LABEL, EVAL_VERSION, evaluateCriterion } from "../src/lib/thesis/criteria-eval.ts";
import type { MeasurableCriterion } from "../src/lib/thesis/model.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TICKERS = ["AAPL", "MSFT", "NVDA", "AMZN", "JPM"];
// Weitere Konzepte, die NICHT verwendet werden - nur zur Einordnung der FCF-Abgrenzung im Bericht
const NOT_USED_CAPEX_LIKE = [
  "PaymentsToAcquireProductiveAssets", "PaymentsToDevelopSoftware", "PaymentsForSoftware", "PaymentsToAcquireIntangibleAssets",
  "FinanceLeasePrincipalPayments", "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets",
];

const lines: string[] = [];
const out = (s = "") => { lines.push(s); console.log(s); };
let failures = 0;

function readEnvFile(file: string): Record<string, string> {
  const path = join(ROOT, file);
  if (!existsSync(path)) return {};
  const vals: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) vals[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return vals;
}

function config() {
  const sources: [string, Record<string, string>][] = [
    ["Umgebung", process.env as Record<string, string>], [".env.local", readEnvFile(".env.local")], ["services/quant/.env", readEnvFile("services/quant/.env")],
  ];
  const find = (key: string) => {
    for (const [name, vals] of sources) if (vals[key]?.trim()) return { value: vals[key].trim(), from: name };
    return null;
  };
  return { ua: find("SEC_EDGAR_USER_AGENT"), override: find("FW_UPSTREAM_OVERRIDE") };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
type Fetched = { ok: true; json: unknown } | { ok: false; kind: "abruffehler" | "keine_daten"; message: string };

async function sec(url: string, ua: string): Promise<Fetched> {
  const wait = last + 170 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": ua, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    return { ok: false, kind: "abruffehler", message: `SEC nicht erreichbar (${e instanceof Error ? e.name : "Netzwerkfehler"}) – Internetverbindung prüfen.` };
  }
  if (res.status === 404) return { ok: false, kind: "keine_daten", message: "Die SEC hat für dieses Unternehmen keine strukturierten Finanzdaten (XBRL)." };
  if (res.status === 403 || res.status === 407) {
    return { ok: false, kind: "abruffehler", message: `Zugriff verweigert (HTTP ${res.status}) – entweder lehnt die SEC ab (SEC_EDGAR_USER_AGENT mit echtem Namen und E-Mail prüfen) oder ein Proxy, VPN oder eine Firewall blockiert sec.gov.` };
  }
  if (res.status === 429) return { ok: false, kind: "abruffehler", message: "Abrufgrenze der SEC erreicht (429) – einige Minuten warten." };
  if (!res.ok) return { ok: false, kind: "abruffehler", message: `SEC antwortete mit HTTP ${res.status}.` };
  try {
    return { ok: true, json: await res.json() };
  } catch {
    return { ok: false, kind: "abruffehler", message: "Antwort der SEC war kein gültiges JSON." };
  }
}

const de = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const mio = (v: number) => (v / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const pct = (v: number) => `${v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const key = (p: { start: string; end: string }) => `${p.start}|${p.end}`;

function cell(v: PeriodValue | undefined): string {
  if (!v) return "fehlt";
  return `${mio(v.value)}${v.derived ? " Δ" : ""}${v.revisions.length ? " R" : ""}`;
}

function table(facts: NormalizedFacts, kind: "quarters" | "years", count: number) {
  const s = facts.series;
  const get = (q: Quantity, p: { start: string; end: string }) => s[q][kind].find((v) => key(v) === key(p));
  const periods = [...new Map([...s.revenue[kind], ...s.operatingCashFlow[kind]].map((v) => [key(v), v])).values()]
    .sort((a, b) => b.end.localeCompare(a.end)).slice(0, count);
  if (periods.length === 0) { out("  (keine Perioden dieser Art gemeldet)"); return; }
  const unit = s.revenue[kind][0]?.unit ?? s.operatingCashFlow[kind][0]?.unit ?? "?";
  out(`  | Periode | Umsatz | Op. Ergebnis | Op. Marge | Op. Cashflow | Sachanlagen-Invest. | FCF | Bericht |`);
  out(`  |---|---|---|---|---|---|---|---|`);
  for (const p of periods) {
    const rev = get("revenue", p), oi = get("operatingIncome", p), ocf = get("operatingCashFlow", p), capex = get("capex", p);
    const margin = rev && oi && rev.value > 0 && rev.unit === oi.unit ? pct((oi.value / rev.value) * 100) : "–";
    const fcf = ocf && capex && ocf.unit === capex.unit ? mio(ocf.value - capex.value) : "–";
    const src = rev ?? ocf!;
    out(`  | ${de(p.start)}–${de(p.end)} | ${cell(rev)} | ${cell(oi)} | ${margin} | ${cell(ocf)} | ${cell(capex)} | ${fcf} | [${src.source.form} vom ${de(src.source.filed)}](${filingIndexUrl(facts.cik, src.source.accn)}) |`);
  }
  out(`  Beträge in Mio. ${unit}. Δ = Einzelquartal aus kumulierten Werten abgeleitet, R = später angepasster Wert (zuletzt eingereichter gilt).`);
  const derived = periods.flatMap((p) => (["revenue", "operatingIncome", "operatingCashFlow", "capex"] as Quantity[]).map((q) => get(q, p)).filter((v) => v?.derived));
  for (const v of derived.slice(0, 4)) out(`  - Δ ${v!.quantity} ${de(v!.start)}–${de(v!.end)}: ${v!.derived!.formula} = ${mio(v!.derived!.minuend.value)} − ${mio(v!.derived!.subtrahend.value)}`);
  const revised = periods.flatMap((p) => (["revenue", "operatingIncome", "operatingCashFlow", "capex"] as Quantity[]).map((q) => get(q, p)).filter((v) => v?.revisions.length));
  for (const v of revised.slice(0, 4)) out(`  - R ${v!.quantity} ${de(v!.start)}–${de(v!.end)}: verwendet ${mio(v!.value)} (${v!.source.form} ${de(v!.source.filed)}), früher ${v!.revisions.map((r) => `${mio(r.value)} (${r.source.form} ${de(r.source.filed)})`).join(", ")}`);
}

async function main() {
  const args = process.argv.slice(2);
  const wIdx = args.indexOf("--website");
  const website = wIdx >= 0 ? args[wIdx + 1] : "http://localhost:3000";
  const tickers = args.filter((a, i) => !a.startsWith("--") && (wIdx < 0 || i !== wIdx + 1)).map((t) => t.toUpperCase());
  const list = tickers.length ? tickers : DEFAULT_TICKERS;
  const now = new Date();
  const today = now.toLocaleDateString("sv-SE");

  out(`# Kennzahlen-Echtdatenprüfung – ${now.toLocaleString("de-DE")}`);
  out(`Regelversion ${EVAL_VERSION}. Quelle: SEC EDGAR Company Facts (echte Antworten, kein Testserver).`);
  out("");
  out("## 1. Konfiguration");
  const { ua, override } = config();
  if (override) {
    out(`✖ FW_UPSTREAM_OVERRIDE ist gesetzt (in ${override.from}). Damit würden Abrufe an einen Testserver gehen.`);
    out("  Abbruch: Diese Prüfung verwendet nur echte SEC-Daten. Eintrag entfernen und erneut starten.");
    process.exitCode = 2;
    return;
  }
  out("✔ Keine Umleitung auf einen Testserver gesetzt.");
  if (!ua) { out("✖ SEC_EDGAR_USER_AGENT fehlt. In .env.local eintragen: SEC_EDGAR_USER_AGENT=\"Vorname Nachname deine@email.de\""); process.exitCode = 2; return; }
  if (!/\S+@\S+\.\S+/.test(ua.value) || ua.value.split(/\s+/).length < 2) {
    out(`✖ SEC_EDGAR_USER_AGENT (aus ${ua.from}) braucht Name UND E-Mail-Adresse – Wert wird nicht angezeigt.`); process.exitCode = 2; return;
  }
  if (/example\.(org|com)/i.test(ua.value)) { out(`✖ SEC_EDGAR_USER_AGENT (aus ${ua.from}) enthält noch die Beispieladresse – bitte eigene angeben.`); process.exitCode = 2; return; }
  out(`✔ SEC_EDGAR_USER_AGENT gesetzt (aus ${ua.from}), mit Name und E-Mail – Wert wird nicht angezeigt.`);

  out("");
  out("## 2. Tickerverzeichnis der SEC");
  const idx = await sec("https://www.sec.gov/files/company_tickers_exchange.json", ua.value);
  if (!idx.ok) { failures++; out(`✖ Abruffehler: ${idx.message}`); return finish(); }
  const data = idx.json as { fields: string[]; data: unknown[][] };
  const iT = data.fields.indexOf("ticker"), iC = data.fields.indexOf("cik");
  const cikOf = new Map(data.data.map((r) => [String(r[iT]).toUpperCase(), Number(r[iC])]));
  out(`✔ ${cikOf.size} Einträge geladen.`);

  const criteria: MeasurableCriterion[] = [
    { id: "m", metric: "operating_margin", operator: "<", threshold: 0, period: "quartal", consecutive: 1 },
    { id: "g", metric: "revenue_growth_yoy", operator: "<", threshold: 0, period: "quartal", consecutive: 1 },
    { id: "f", metric: "free_cash_flow", operator: "<", threshold: 0, period: "quartal", consecutive: 1 },
    { id: "fy", metric: "operating_margin", operator: "<", threshold: 0, period: "jahr", consecutive: 2 },
  ];
  let websiteUp: boolean | null = null;

  for (const t of list) {
    out("");
    out(`## ${t}`);
    const cik = cikOf.get(t);
    if (!cik) { out(`◌ ${t} ist bei der SEC nicht registriert – nicht prüfbar (kein Abruffehler).`); continue; }
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
    const r = await sec(url, ua.value);
    if (!r.ok) {
      if (r.kind === "keine_daten") out(`◌ Keine Daten: ${r.message}`);
      else { failures++; out(`✖ Abruffehler: ${r.message}`); }
      continue;
    }
    const raw = r.json as CompanyFactsJson;
    const facts = normalizeCompanyFacts(raw);
    out(`✔ Abruf erfolgreich: ${facts.entityName} (CIK ${cik}) – [Rohdaten](${url})`);
    const concepts = (Object.keys(facts.series) as Quantity[]).map((q) => {
      const v = facts.series[q].quarters.at(-1) ?? facts.series[q].years.at(-1);
      return `${q}: ${v ? v.concept : "nicht gemeldet"}`;
    });
    out(`  Verwendete Konzepte: ${concepts.join(" · ")}`);
    const fy = facts.series.revenue.years.at(-1) ?? facts.series.operatingCashFlow.years.at(-1);
    if (fy) out(`  Geschäftsjahr: jüngstes ${de(fy.start)}–${de(fy.end)} (${fy.source.form})`);
    const present = NOT_USED_CAPEX_LIKE.filter((c) => raw.facts?.["us-gaap"]?.[c]);
    out(`  FCF-Abgrenzung: abgezogen wird nur PaymentsToAcquirePropertyPlantAndEquipment. ${present.length ? `Weitere gemeldete, NICHT abgezogene Konzepte: ${present.join(", ")}.` : "Keine der geprüften weiteren Investitions-/Leasing-Konzepte gemeldet."}`);
    out("");
    out("  Jüngste Quartale:");
    table(facts, "quarters", 5);
    out("");
    out("  Jüngste Geschäftsjahre:");
    table(facts, "years", 2);
    out("");
    out("  Auswertung mit Beispielkriterien (nur zur Kontrolle der Regeln):");
    for (const k of criteria) {
      const res = evaluateCriterion(k, facts, today);
      out(`  - ${k.metric} (${k.period}, ${k.consecutive}×): **${AUTO_STATUS_LABEL[res.status]}** – ${res.sentence}`);
    }

    // Vergleich mit der laufenden Website (gleiche Route wie „Jetzt prüfen“)
    if (websiteUp !== false) {
      try {
        const w = await fetch(`${website}/api/kennzahlen/${t}`, { signal: AbortSignal.timeout(60_000) });
        const body = (await w.json()) as { ok: boolean; message?: string; upstreamOverridden?: boolean; facts?: NormalizedFacts; stale?: boolean };
        websiteUp = true;
        if (body.upstreamOverridden) { failures++; out("  ✖ Website: Abrufe laufen über einen Testserver (FW_UPSTREAM_OVERRIDE) – Vergleich verworfen."); }
        else if (!body.ok) { failures++; out(`  ✖ Website-Route meldet: ${body.message}`); }
        else {
          const a = facts.series.revenue.quarters.at(-1), b = body.facts?.series.revenue.quarters.at(-1);
          const same = a && b && a.value === b.value && a.end === b.end && a.concept === b.concept;
          if (same || (!a && !b)) out(`  ✔ Website-Route liefert dieselben Zahlen${body.stale ? " (Hinweis: älterer Abruf, SEC gerade nicht erreichbar)" : ""}.`);
          else { failures++; out(`  ✖ Website-Route weicht ab: direkt ${a ? `${mio(a.value)} bis ${de(a.end)}` : "–"}, Website ${b ? `${mio(b.value)} bis ${de(b.end)}` : "–"}.`); }
        }
      } catch {
        websiteUp = false;
        out(`  ◌ Website unter ${website} nicht erreichbar – Routenvergleich übersprungen (zweites Terminal: npm run dev).`);
      }
    }
  }
  finish();

  function finish() {
    out("");
    out("## Abgleich von Hand (empfohlen)");
    out("Je Unternehmen einen Bericht-Link öffnen und vergleichen: Umsatz (z. B. „Total net sales“/„Total revenue“), „Operating income“,");
    out("„Net cash provided by operating activities“ und „Purchases of property and equipment“. Bei Δ-Quartalen stehen im 10-Q/10-K");
    out("nur kumulierte Cashflows (z. B. „Six Months Ended“) – der Einzelquartalswert ist die Differenz zweier Berichte.");
    out("");
    out(failures === 0 ? "Ergebnis: keine Abruffehler." : `Ergebnis: ${failures} Fehler (siehe ✖).`);
    const dir = join(ROOT, "pruefberichte-lokal");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `kennzahlen-${now.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`);
    writeFileSync(file, lines.join("\n") + "\n");
    console.log(`\nBericht gespeichert: ${file.replace(ROOT + "/", "")} (nicht im Repository)`);
    if (failures) process.exitCode = 1;
  }
}

await main();
