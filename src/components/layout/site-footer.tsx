import Link from "next/link";

export const RISK_NOTICE =
  "Die dargestellten Informationen, Modellbewertungen und Kennzahlen dienen ausschließlich Informationszwecken und stellen keine Anlageberatung oder Empfehlung zum Kauf oder Verkauf von Finanzinstrumenten dar. Der Wert von Kapitalanlagen kann schwanken; vergangene Entwicklungen sind kein verlässlicher Hinweis auf künftige.";

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-line bg-surface-2">
      <div className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6">
        <div className="rounded-[14px] border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-[13px] font-bold">Risikohinweis</h2>
          <p className="mt-2 max-w-[74ch] text-[13px] leading-relaxed text-muted">{RISK_NOTICE}</p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-faint">
          <Link href="/datenquellen" className="hover:text-ink">
            Datenquellen und Methodik
          </Link>
          <Link href="/nachrichten" className="hover:text-ink">
            Nachrichten
          </Link>
          <Link href="/tracker" className="hover:text-ink">
            Tracker
          </Link>
          <Link href="/watchlist" className="hover:text-ink">
            Watchlist
          </Link>
          <Link href="/maerkte" className="hover:text-ink">
            Märkte
          </Link>
          <span className="ml-auto">Finanzwelt-App</span>
        </div>
      </div>
    </footer>
  );
}
