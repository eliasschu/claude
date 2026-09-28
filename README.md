# Der junge Kapitalist

Persönliches Recherche- und Beobachtungswerkzeug für deutschsprachige Privatanleger. Das Hauptprodukt ist ein **Bot**. Er erkennt relevante öffentliche Informationen, ordnet sie verständlich ein und nennt Unsicherheit, Gegenargumente und Originalquelle.

Geplanter Ablauf: **Ereignis entdecken → Unternehmen verstehen → Erwartungen untersuchen → eigene These festhalten → spätere Veränderungen überprüfen.** Heute funktioniert davon der erste Schritt und Teile des zweiten. Das Gesamtkonzept und der Stand je Baustein stehen in `docs/architektur/06-gesamtkonzept.md`.

> Keine Anlageberatung, keine Kauf- oder Verkaufsempfehlungen, kein Handel mit Kundengeldern. Die interne Handelssignal-Engine läuft nur im Research- und Paper-Betrieb und ist nicht öffentlich.

## Bestandteile

| Teil | Ordner | Aufgabe |
|---|---|---|
| Website | `src/` (Next.js 16) | Anzeige, Erklärung, Suche, Watchlist im Browser. Rechnet Bewertungen aus Jahresabschlüssen |
| Bot | `services/quant/` (Python, FastAPI, PostgreSQL) | Holt SEC-Insidermeldungen, wertet sie nach festen Regeln aus und speichert jede Erkennung unveränderlich im Archiv. Enthält außerdem die interne Signal-Engine (Paper) |

## Lokal starten (ohne Server, ohne laufende Kosten)

```bash
./bot-lokal.sh einrichten   # einmalig: Konfiguration mit Zufallswerten, fragt nach Name und E-Mail für die SEC
./bot-lokal.sh start        # Bot und Datenbank in Docker, nur auf 127.0.0.1
npm install && npm run dev  # Website auf http://localhost:3000
./bot-lokal.sh pruefen      # Betriebsprüfung mit Bericht
```

Details stehen in `docs/lokal-mac.md`. **Der Bot erkennt nur, solange der Rechner eingeschaltet, wach und online ist.** Die öffentliche Website kann das lokale Archiv nicht erreichen.

## Prüfen

```bash
npm test && npm run typecheck && npm run lint && npm run build
cd services/quant && pytest -q && ruff check quant tests && mypy quant   # Datenbanktests brauchen ein lokales PostgreSQL
```

## Datenquellen

| Bereich | Quelle | Schlüssel | Hinweis |
|---|---|---|---|
| Insider, Jahresabschlüsse, 13F | SEC EDGAR | `SEC_EDGAR_USER_AGENT` (Name und E-Mail) | kostenlos, nur bei der SEC registrierte Unternehmen |
| Aktienkurse | Twelve Data | `TWELVEDATA_API_KEY` | Gratistarif **nur private Nutzung** |
| Krypto | CoinGecko | `COINGECKO_API_KEY` (Demo) | Namensnennung Pflicht |
| Zinsen, Devisen, Öl | EZB, US-Finanzministerium, EIA | `EIA_API_KEY` | kostenlos |

Die vollständige Übersicht mit Lizenzen und Lücken steht in der App unter `/datenquellen`.

## Hinweise

- Speicherschlüssel im Browser beginnen aus historischen Gründen mit `fw-`, von „Finanzwelt“. Sie bleiben so, damit vorhandene Watchlists nicht verloren gehen.
- Zugangsdaten stehen nur in `.env`, `.env.local` und `services/quant/.env`. Alle drei sind in `.gitignore` und werden nie committet.
