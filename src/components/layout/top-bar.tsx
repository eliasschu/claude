import Link from "next/link";
import { Bell, Bookmark, Landmark, Newspaper, UserRound } from "lucide-react";
import { SmartSearch } from "./smart-search";
import { ThemeToggle } from "./theme-toggle";

/** Eigene Wortmarke – bewusst rein typografisch mit einem gezeichneten Zeichen. */
function Wordmark() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Finanzwelt-App, zur Startseite">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
        <rect x="1" y="12" width="4" height="9" rx="1.2" fill="var(--ink-faint)" />
        <rect x="7" y="7" width="4" height="14" rx="1.2" fill="var(--ink-muted)" />
        <rect x="13" y="1" width="4" height="20" rx="1.2" fill="var(--accent)" />
      </svg>
      <span className="text-[15px] font-extrabold tracking-[-0.03em]">
        Finanzwelt<span className="text-accent">.</span>
      </span>
    </Link>
  );
}

function IconLink({
  href,
  label,
  children,
  wideOnly = false,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  wideOnly?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`${wideOnly ? "hidden sm:inline-flex" : "inline-flex"} h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface text-muted transition-colors hover:text-ink`}
    >
      {children}
    </Link>
  );
}

export function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto w-full max-w-[1180px] px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <Wordmark />

          <div className="hidden min-w-0 flex-1 md:block">
            <SmartSearch />
          </div>

          <nav className="ml-auto flex items-center gap-1.5" aria-label="Hauptbereiche">
            <Link href="/maerkte" className="hidden h-9 items-center rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold text-muted hover:text-ink sm:inline-flex">
              Märkte
            </Link>
            <IconLink href="/nachrichten" label="Nachrichten">
              <Newspaper size={17} aria-hidden />
            </IconLink>
            <IconLink href="/tracker" label="Politiker- und Investorentracker">
              <Landmark size={17} aria-hidden />
            </IconLink>
            <IconLink href="/watchlist" label="Watchlist">
              <Bookmark size={17} aria-hidden />
            </IconLink>
            <IconLink href="/portfolio" label="Portfolio und Benachrichtigungen" wideOnly>
              <Bell size={17} aria-hidden />
            </IconLink>
            <IconLink href="/datenquellen" label="Datenquellen und Profil" wideOnly>
              <UserRound size={17} aria-hidden />
            </IconLink>
            <ThemeToggle />
          </nav>
        </div>

        <div className="mt-2.5 md:hidden">
          <SmartSearch />
        </div>
      </div>
    </header>
  );
}
