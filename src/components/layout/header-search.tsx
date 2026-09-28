"use client";

import { usePathname } from "next/navigation";
import { SmartSearch } from "./smart-search";

/** Auf Aktienseiten steht die Aktiensuche gross im Seitenkopf - dort entfaellt die Kopfzeilensuche, damit es keine zwei Suchfelder gibt. */
export const hasPageSearch = (pathname: string | null) => !!pathname && (pathname === "/aktien" || pathname.startsWith("/aktie/"));

export function HeaderSearch({ className }: { className?: string }) {
  const pathname = usePathname();
  if (hasPageSearch(pathname)) return null;
  return (
    <div className={className}>
      <SmartSearch />
    </div>
  );
}
