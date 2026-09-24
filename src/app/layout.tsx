import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TopBar } from "@/components/layout/top-bar";
import { SiteFooter } from "@/components/layout/site-footer";
import { WatchlistProvider } from "@/components/watchlist/watchlist-provider";

export const metadata: Metadata = {
  title: "Der junge Kapitalist – Märkte, Bewertung und Nachrichten",
  description:
    "Deutschsprachige Finanzplattform für Privatanleger: Marktleiste, Fair-Value-Modell, Nachrichten und Insider-Meldungen – mit Quelle und Datenstand an jedem Wert.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1412" },
  ],
};

/** Setzt den Modus vor dem ersten Anstrich, damit nichts aufblitzt. */
const themeScript = `
(function(){
  try {
    var stored = localStorage.getItem('fw-theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap"
        />
      </head>
      <body className="min-h-dvh antialiased">
        <a
          href="#inhalt"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-[8px] focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px] focus:shadow"
        >
          Zum Inhalt springen
        </a>

        <WatchlistProvider>
          <TopBar />
          <main id="inhalt" className="mx-auto w-full max-w-[1180px] px-4 pb-4 pt-5 sm:px-6">
            {children}
          </main>
          <SiteFooter />
        </WatchlistProvider>
      </body>
    </html>
  );
}
