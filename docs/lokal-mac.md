# Bot lokal auf dem Mac starten

Ohne Server und ohne laufende Kosten, nur mit deinem eigenen Strom. Bot und Datenbank laufen in Docker auf deinem Mac. Das Meldungsarchiv bleibt über Neustarts erhalten.

## Was du wissen musst

- **Der Bot erkennt nur, solange der Mac eingeschaltet, wach und online ist.** Er ruft alle 30 Minuten neue SEC-Insidermeldungen ab.
- Im Ruhezustand, bei zugeklapptem MacBook ohne Netzteil und externen Bildschirm oder ohne Internet passiert nichts.
- Was in dieser Zeit veröffentlicht wurde, holt der Bot beim nächsten Abruf nach. Die Meldung trägt dann den **späteren, tatsächlichen** Erkennungszeitpunkt. Es wird nichts rückdatiert.
- Die Website zeigt über den Meldungen immer an:
  - den letzten erfolgreichen Abruf;
  - „veraltet“, wenn drei Abrufe in Folge fehlen (90 Minuten);
  - „Bot nicht erreichbar“, wenn er gar nicht antwortet.
- Die öffentliche Website auf Vercel erreicht deinen Mac **nicht**, und das ist so gewollt. Der Bot lauscht nur auf `127.0.0.1`, also nur auf deinem Rechner. Die Datenbank hat gar keinen Port. Nichts wird ins Internet geöffnet. Das Archiv siehst du über die Website, die du lokal startest.

## Einmalig einrichten (etwa 10 Minuten)

1. **Docker installieren.** Eine der beiden Möglichkeiten:
   - [Docker Desktop](https://www.docker.com/products/docker-desktop/): kostenlos für private Nutzung. In den Einstellungen „Start Docker Desktop when you sign in“ aktivieren, damit der Bot nach einem Neustart von selbst weiterläuft.
   - oder Colima (Open Source): `brew install colima docker docker-compose && colima start`
2. **Node.js 22** für die Website: `brew install node@22`
3. Im Projektordner:

   ```bash
   ./bot-lokal.sh einrichten
   ```

   Das Skript fragt nach Name und E-Mail. Die SEC verlangt beides bei jedem Abruf. Es legt `.env`, `services/quant/.env` und `.env.local` mit Zufallspasswort und Zufalls-Token an. Vorhandene Werte werden nie überschrieben. Alle drei Dateien stehen in `.gitignore`.

## Starten und benutzen

```bash
./bot-lokal.sh start      # Datenbank, Bot-API, Scheduler und tägliche Sicherung im Hintergrund
npm install && npm run dev   # zweites Terminal: Website auf http://localhost:3000
```

Der erste Start baut das Bot-Image, das dauert einige Minuten. Danach geht es schneller. Der erste Abruf lädt 120 Tage Insidermeldungen nach. Als Meldung erscheinen davon nur die Veröffentlichungen der letzten 14 Tage.

| Befehl | Wirkung |
|---|---|
| `./bot-lokal.sh status` | Container-Zustand, letzter erfolgreicher und letzter versuchter Abruf, Anzahl archivierter Meldungen |
| `./bot-lokal.sh logs` | laufende Protokolle (Strg+C beendet nur die Anzeige) |
| `./bot-lokal.sh stop` | anhalten, das Archiv bleibt erhalten |
| `./bot-lokal.sh sichern` | Datenbank-Sicherung nach `backups-lokal/` (nicht im Git) |
| `./bot-lokal.sh wachhalten` | verhindert den Ruhezustand, solange das Fenster offen ist (`caffeinate`). Ein zugeklapptes MacBook schläft trotzdem, außer am Netzteil mit externem Bildschirm |

## Wo das Archiv liegt

Das Archiv liegt im Docker-Volume `claude_pgdata`. Es übersteht `stop`/`start`, einen Neustart des Macs und `docker compose down`.

**Gelöscht wird es nur durch `docker compose down -v` oder durch Löschen des Volumes. Das nie ohne Sicherung tun.**

Wiederherstellen aus einer Sicherung:

```bash
docker compose exec -T postgres pg_restore -U quant -d quant --clean < backups-lokal/quant-DATUM.dump
```

## Wenn etwas nicht geht

| Anzeige auf der Website | Ursache | Abhilfe |
|---|---|---|
| Kein Bot verbunden | `.env.local` fehlt | `./bot-lokal.sh einrichten`, dann `npm run dev` neu starten |
| Bot nicht erreichbar | Docker läuft nicht oder der Bot ist gestoppt | Docker starten, `./bot-lokal.sh start` |
| Daten veraltet | Der Mac hat geschlafen oder war offline | nichts: Der nächste Abruf holt nach. Sonst `./bot-lokal.sh logs` |
| Letzter Abruf fehlgeschlagen: SEC lehnt ab | Name und E-Mail fehlen | `SEC_EDGAR_USER_AGENT` in `services/quant/.env` prüfen |
