# Erster Dauerlauf auf einem Server (Standard: Hetzner Cloud, EU)

Der Anwendungscode kennt Hetzner nicht. Alles läuft über Docker Compose und Umgebungsvariablen. Jeder andere Linux-Server mit Docker funktioniert genauso (AWS, Railway/Fly mit angepassten Diensten, später Kubernetes).

**Betriebsart:** `LIVE_DATA=true`, `LIVE_TRADING=false`. Echte Marktdaten, echte Zyklen, echte Datenbank, aber **keine echten Orders**. Alles läuft als Paper- bzw. Shadow-Ausführung.

## 1. Server anlegen

- Typ: z. B. **CX22** (2 vCPU, 4 GB RAM) für den MVP. Postgres, Worker, Scheduler und ws-ingestor passen darauf.
- Standort: **EU** (Falkenstein, Nürnberg oder Helsinki), Image: Ubuntu 24.04. Den SSH-Schlüssel beim Anlegen hinterlegen.
- Optional eine Hetzner-Cloud-Firewall: eingehend nur 22, 80, 443.

> **Region und Börsen:** Binance und andere Anbieter sperren einzelne Regionen oder Produkte. Nach dem ersten Start `/health/system` prüfen. Meldet Binance `down` (HTTP 451/403), springt Coinbase für Spot-Daten ein, und das System meldet DEGRADED statt DOWN. Derivatedaten (Funding, OI) fehlen dann. Die betroffenen Strategien sagen NO_TRADE.

## 2. Grundinstallation

```bash
scp deploy/hetzner/setup.sh root@SERVER:/root/
ssh root@SERVER 'bash /root/setup.sh bot'
```

Das Skript installiert:
- Docker
- ufw (nur 22, 80, 443)
- fail2ban
- automatische Sicherheitsupdates

Es legt außerdem einen Nicht-root-Benutzer an und sperrt Passwort- und root-Login.

## 3. Code und Konfiguration

```bash
ssh bot@SERVER
git clone <repo> app && cd app
cp .env.compose.example .env                          # POSTGRES_PASSWORD setzen (lang, zufällig)
cp services/quant/.env.example services/quant/.env    # DATABASE_URL (gleiches Passwort), BOT_API_TOKEN, SEC_EDGAR_USER_AGENT, FRED_API_KEY
chmod 600 .env services/quant/.env
```

Zufallswerte erzeugen: `openssl rand -hex 32`. Beide `.env`-Dateien sind in `.gitignore` und dürfen nie committet werden.

## 4. Start

```bash
docker compose up -d --build                          # postgres, redis, api, bot-worker, scheduler, backup
docker compose --profile websockets up -d             # zusätzlich WebSockets (danach EXPECT_WEBSOCKETS=true)
docker compose --profile proxy up -d                  # HTTPS für die API (API_DOMAIN in .env, DNS A-Record)
docker compose ps                                     # alle Dienste "healthy"
```

## 5. Prüfen

```bash
curl -s localhost:8000/health/ready                                             # {"state": "HEALTHY" | "DEGRADED" | "UNHEALTHY"}
curl -s -H "Authorization: Bearer $BOT_API_TOKEN" localhost:8000/health/system  # je Komponente
curl -s -H "Authorization: Bearer $BOT_API_TOKEN" localhost:8000/metrics        # Prometheus-Format
docker compose logs -f bot-worker                                               # JSON-Logs, eine Zeile je Ereignis
```

| Zustand | Bedeutung |
|---|---|
| HEALTHY | Alles läuft |
| DEGRADED | Dienst läuft eingeschränkt: Ersatzquelle aktiv, WebSocket getrennt oder Kill Switch aktiv (keine neuen Orders) |
| UNHEALTHY | Datenbank weg, Worker oder Scheduler ohne Heartbeat, oder **keine** Marktdatenquelle mehr erreichbar |

Docker startet einen Dienst nur bei UNHEALTHY neu. Ein Anbieterausfall führt so nicht zu einem Neustart-Kreislauf.

## 6. Backups

Der `backup`-Dienst schreibt täglich ein `pg_dump` in das Volume `backups` und löscht Dumps nach 14 Tagen.

**Das Volume liegt auf demselben Server.** Das schützt vor Bedienfehlern, nicht vor einem Serverausfall. Deshalb zusätzlich eine externe Kopie anlegen, z. B. auf eine Hetzner Storage Box:

```bash
# crontab -e (Benutzer bot)
30 3 * * * docker run --rm -v app_backups:/b:ro -v $HOME/.ssh:/root/.ssh:ro alpine sh -c \
  "apk add -q rsync openssh && rsync -a -e 'ssh -p 23' /b/ uXXXXX@uXXXXX.your-storagebox.de:quant-backups/"
```

Wiederherstellung testen, bevor man sich darauf verlässt:

```bash
docker compose exec -T postgres pg_restore -U quant -d quant_restore_test --create < backup.dump
```

## 7. Updates

```bash
git pull && docker compose up -d --build
```

Die Migrationen laufen beim Start automatisch. Sie sind race-sicher, auch wenn mehrere Dienste gleichzeitig starten.

## Monitoring (vorbereitet)

- `/metrics` liefert:
  - `bot_cycles_total`, `bot_cycle_duration_ms`
  - `provider_requests_total`, `provider_failures_total`, `provider_latency_ms`
  - `websocket_disconnects_total`, `orderbook_resyncs_total`
  - `signals_generated_total`, `signals_rejected_total`, `orders_simulated_total`
  - `strategy_runtime_ms`, `db_query_latency_ms`, `stale_data_total`
- Prometheus mit Bearer-Token scrapen lassen oder einen externen Uptime-Dienst auf `/health/ready` richten. Ohne Token liefert der Endpunkt nur den Gesamtzustand.
