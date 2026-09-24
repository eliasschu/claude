/**
 * Kuratierte Liste bekannter institutioneller 13F-Filer. CIK-Nummern sind
 * öffentlich bei der SEC nachschlagbar (https://www.sec.gov/cgi-bin/browse-edgar).
 * Bewusst klein gehalten: jede weitere Person braucht eine geprüfte CIK.
 */
export interface WhaleProfile {
  slug: string;
  displayName: string;
  cik: number;
  /** Kurze, sachliche Einordnung - keine Wertung. */
  note: string;
}

export const WHALES: WhaleProfile[] = [
  {
    slug: "berkshire-hathaway",
    displayName: "Warren Buffett / Berkshire Hathaway",
    cik: 1067983,
    note: "US-Aktienbestand von Berkshire Hathaway laut eigener 13F-Meldung bei der SEC.",
  },
];

export const whaleBySlug = (slug: string) => WHALES.find((w) => w.slug === slug);
