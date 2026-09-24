import Link from "next/link";
import { Bell, Bookmark, Fish, LineChart, Newspaper, TrendingUp, UserRound } from "lucide-react";
import { SmartSearch } from "./smart-search";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";

/** Eigene Wortmarke – bewusst rein typografisch mit einem gezeichneten Zeichen. */
function Wordmark() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Der junge Kapitalist, zur Startseite">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
        <rect x="1" y="12" width="4" height="9" rx="1.2" fill="var(--ink-faint)" />
        <rect x="7" y="7" width="4" height="14" rx="1.2" fill="var(--ink-muted)" />
        <rect x="13" y="1" width="4" height="20" rx="1.2" fill="var(--accent)" />
      </svg>
      <span className="hidden text-[15px] font-extrabold tracking-[-0.03em] sm:inline">
        Der junge Kapitalist<span className="text-accent">.</span>
      </span>
      <span className="text-[15px] font-extrabold tracking-[-0.03em] sm:hidden">
        DjK<span className="text-accent">.</span>
      </span>
    </Link>
  );
}

/**
 * Hauptnavigation mit Textbeschriftung - Symbole stehen nur zusaetzlich
 * daneben, nie als einziges Erkennungsmerkmal. "Große Fische" und "Deals"
 * fuehren vorlaeufig beide auf /tracker (die einzige echte Insider-Liste,
 * die es bisher gibt), bis die eigenen Seiten dafuer gebaut sind.
 */
const PRIMARY_NAV = [
  { href: "/", label: "Start", icon: null },
  { href: "/tracker", label: "Große Fische", icon: Fish },
  { href: "/tracker", label: "Deals", icon: TrendingUp },
  { href: "/maerkte", label: "Märkte", icon: LineChart },
  { href: "/watchlist", label: "Watchlist", icon: Bookmark },
];

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
      className={cn(
        wideOnly ? "hidden sm:inline-flex" : "inline-flex",
        "h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface text-muted transition-colors hover:text-ink",
      )}
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

          <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label="Hauptbereiche">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-semibold text-muted hover:bg-surface-2 hover:text-ink"
              >
                {item.icon ? <item.icon size={15} aria-hidden /> : null}
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
            <IconLink href="/nachrichten" label="Nachrichten" wideOnly>
              <Newspaper size={17} aria-hidden />
            </IconLink>
            <IconLink href="/portfolio" label="Portfolio und Benachrichtigungen" wideOnly>
              <Bell size={17} aria-hidden />
            </IconLink>
            <IconLink href="/datenquellen" label="Datenquellen und Profil" wideOnly>
              <UserRound size={17} aria-hidden />
            </IconLink>
            <ThemeToggle />
          </div>
        </div>

        <div className="mt-2.5 md:hidden">
          <SmartSearch />
        </div>

        <nav className="rail mt-2.5 flex gap-1.5 overflow-x-auto lg:hidden" aria-label="Hauptbereiche">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-muted hover:text-ink"
            >
              {item.icon ? <item.icon size={14} aria-hidden /> : null}
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
