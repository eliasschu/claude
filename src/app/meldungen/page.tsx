import type { Metadata } from "next";
import Link from "next/link";
import { bot } from "@/lib/bot/client";
import { MESSAGE_KIND_LABEL } from "@/lib/services/bot-feed";
import { archiveHref, KIND_OPTIONS, parseArchiveFilters, PERIOD_OPTIONS, sinceFor } from "@/lib/bot/message-view";
import { ArchiveUnavailable } from "@/components/bot/archive-unavailable";
import { Card, Chip, EmptyState } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/finance/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meldungsarchiv – Der junge Kapitalist" };

const PAGE_SIZE = 50;
type SearchParams = Record<string, string | string[] | undefined>;

async function Coverage() {
  const cov = await bot.coverage(30);
  if (!cov.ok) return null;
  const c = cov.value.data;
  return (
    <div className="rounded-[12px] border border-line bg-surface-2 px-3.5 py-3 text-[12px] leading-relaxed">
      <p className="font-semibold">Wann der Bot tatsächlich geprüft hat</p>
      <p className="text-muted">
        {c.first_success_ever ? `Erster erfolgreicher Abruf: ${formatDateTime(c.first_success_ever)}. ` : "Noch kein erfolgreicher Abruf. "}
        In den letzten {c.window_days} Tagen: {c.successful_runs} erfolgreiche Abrufe.
        {c.gaps.length === 0
          ? " Keine Lücken über " + c.gap_threshold_minutes + " Minuten."
          : ` ${c.gaps.length} Lücke(n), in denen nichts erkannt werden konnte (Rechner aus, im Ruhezustand oder offline). Meldungen aus diesen Zeiten tragen einen späteren Erkennungszeitpunkt.`}
      </p>
      {c.gaps.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-faint">Lücken anzeigen</summary>
          <ul className="num mt-1 space-y-0.5 text-muted">
            {[...c.gaps].reverse().slice(0, 20).map((g) => (
              <li key={g.from}>{formatDateTime(g.from)} – {formatDateTime(g.to)} ({g.hours.toString().replace(".", ",")} Std.)</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export default async function ArchivePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseArchiveFilters(await searchParams);
  const res = await bot.messages({
    limit: PAGE_SIZE + 1, offset: (f.page - 1) * PAGE_SIZE,
    ticker: f.ticker, kind: f.kind, materiality: f.materiality, since: sinceFor(f.period),
  });
  const filtered = Boolean(f.ticker || f.kind || f.materiality || f.period !== "alle");

  return (
    <div className="mx-auto max-w-[900px] space-y-5">
      <header>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Meldungsarchiv</h1>
        <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">
          Alle Meldungen, die der Bot nach seinen festen Regeln erkannt hat. Nichts ist nachträglich ausgewählt: Berichtigte Meldungen
          und Fälle mit späterem Kursrückgang bleiben stehen. Trefferquoten zeigt das Archiv bewusst nicht. Dafür fehlen
          noch genug Fälle, und ein späterer Kursverlauf belegt keine Ursache.
        </p>
      </header>

      <form method="get" action="/meldungen" className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1.4fr_1fr_1fr_auto]" aria-label="Archiv filtern">
        <label className="text-[11px] text-faint">Kürzel
          <input name="ticker" defaultValue={f.ticker ?? ""} placeholder="z. B. AAPL" autoComplete="off"
            className="mt-0.5 h-10 w-full rounded-[10px] border border-line bg-surface px-2.5 text-[13px] text-ink" />
        </label>
        <label className="text-[11px] text-faint">Ereignisart
          <select name="art" defaultValue={f.kind ?? ""} className="mt-0.5 h-10 w-full rounded-[10px] border border-line bg-surface px-2 text-[13px] text-ink">
            <option value="">alle</option>
            {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-faint">Aussagekraft
          <select name="aussagekraft" defaultValue={f.materiality ?? ""} className="mt-0.5 h-10 w-full rounded-[10px] border border-line bg-surface px-2 text-[13px] text-ink">
            <option value="">alle</option><option value="hoch">hoch</option><option value="mittel">mittel</option>
          </select>
        </label>
        <label className="text-[11px] text-faint">Erkannt in
          <select name="zeitraum" defaultValue={f.period} className="mt-0.5 h-10 w-full rounded-[10px] border border-line bg-surface px-2 text-[13px] text-ink">
            {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
          <button type="submit" className="h-10 rounded-[10px] bg-accent px-4 text-[13px] font-bold text-accent-ink">Filtern</button>
          {filtered ? <Link href="/meldungen" className="flex h-10 items-center rounded-[10px] border border-line px-3 text-[13px] font-semibold">Zurücksetzen</Link> : null}
        </div>
      </form>

      {!res.ok ? (
        <ArchiveUnavailable reason={res.reason} message={res.message} />
      ) : (
        <>
          <Coverage />
          {res.value.data.length === 0 ? (
            <EmptyState
              title={filtered || f.page > 1 ? "Keine Meldungen für diese Auswahl" : "Das Archiv ist noch leer"}
              hint={filtered || f.page > 1
                ? "Für diese Filter hat der Bot nichts erkannt. Das kann auch an Zeiten liegen, in denen er nicht lief (siehe oben)."
                : "Der Bot hat noch keine Meldung nach seinen Regeln erkannt. Ein erfolgreicher Abruf ohne Treffer ist ein gültiges Ergebnis. Es wird nichts erfunden."}
            />
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {res.value.data.slice(0, PAGE_SIZE).map((m) => (
                  <li key={m.message_id}>
                    <Link href={`/meldungen/${m.message_id}`} className="block px-3.5 py-3 hover:bg-surface-2 sm:px-4">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="num text-faint">{formatDateTime(m.detected_at)}</span>
                        <Chip tone={m.kind === "insider_sale" ? "neg" : m.kind === "insider_cluster" ? "accent" : "pos"}>{MESSAGE_KIND_LABEL[m.kind]}</Chip>
                        {m.materiality ? <Chip tone="neutral">{m.materiality}</Chip> : null}
                        {m.amendment ? <Chip tone="warn">Berichtigung</Chip> : null}
                        {m.has_followups ? <Chip tone="warn">hat Folgemeldung</Chip> : null}
                      </div>
                      <p className="mt-1 text-[13px] font-semibold leading-snug">{m.title}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <nav aria-label="Seiten" className="flex items-center justify-between text-[13px]">
            {f.page > 1 ? <Link href={archiveHref({ ...f, page: f.page - 1 })} className="font-semibold text-accent">← Neuere</Link> : <span />}
            <span className="text-faint">Seite {f.page}</span>
            {res.value.data.length > PAGE_SIZE ? <Link href={archiveHref({ ...f, page: f.page + 1 })} className="font-semibold text-accent">Ältere →</Link> : <span />}
          </nav>
        </>
      )}
    </div>
  );
}
