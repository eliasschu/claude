/**
 * Kuratierte Aktienauswahl fuer die "Groesste Bewegungen"-Ansicht.
 *
 * Kein Ersatz fuer eine echte Top-500-Liste: Twelve Data erlaubt im
 * Gratistarif nur 8 Abrufe pro Minute, ein Kaltstart ueber hunderte Werte
 * wuerde eine Stunde dauern. Diese Liste bleibt deshalb bewusst klein
 * (~10 Sekunden Abstand je Wert, Kaltstart also rund anderthalb Minuten;
 * danach 5 Minuten aus dem Cache). Alle Ticker sind bei der SEC registrierte,
 * an US-Boersen gehandelte Aktien bzw. ADRs, damit Twelve Data sie sicher
 * kennt. Fuer eine echte Breite braucht es einen kostenpflichtigen
 * Massendaten-Anbieter (siehe /datenquellen).
 */
export const STOCK_MOVER_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
  "JPM", "UNH", "NVO", "ASML", "SAP",
];
