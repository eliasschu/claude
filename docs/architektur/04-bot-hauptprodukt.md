# Neuausrichtung: Der Bot als Hauptprodukt

Stand: 28.09.2026. Aktienanalysen, Insiderdaten, Prognosemärkte und Nachrichten sind Hintergrund. Sie machen nachvollziehbar, was der Bot meldet.

## Bestandsaufnahme (kurz)

| Bereich | Stand | Bedeutung für den Bot |
|---|---|---|
| Insider (Form 4) | Frontend: Klassifikation, Aussagekraft, Cluster (`lib/services/insider.ts`, `finance/insider-materiality.ts`). Python: Point-in-Time-Ingest mit `received_at` | **Einzige heute öffentlich funktionierende Erkennung.** Grundlage der ersten Bot-Meldungen |
| Marktsignal-Engine | `services/quant`: Strategien, Risk Engine, Signalprotokoll mit Hash-Kette, Outcomes, Backtest, Shadow | Gebaut und getestet, **nicht im Dauerbetrieb**. Signale bleiben bis zur rechtlichen Prüfung intern |
| Krypto-Derivate (Funding, OI, Liquidationen) | Python-WebSocket-Ingest | Daten vorhanden, Meldung fehlt |
| Makro (FRED/ALFRED, CFTC) | Python | Daten vorhanden, Meldung fehlt |
| Aktienseite | Kopf, Chart (nur Schlusskurse), DCF-Modell, Scorecard v1, SEC-Meldungen | Hintergrund. Umbau laut `03-aktienseite-entwurf.md` |
| Suche | Kopfzeilen-Combobox über Aktien, Krypto und Märkte | Aktiensuche fehlte als eigenes, gut sichtbares Feld |
| Watchlist | nur lokal (localStorage) | bleibt kostenlos |
| Konten, Alarme, Zahlung | nicht vorhanden | Voraussetzung für Plus/Pro |

## Widersprüche und offene Punkte

1. **Tarife:** `/datenquellen` beschreibt noch das alte Modell: Plus = höherer Kurstarif, Pro = Analystenkonsens und Top-500. Neu gilt: Plus = persönlicher Feed, synchronisierte Watchlist, Standardalarme; Pro = Filter, individuelle Alarme, historische Auswertungen. Die Angabe wird in Etappe 5 angepasst. Bis Konten existieren, wird nichts davon als verfügbar beworben.
2. **Kursdaten:** Der Twelve-Data-Gratistarif erlaubt nur private, nicht-öffentliche Nutzung. Für einen öffentlichen Betrieb mit Abos braucht es einen lizenzierten Anbieter. Das kostet und wird **nicht ohne Auftrag** gebucht.
3. **Bot-Signale öffentlich:** Nach der eigenen Vorgabe gilt Research/Paper bis zur rechtlichen Prüfung. Die Startseite zeigt deshalb nur Insider-Erkennungen, keine Handelssignale.
4. **Erkennungszeitpunkt:** Das Frontend hat keine Datenbank. „Vom Bot erkannt“ ist heute der Zeitpunkt des Datenabrufs, zu dem die Meldung vorlag. Ein dauerhafter *erster* Erkennungszeitpunkt und ein Archiv brauchen den Python-Dienst im Dauerbetrieb (Etappe 2).
5. **Beobachtungsliste:** Nur 8 US-Aktien. Mehr Firmen bedeuten mehr SEC-Abrufe. Das ist machbar, braucht aber die Umstellung auf `companyfacts`, Caching und die Korrektur der Drosselung (siehe `03`, Etappe 0).

## Etappenplan (priorisiert)

| # | Etappe | Inhalt | Kosten / Voraussetzung |
|---|---|---|---|
| **1** | **Aktiensuche und Startseite auf den Bot ausrichten** | Siehe Ergebnis unten | keine |
| 2 | Dauerbetrieb und Meldungsarchiv | Python-Dienst auf Hetzner (Paper/Shadow). Insider-Erkennung als Bot-Meldung mit festem `detected_at` in Postgres, unveränderlich. API `GET /messages`, `GET /messages/{id}` | Server (Hetzner) nach Auftrag |
| 3 | Detailseite je Meldung | Quellen, Beobachtungen, Gegenargumente, späterer Kursverlauf ab Veröffentlichung, Handel und Veröffentlichung getrennt. Archiv nach festen Regeln inklusive erfolgloser Fälle. Simulation und laufende Erfassung getrennt | Etappe 2 |
| 4 | Aktienseite: Reihenfolge und „Was hat der Bot hier erkannt?“ | Kopf, Scoreboard, höchstens 6 Kennzahlen, Chart, bis zu 3 Bot-Meldungen, darunter Insider, Nachrichten, Prognosemärkte. Bewertung und Bot getrennt. Vorher Ladezeit (Etappe 0 aus `03`) | keine |
| 5 | Tarifseite (nur Beschreibung) | Kostenlos, Plus und Pro als „geplant“, keine Buchung. `/datenquellen` wird bereinigt | keine |
| 6 | Weitere Erkennungen | Überhitzte Hebel-Positionierung (Krypto), Makro-Lage, Kongress-Meldungen | keine (freie Quellen) |
| 7 | Konten, synchronisierte Watchlist, Standardalarme (Plus) | Anmeldung, Datenbank, Benachrichtigungsweg | Auftrag nötig (E-Mail-/Push-Dienst) |
| 8 | Pro: Filter, individuelle Alarme, historische Auswertungen | nur aus laufend erfassten Meldungen | Etappen 2 und 7 |
| 9 | Prognosemärkte | erst nach Lizenz- und DSGVO-Prüfung | offen |

## Etappe 1: Ergebnis

**CHANGED**
- **Startseite** (`src/app/page.tsx`):
  - Oben stehen Nutzen, die Aktionen „Bot entdecken“ und „Beispiel ansehen“ sowie ein ehrlicher Betriebszustand aus der Bot-API. Ohne API steht dort: „Marktsignal-Engine nicht im Dauerbetrieb“.
  - Darauf folgen eine **echte aktuelle Beispielmeldung** und höchstens fünf weitere Ereignisse.
  - Jede Karte zeigt: was passiert ist, warum es relevant ist, welche Unsicherheit besteht. Dazu Handels-, Veröffentlichungs- und Erkennungszeitpunkt getrennt, sowie die Quellen.
  - Gibt es keine passenden Ereignisse, erscheint ein Hinweis statt Demodaten.
  - Marktleiste, Deals der Woche, Große Fische und Termine bleiben darunter erhalten.
  - „Deal der Woche“ wird dort nicht mehr angezeigt, weil die Beispielmeldung ihn ersetzt. Die Datei `deal-of-week.tsx` bleibt als Baustein für die Detailseite (Etappe 3).
- **Auswahlregeln** (`src/lib/services/bot-feed.ts`):
  - nur Käufe und Verkäufe am offenen Markt mit Aussagekraft hoch oder mittel, höchstens 14 Tage alt;
  - Cluster ergeben eine Meldung je Firma;
  - Rangfolge: Cluster, dann Kauf, dann Verkauf, dann Betrag, dann Aktualität;
  - höchstens 5 Meldungen, es wird nichts aufgefüllt.
- **Neue Seite `/bot`:**
  - Fähigkeiten mit ehrlichem Status: läuft öffentlich, gebaut aber nicht öffentlich, Daten vorhanden aber Meldung fehlt, geplant.
  - Aufbau einer Meldung, Auswahlregeln (aus den Code-Konstanten), was der Bot nicht tut.
  - Nachvollziehbarkeit ist ausdrücklich als „noch nicht verfügbar“ markiert.
- **Aktiensuche:**
  - Neue Seite `/aktien` mit großer Suche und der Beobachtungsliste. Die Liste lädt ohne Kursabruf und steht deshalb sofort.
  - Die Suche steht auch oben auf jeder Aktienseite, beim Laden, bei „nicht gefunden“ und im Fehlerfall.
  - Auf diesen Seiten entfällt die Kopfzeilensuche, damit es keine zwei Suchfelder gibt.
  - `/api/search?scope=stock` sucht nur Aktien und fragt keine Kryptoquelle ab. Mehrwortsuchen verlangen alle Wörter.
  - Die Treffer zeigen Name, Kürzel und Börse.
  - Die Combobox hat `aria-activedescendant`, eindeutige IDs je Instanz und eine Live-Region.
  - Lade-, Leer- und Fehlerzustand sind getrennt. Ein Quellenausfall erscheint als Hinweis und nicht als „kein Treffer“.
- **Aktienseite:** Ein Quellenausfall zeigt jetzt einen Fehler statt „Aktie nicht gefunden“. Vorher wurde jeder Fehler als „nicht gefunden“ angezeigt.
- **Navigation:**
  - Reihenfolge: Start, Bot, Aktien, Insider (vorher „Deals“), Große Fische, Märkte, Watchlist.
  - Die Navigation steht jetzt immer in einer zweiten Zeile. Vorher war das Suchfeld am Desktop dadurch auf wenige Pixel zusammengedrückt.

**TESTED**
- `npm test`: 174 Tests grün, davon 8 neu (`src/tests/bot-feed.test.ts`). Sie prüfen:
  - Pflichtfelder und getrennte Zeiten;
  - keine Auffüllung;
  - Limit und Rangfolge;
  - Cluster und Zusammenfassung;
  - unbekannten Plan als Unsicherheit;
  - Aktiensuche nach Name und Kürzel mit Börse, ohne Kryptoabruf;
  - Quellenausfall als Hinweis.
- `tsc --noEmit` ohne Befund.
- ESLint: 5 Fehler und 1 Warnung, alle in Dateien, die diese Etappe nicht berührt. Vorher waren es 7 Fehler. Die 2 Fehler der alten Suche sind behoben.
- `next build` erfolgreich, ohne Netz und gegen nachgebildete Daten.
- Browserprüfung mit Playwright und Chromium, 1280 × 900 und 390 × 844, jeweils hell und dunkel:
  - Startseite, `/bot`, `/aktien`, Aktienseite, Laden, „nicht gefunden“, kein Treffer;
  - Tastaturbedienung der Suche (Pfeiltaste, Enter navigiert);
  - der Anker „Beispiel ansehen“;
  - keine JavaScript-Fehler. Nur Google Fonts scheitert am Zertifikat des Umgebungs-Proxys.

**Wichtig zur Prüfung:** In dieser Umgebung sind SEC und andere Anbieter nicht erreichbar. Die Browserprüfung lief deshalb gegen einen **lokalen Nachbau des SEC-Formats mit fiktiven Testfirmen**. Er liegt nur im Scratchpad und nicht im Repository. Gegen die echte SEC ist die Startseite noch nicht geprüft.

**Was noch fehlt**
- Kein dauerhafter Erkennungszeitpunkt, kein Archiv und keine Detailseiten (Etappen 2 und 3).
- Die Aktienseite ist inhaltlich noch nicht umgebaut (Etappe 4).
- Die Tarifangaben auf `/datenquellen` sind noch alt (Etappe 5).
- Die Beobachtungsliste umfasst nur 8 Aktien.

## Etappe 2: Ergebnis (Code und Anleitung, Serverbetrieb noch offen)

**Nicht durchgeführt:** Einen Hetzner-Server anlegen und starten kann ich aus dieser Umgebung nicht. Mir fehlen Zugang zum Hetzner-Konto und SSH-Schlüssel. Außerdem entstehen dabei laufende Kosten. Alles andere ist vorbereitet. Die Schritte stehen in `deploy/hetzner/README.md`, Abschnitte 1 bis 5b.

**CHANGED**
- **Migration `0010_bot_messages`:** neue Tabelle `bot_messages`, append-only per Trigger, mit Schlüssel `dedup_key`, damit jede Erkennung nur einmal gespeichert wird.
  - Getrennt gespeichert: `traded_from/to` (Handel), `published_at` (SEC-Annahme), `detected_at` (erste Erkennung durch den Bot, nie überschrieben).
  - Außerdem Beobachtungen (Einzelangaben je Meldung), Gegenargumente, Quellen (Index der SEC-Einreichung), Auswahlgrund, `rule_version` und `content_hash`.
  - `insider_transactions` hat zusätzlich `issuer_name`.
- **`quant/messages.py`:** dieselben Regeln wie auf der Website.
  - Kauf ohne Plan ergibt Aussagekraft hoch.
  - Verkauf ohne Plan ab 1 Mio. $ oder 5 % des Bestands ergibt mittel.
  - Mindestens 2 Insider mit Käufen innerhalb von 14 Tagen ergeben eine Cluster-Meldung je Firma.
  - Nur Veröffentlichungen der letzten 14 Tage. Nur, was zum Zeitpunkt bekannt war (`GREATEST(available_at, received_at) <= now`).
- **Scheduler:** Nach jedem SEC-Abruf (alle 30 min) läuft `detect_insider_messages` mit der Bot-Uhr **nach** dem Abruf.
- **API:** `GET /messages` (Filter `ticker`, `since`, `limit`) und `GET /messages/{id}`, tokengeschützt.
- **Website:**
  - Die Startseite liest zuerst das Archiv. Dann heißt es „Vom Bot erkannt“ mit festem Zeitpunkt, und darüber steht ein Hinweis zur Herkunft.
  - Ohne Bot-API wendet sie dieselben Regeln live auf die SEC-Daten an und kennzeichnet das klar („Abgerufen“, „noch kein fester Erkennungszeitpunkt“).
- **Anleitung:** Meldungsarchiv prüfen, Vercel mit dem Bot verbinden.

**TESTED**
- Python: 158 Tests grün, davon 7 neu in `tests/test_messages.py`. Sie prüfen:
  - Regeln (Cluster, großer Verkauf; kein Treffer für Plan-Kauf, kleinen Verkauf oder zu alte Meldung);
  - erste Erkennung bleibt bestehen, keine Doppelarchivierung, drei getrennte Zeitpunkte;
  - erst Einzelkauf, später Cluster ergibt eine neue Meldung;
  - vor Eingang der Meldung wird nichts erkannt;
  - UPDATE und DELETE werden abgewiesen;
  - API mit Token, 401 ohne Token, 404 bei unbekannter ID.
- `ruff` und `mypy` ohne Befund.
- Next.js: 175 Tests grün, davon einer neu für die Archivzuordnung. Typprüfung ohne Befund, ESLint unverändert 5 Altfehler, `next build` erfolgreich.
- **End-to-End lokal:** echtes Postgres, Ingest mit nachgebildeten EDGAR-Antworten (fiktive Testfirma), Erkennung, echte FastAPI mit Token, Next.js-Produktionsbuild. Die Startseite zeigt die Archivmeldung mit „Vom Bot erkannt“ und den richtigen getrennten Zeiten.

**Offen**
- Den Serverbetrieb musst du starten (siehe oben). Erst dann entsteht ein echtes, lückenloses Archiv. Ein Archiv für die Vergangenheit lässt sich nicht nachträglich ehrlich erzeugen.
- Ein Cluster, der später um einen dritten Insider wächst, bekommt keine neue Meldung. Er bleibt die Meldung vom ersten Erkennen.
- Die Beobachtungsliste des Bots (`EQUITY_SYMBOLS`, Standard: SPY, QQQ, AAPL, MSFT, NVDA, AMZN, META, GOOGL, TSLA, AMD) weicht leicht von der Website-Liste ab (dort mit JPM statt AMD). Das ist beim Deploy per Umgebungsvariable wählbar.
- Detailseite je Meldung mit späterem Kursverlauf folgt in Etappe 3.

## Nachtrag: kein Server

Für den Start wird kein Server gemietet. Der Bot läuft lokal auf dem Mac (`./bot-lokal.sh`, `docs/lokal-mac.md`). GitHub Actions ist als Option geprüft, aber nicht eingerichtet (`05-betrieb-ohne-server.md`). Die Hetzner-Anleitung bleibt für später erhalten.
