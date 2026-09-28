# Betrieb ohne Server: lokal jetzt, GitHub Actions als geprüfte Option

Stand: 28.09.2026. Vorgabe: keine laufenden Kosten, kein gemieteter Server, keine kostenpflichtigen Dienste.

## 1. Lokal auf dem Mac (umgesetzt)

Die Startanleitung steht in `docs/lokal-mac.md`.

**CHANGED**
- **`bot-lokal.sh`:**
  - `einrichten` legt die Konfiguration mit Zufallswerten an und überschreibt nichts.
  - `start` startet `postgres`, `redis`, `api`, `scheduler` und `backup`. Der Krypto-Worker und der Proxy laufen nicht.
  - Außerdem `status`, `logs`, `stop`, `sichern` und `wachhalten` (`caffeinate`).
- **Abrufprotokoll** (Migration `0011_ingest_runs`, append-only): Jeder SEC-Durchlauf wird mit Ergebnis gespeichert. Erfolgreich heißt: SEC erreichbar und mindestens ein Emittent abgeglichen. Die Fehlerursache wird verständlich formuliert.
- **API `GET /messages/status`:** letzter erfolgreicher und letzter versuchter Abruf, Fehlerursache, Lebenszeichen des Schedulers, Umfang des Archivs, Abrufintervall.
- **Website:** Über den Meldungen steht immer der Verbindungszustand (`src/lib/bot/connection.ts`):
  - **Bot aktiv**, mit letztem erfolgreichem Abruf;
  - **Daten veraltet** nach drei verpassten Abrufen, mit wahrscheinlicher Ursache (Ruhezustand oder Offline). Das Archiv bleibt sichtbar;
  - **Letzter Abruf fehlgeschlagen**, mit Ursache;
  - **Bot verbunden, noch kein erfolgreicher Abruf**;
  - **Bot nicht erreichbar**: Rechner aus oder schlafend, Docker gestoppt;
  - **Kein Bot verbunden**.
- **Live-Auswertung als Rückfall:** Sie erscheint nie als Bot-Erkennung. Sie hat eine eigene Überschrift („Live-Auswertung der Website, keine Bot-Erkennung“) und das Etikett „Live-Auswertung · nicht archiviert“ auf jeder Karte. Statt „Vom Bot erkannt“ steht dort „Von der Website abgerufen“.
- **Sicherheit:** Die API ist nur auf `127.0.0.1` gebunden, Postgres ohne Port. Der Proxy wird lokal nie gestartet.
- **Korrektur:** `docker-compose.yml` baut jetzt die Stufe `base`. Vorher baute es die Test-Stufe mit Entwicklerpaketen.

**TESTED**
- Python: 159 Tests grün. Neu geprüft werden Abrufprotokoll (Erfolg und Fehlschlag mit Ursache) und der Status-Endpunkt. `ruff` und `mypy` ohne Befund.
- Next.js: 180 Tests grün, davon 5 neu für die Verbindungszustände. Typprüfung ohne Befund, ESLint unverändert (5 Altfehler), Build erfolgreich.
- **Mit echtem Docker in dieser Umgebung durchgespielt:**
  - `einrichten`: idempotent, keine `.env` im Git.
  - Start aller Dienste: alle „healthy“.
  - `status` liefert den Abrufstatus.
  - **Archiv übersteht `stop`/`start` und `docker compose down`/`up`.**
  - `sichern` erzeugt einen Dump außerhalb von Git.
- **Website gegen den laufenden Docker-Bot:**
  - „Daten veraltet“ mit Archivkarte und „Vom Bot erkannt“;
  - „Bot nicht erreichbar“ bei gestopptem API-Container, mit ausschließlich als Live-Auswertung markierten Karten;
  - „Kein Bot verbunden“ ohne `BOT_API_URL`.
  - Jeweils Desktop und Smartphone, hell und dunkel.

**Grenzen der Prüfung**
- In dieser Umgebung sperrt der Proxy den Zugriff auf `sec.gov`. Der Bot hat deshalb hier echte, korrekt protokollierte **Fehlschläge** erzeugt, aber keine echten SEC-Daten geholt.
- Die Archivkarte im Test war ein von Hand eingefügter, als „Persistenztest“ beschrifteter Datensatz.
- Das Bot-Image musste hier mit dem Zertifikat des Umgebungs-Proxys gebaut werden. Auf einem Mac ist das nicht nötig.
- Auf einem echten Mac ist der Ablauf noch nicht ausprobiert.

## 2. Option GitHub Actions (geprüft, nicht eingerichtet)

**Ergebnis: technisch machbar, aber mit Umbau und offenen Entscheidungen. Kein zugesagter kostenloser Dauerbetrieb.**

### Laufzeit und Kontingent

- GitHub Free enthält für **private** Repositories 2.000 Minuten pro Monat auf GitHub-gehosteten Linux-Runnern. Jeder Job wird auf volle Minuten aufgerundet. Für **öffentliche** Repositories sind Standard-Runner kostenlos.
- **Schätzung** je Durchlauf: Checkout und Python mit Paket-Cache etwa 1 min, Postgres als Service-Container und Archiv laden unter 1 min, SEC-Abgleich für rund 10 Firmen unter 1 min. Zusammen **etwa 2–3 abgerechnete Minuten**. Das ist noch nicht gemessen.

| Takt | Durchläufe/Monat | Minuten (bei 3 min) | privat (2.000 min) |
|---|---|---|---|
| alle 2 Stunden | ~360 | ~1.080 | passt |
| stündlich | ~720 | ~2.160 | **reicht nicht** |
| alle 30 Minuten (wie lokal) | ~1.440 | ~4.320 | reicht nicht |

- **Geplante Läufe sind nicht pünktlich.** GitHub verzögert oder überspringt sie bei hoher Last. Sie laufen nur vom **Standardzweig** (Default-Branch). In öffentlichen Repositories werden sie nach 60 Tagen ohne Aktivität automatisch deaktiviert.
- Der Erkennungszeitpunkt wäre ehrlich der Zeitpunkt des Laufs, also bis zu etwa 2 Stunden nach der Veröffentlichung.

### Dauerhafte Speicherung (der eigentliche Knackpunkt)

- Jeder Runner startet leer. Actions-Cache (verdrängt nach 7 Tagen ohne Zugriff) und Artefakte (begrenzte Aufbewahrung) sind **als einzige Ablage ungeeignet**.
- **Empfehlung, wenn überhaupt:** Das Archiv wird als **nur anhängbare JSON-Lines-Datei in einem eigenen Branch** (z. B. `bot-archiv`) committet.
  - Die Git-Historie macht nachträgliche Änderungen sichtbar.
  - Kein Fremddienst nötig.
  - Jeder Lauf lädt Archiv und Abrufprotokoll in ein frisches Postgres, gleicht ab, erkennt und schreibt nur neue Zeilen zurück.
  - **Dafür fehlt noch Code:** Export und Import sowie ein kürzerer Nachladezeitraum (z. B. 30 statt 120 Tage), damit nicht jeder Lauf alles neu von der SEC holt.
- Alternative: eine kostenlose, gehostete Postgres-Stufe eines Drittanbieters. Das ist ein weiteres Konto mit eigenen, änderbaren Grenzen. Nicht ohne deine Entscheidung.

### Zugangsdaten

- Nötig wären nur `SEC_EDGAR_USER_AGENT` als Repository-Secret und die eingebaute `GITHUB_TOKEN`-Berechtigung zum Schreiben in den Archiv-Branch.
- Kein Datenbankpasswort nach außen, weil Postgres nur im Runner lebt.
- Secrets gelangen nicht in Läufe aus Forks.

### Anbindung der Website

- Vercel bräuchte keinen laufenden Bot. Die Website liest die Archivdatei und den letzten Laufstatus:
  - öffentliches Repository: über die Raw-URL;
  - privates Repository: über die GitHub-API mit einem fein eingeschränkten, nur lesenden Token als Vercel-Umgebungsvariable.
- Die Verbindungsanzeige ist dafür schon vorbereitet. Sie rechnet mit dem gemeldeten Intervall und würde „veraltet“ nach drei verpassten Läufen zeigen.
- Nur Vercel reicht nicht: Im Hobby-Tarif laufen Cron-Jobs höchstens einmal am Tag.

### Offene Entscheidungen, bevor das umgesetzt wird

1. Ist das Repository öffentlich oder privat? Davon hängen Minuten, Sichtbarkeit des Archivs und Website-Anbindung ab.
2. Darf das Archiv (öffentliche SEC-Daten mit Insidernamen) in einem Branch liegen?
3. Welcher Takt ist akzeptabel, alle 2 oder 3 Stunden?
4. Die Workflow-Datei muss auf dem Standardzweig liegen. Das heißt: Merge dieses Branches oder eine eigene kleine Workflow-Änderung dort.
