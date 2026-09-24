/**
 * Serverseitige Konfiguration. Schluessel tragen bewusst kein
 * NEXT_PUBLIC_-Praefix und gelangen damit nie in den Browser.
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export function assertServer(module: string): void {
  if (typeof window !== "undefined") {
    throw new Error(`${module} darf nur auf dem Server laufen.`);
  }
}

export const env = {
  /** SEC verlangt einen User-Agent mit Kontaktadresse. */
  secUserAgent: () => {
    const ua = read("SEC_EDGAR_USER_AGENT");
    return ua && /@/.test(ua) ? ua : undefined;
  },
  coingeckoKey: () => read("COINGECKO_API_KEY"),
  twelveDataKey: () => read("TWELVEDATA_API_KEY"),
  eiaKey: () => read("EIA_API_KEY"),
  /** Nur fuer lokale Tests: Umleitung der Anbieteradressen auf einen Mock-Server. */
  upstreamOverride: () => read("FW_UPSTREAM_OVERRIDE"),
};

export function upstream(url: string): string {
  const override = env.upstreamOverride();
  if (!override) return url;
  const u = new URL(url);
  return `${override.replace(/\/$/, "")}/${u.host}${u.pathname}${u.search}`;
}
