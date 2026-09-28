#!/usr/bin/env bash
# Bot und Datenbank lokal auf dem Mac betreiben - ohne Server, ohne laufende Kosten.
#
#   ./bot-lokal.sh einrichten   einmalig: Konfiguration mit Zufallspasswoertern anlegen (ueberschreibt nichts)
#   ./bot-lokal.sh start        Datenbank, Bot-API und Scheduler starten (im Hintergrund)
#   ./bot-lokal.sh status       Zustand und letzter erfolgreicher Abruf
#   ./bot-lokal.sh logs         laufende Protokolle ansehen (Strg+C beendet nur die Anzeige)
#   ./bot-lokal.sh stop         anhalten - das Meldungsarchiv bleibt erhalten
#   ./bot-lokal.sh sichern      Datenbank-Sicherung nach ./backups-lokal/
#   ./bot-lokal.sh jetzt-abrufen   sofort einen SEC-Abruf mit Auswertung ausfuehren (statt auf den 30-Minuten-Takt zu warten)
#   ./bot-lokal.sh pruefen      vollstaendige Betriebspruefung mit Bericht (Abruf, keine Doppelten, Sicherung, Website)
#   ./bot-lokal.sh sicherung-pruefen [datei]   Sicherung probeweise in eine Testdatenbank einspielen und vergleichen
#   ./bot-lokal.sh wiederherstellen <datei>    Archiv aus einer Sicherung wiederherstellen (fragt nach, sichert vorher)
#   ./bot-lokal.sh wachhalten   verhindert den Ruhezustand, solange das Fenster offen ist (macOS)
#
# Sicherheit: Die Bot-API lauscht nur auf 127.0.0.1 (diesem Rechner), die Datenbank hat gar keinen Port.
# Es wird nichts ins Internet geoeffnet. Der Reverse-Proxy (Profil "proxy") wird hier nie gestartet.

set -euo pipefail
cd "$(dirname "$0")"

DOCKER="${DOCKER:-docker}"
SERVICES=(postgres redis api scheduler backup)
BOT_ENV=services/quant/.env
WEB_ENV=.env.local

say() { printf '%s\n' "$*"; }
die() { printf 'Fehler: %s\n' "$*" >&2; exit 1; }
rand() { LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c "$1"; }
# Der Proxy (nur fuer Server) verlangt API_DOMAIN schon beim Einlesen der Datei; lokal wird er nie gestartet.
compose() { API_DOMAIN="${API_DOMAIN:-proxy-lokal-nicht-verwendet.invalid}" "$DOCKER" compose "$@"; }

need_docker() {
  command -v "$DOCKER" >/dev/null 2>&1 || die "Docker ist nicht installiert. Docker Desktop (kostenlos für private Nutzung) oder Colima installieren, siehe docs/lokal-mac.md."
  "$DOCKER" info >/dev/null 2>&1 || die "Docker läuft nicht. Docker Desktop (bzw. 'colima start') starten und erneut versuchen."
}

# Setzt KEY=VALUE nur, wenn KEY in der Datei fehlt oder leer ist - vorhandene Werte bleiben unangetastet.
set_default() {
  local file="$1" key="$2" value="$3"
  touch "$file"
  if grep -qE "^${key}=.+" "$file"; then return; fi
  if grep -qE "^${key}=" "$file"; then
    local tmp; tmp="$(mktemp)"; grep -vE "^${key}=" "$file" > "$tmp"; cat "$tmp" > "$file"; rm -f "$tmp"
  fi
  printf '%s=%s\n' "$key" "$value" >> "$file"
}

get_value() { grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2-; }

einrichten() {
  [ -f .env ] || cp .env.compose.example .env
  if [ ! -f "$BOT_ENV" ]; then
    cp services/quant/.env.example "$BOT_ENV"
    # Lokal laeuft nur der Insider-Betrieb ohne Handels-Worker
    local tmp; tmp="$(mktemp)"; sed "s|^EXPECT_WORKER=.*|EXPECT_WORKER=false|" "$BOT_ENV" > "$tmp"; cat "$tmp" > "$BOT_ENV"; rm -f "$tmp"
  fi
  set_default "$BOT_ENV" EXPECT_WORKER false

  set_default .env POSTGRES_PASSWORD "$(rand 32)"
  local pw; pw="$(get_value .env POSTGRES_PASSWORD)"
  if grep -qE "^DATABASE_URL=.*PASSWORT" "$BOT_ENV"; then
    local tmp; tmp="$(mktemp)"; sed "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://quant:${pw}@postgres:5432/quant|" "$BOT_ENV" > "$tmp"; cat "$tmp" > "$BOT_ENV"; rm -f "$tmp"
  fi
  set_default "$BOT_ENV" DATABASE_URL "postgresql://quant:${pw}@postgres:5432/quant"
  set_default "$BOT_ENV" BOT_API_TOKEN "$(rand 48)"

  local ua; ua="$(get_value "$BOT_ENV" SEC_EDGAR_USER_AGENT)"
  if [ -z "$ua" ]; then
    if [ -n "${SEC_EDGAR_USER_AGENT:-}" ]; then ua="$SEC_EDGAR_USER_AGENT"
    elif [ -t 0 ]; then
      say "Die SEC verlangt bei jedem Abruf einen Namen und eine E-Mail-Adresse (z. B. \"Max Muster max@example.de\")."
      read -r -p "Name und E-Mail: " ua
    fi
    case "$ua" in *@*) set_default "$BOT_ENV" SEC_EDGAR_USER_AGENT "$ua" ;; *) die "SEC_EDGAR_USER_AGENT braucht Name und E-Mail. In $BOT_ENV eintragen und erneut ausführen." ;; esac
  fi

  # Website (npm run dev / npm start) mit dem lokalen Bot verbinden - nur auf diesem Rechner.
  set_default "$WEB_ENV" BOT_API_URL "http://127.0.0.1:8000"
  set_default "$WEB_ENV" BOT_API_TOKEN "$(get_value "$BOT_ENV" BOT_API_TOKEN)"
  set_default "$WEB_ENV" SEC_EDGAR_USER_AGENT "$(get_value "$BOT_ENV" SEC_EDGAR_USER_AGENT)"

  chmod 600 .env "$BOT_ENV" "$WEB_ENV"
  say "Eingerichtet: .env, $BOT_ENV und $WEB_ENV (nicht im Git, nur auf diesem Rechner)."
  say "Weiter mit: ./bot-lokal.sh start"
}

# Gleicht das Datenbank-Passwort an .env an. Noetig, wenn die Konfiguration neu angelegt wurde,
# das Archiv (Docker-Volume) aber erhalten blieb. Innerhalb des Containers ist der lokale Zugang ohne Passwort erlaubt.
passwort_abgleichen() {
  local pw i
  pw="$(get_value .env POSTGRES_PASSWORD)"
  for i in $(seq 1 30); do
    compose exec -T postgres pg_isready -U quant -d quant >/dev/null 2>&1 && break
    sleep 2
  done
  printf "ALTER USER quant WITH PASSWORD '%s';\n" "$pw" | compose exec -T postgres psql -U quant -d quant -q >/dev/null
}

start() {
  need_docker
  [ -f .env ] && [ -f "$BOT_ENV" ] || die "Zuerst ./bot-lokal.sh einrichten ausführen."
  compose up -d postgres redis
  passwort_abgleichen
  compose up -d --build "${SERVICES[@]}"
  say ""
  say "Der Bot läuft. Er ruft alle 30 Minuten neue SEC-Insidermeldungen ab und archiviert neue Erkennungen."
  say "WICHTIG: Das passiert nur, solange dieser Mac eingeschaltet, wach und online ist."
  say "Im Ruhezustand oder ausgeschaltet gibt es keine Erkennungen. Verpasstes wird beim nächsten Abruf"
  say "mit dem späteren, tatsächlichen Erkennungszeitpunkt nachgeholt."
  say ""
  say "Website lokal starten (zweites Terminal):  npm install && npm run dev   ->  http://localhost:3000"
}

status() {
  need_docker
  compose ps "${SERVICES[@]}"
  local token; token="$(get_value "$BOT_ENV" BOT_API_TOKEN)"
  say ""
  if curl -fsS -m 5 -H "Authorization: Bearer ${token}" http://127.0.0.1:8000/messages/status 2>/dev/null; then
    say ""
  else
    say "Bot-API antwortet nicht auf 127.0.0.1:8000 (gestartet? ./bot-lokal.sh logs zeigt Details)."
  fi
}

sichern() {
  need_docker
  mkdir -p backups-lokal
  local file; file="backups-lokal/quant-$(date +%Y%m%d-%H%M%S).dump"
  # erst in eine Zwischendatei - eine abgebrochene Sicherung hinterlaesst keine halbe Datei
  compose exec -T postgres pg_dump -U quant -d quant -Fc > "$file.teil" || { rm -f "$file.teil"; die "Sicherung fehlgeschlagen."; }
  mv "$file.teil" "$file"
  say "Gesichert: $file"
  LAST_BACKUP="$file"
}

sql() { compose exec -T postgres psql -U quant -d "${2:-quant}" -tAq -c "$1"; }
COUNTS="SELECT (SELECT count(*) FROM bot_messages)||'/'||(SELECT count(*) FROM ingest_runs)||'/'||(SELECT count(*) FROM sec_filings)||'/'||(SELECT count(*) FROM insider_transactions)"

sicherung_pruefen() {
  need_docker
  local file="${1:-$(ls -t backups-lokal/*.dump 2>/dev/null | head -1)}"
  [ -n "$file" ] && [ -f "$file" ] || die "Keine Sicherung gefunden. Zuerst ./bot-lokal.sh sichern."
  sql "DROP DATABASE IF EXISTS quant_restore_check" postgres
  sql "CREATE DATABASE quant_restore_check" postgres
  compose exec -T postgres pg_restore -U quant -d quant_restore_check --no-owner < "$file"
  local restored; restored="$(sql "$COUNTS" quant_restore_check)"
  sql "DROP DATABASE quant_restore_check" postgres
  say "Sicherung $file lässt sich einspielen. Meldungen/Abrufe/Einreichungen/Transaktionen darin: $restored"
  RESTORED_COUNTS="$restored"
}

wiederherstellen() {
  need_docker
  local file="${1:-}"
  [ -n "$file" ] && [ -f "$file" ] || die "Aufruf: ./bot-lokal.sh wiederherstellen backups-lokal/DATEI.dump"
  say "Das ersetzt das aktuelle Archiv durch den Stand aus $file. Vorher wird der jetzige Stand gesichert."
  read -r -p "Zum Fortfahren JA eingeben: " answer
  [ "$answer" = "JA" ] || die "Abgebrochen, nichts geändert."
  sichern
  compose stop api scheduler
  sql "DROP DATABASE quant WITH (FORCE)" postgres
  sql "CREATE DATABASE quant" postgres
  compose exec -T postgres pg_restore -U quant -d quant --no-owner < "$file"
  compose start api scheduler
  say "Wiederhergestellt aus $file. Der vorherige Stand liegt in $LAST_BACKUP."
}

jetzt_abrufen() {
  need_docker
  compose exec -T scheduler python -m quant.jobs insider
}

# Vollstaendige Betriebspruefung. Die Ausgabe enthaelt keine Zugangsdaten und kann geteilt werden.
pruefen() {
  local pass=0 fail=0 limit=0
  ok() { pass=$((pass+1)); say "  ✔ $*"; }
  ko() { fail=$((fail+1)); say "  ✖ $*"; }
  grenze() { limit=$((limit+1)); say "  ◌ Grenze: $*"; }

  say "Betriebsprüfung – Der junge Kapitalist ($(date '+%d.%m.%Y %H:%M'))"
  say "1. Voraussetzungen"
  if command -v "$DOCKER" >/dev/null 2>&1 && "$DOCKER" info >/dev/null 2>&1; then ok "Docker läuft"; else ko "Docker läuft nicht"; say "Abbruch."; return 1; fi
  local ua token webtoken weburl
  ua="$(get_value "$BOT_ENV" SEC_EDGAR_USER_AGENT)"; token="$(get_value "$BOT_ENV" BOT_API_TOKEN)"
  webtoken="$(get_value "$WEB_ENV" BOT_API_TOKEN)"; weburl="$(get_value "$WEB_ENV" BOT_API_URL)"
  case "$ua" in *@*) ok "SEC-Kennung mit E-Mail gesetzt" ;; *) ko "SEC_EDGAR_USER_AGENT fehlt oder ohne E-Mail ($BOT_ENV)" ;; esac
  [ -n "$token" ] && ok "Bot-Token gesetzt" || ko "BOT_API_TOKEN fehlt ($BOT_ENV)"
  { [ -n "$token" ] && [ "$token" = "$webtoken" ] && [ "$weburl" = "http://127.0.0.1:8000" ]; } \
    && ok "Website-Konfiguration (.env.local) passt zum Bot" || ko "Website-Konfiguration (.env.local) passt nicht – ./bot-lokal.sh einrichten"

  say "2. Dienste"
  local running; running="$(compose ps --status running --services 2>/dev/null | tr '\n' ' ')"
  for svc in postgres api scheduler; do
    case " $running " in *" $svc "*) ok "$svc läuft" ;; *) ko "$svc läuft nicht – ./bot-lokal.sh start" ;; esac
  done
  local health; health="$(curl -sS -m 10 http://127.0.0.1:8000/health/ready 2>/dev/null || true)"
  case "$health" in
    *'"HEALTHY"'*) ok "Bot-API antwortet auf 127.0.0.1:8000, Zustand HEALTHY" ;;
    *'"DEGRADED"'*) ok "Bot-API antwortet auf 127.0.0.1:8000, Zustand DEGRADED (eingeschränkt, z. B. noch kein erfolgreicher Abruf)" ;;
    *'"UNHEALTHY"'*) ko "Bot-API meldet UNHEALTHY – Details: curl -H \"Authorization: Bearer …\" 127.0.0.1:8000/health/system" ;;
    *) ko "Bot-API antwortet nicht" ;;
  esac

  say "3. Abruf, Speicherung, Auswertung (echte SEC-Daten)"
  local before after r1 r2
  before="$(compose exec -T scheduler python -m quant.jobs archiv 2>/dev/null || true)"
  r1="$(compose exec -T scheduler python -m quant.jobs insider 2>/dev/null || true)"
  say "     Ergebnis: ${r1:-keine Antwort}"
  case "$r1" in
    *'"ok": true'*) ok "SEC-Abruf erfolgreich (neue Meldungen: $(printf '%s' "$r1" | sed -E 's/.*"new_messages": ([0-9]+).*/\1/')) – auch 0 ist ein gültiges Ergebnis" ;;
    *"lehnt"*) grenze "SEC lehnt ab – Name/E-Mail in SEC_EDGAR_USER_AGENT prüfen" ;;
    *"nicht erreichbar"*) grenze "SEC nicht erreichbar – Internetverbindung prüfen" ;;
    *) ko "Abruf fehlgeschlagen" ;;
  esac
  r2="$(compose exec -T scheduler python -m quant.jobs insider 2>/dev/null || true)"
  case "$r1|$r2" in
    *'"ok": true'*'|'*'"ok": true'*'"new_messages": 0'*) ok "Wiederholter Abruf erzeugt keine doppelten Meldungen" ;;
    *'"ok": true'*'|'*) ko "Wiederholter Abruf: $r2" ;;
    *) grenze "Doppelten-Schutz hier nicht prüfbar, weil der Abruf fehlschlug (automatische Tests prüfen ihn)" ;;
  esac
  after="$(compose exec -T scheduler python -m quant.jobs archiv 2>/dev/null || true)"
  say "     Archiv vorher: ${before:-?}"
  say "     Archiv nachher: ${after:-?}"
  case "$after" in *'"duplicates": 0'*) ok "Keine doppelten Meldungen im Archiv" ;; *) ko "Archivprüfung fehlgeschlagen" ;; esac

  say "4. Sicherung und Wiederherstellung"
  if sichern >/dev/null 2>&1 && [ -s "${LAST_BACKUP:-}" ]; then ok "Sicherung erstellt: $LAST_BACKUP"; else ko "Sicherung fehlgeschlagen"; fi
  local live; live="$(sql "$COUNTS" 2>/dev/null || true)"
  if sicherung_pruefen "${LAST_BACKUP:-}" >/dev/null 2>&1 && [ "${RESTORED_COUNTS:-x}" = "$live" ]; then
    ok "Wiederherstellungsprobe: gleiche Anzahl Datensätze ($live)"
  else ko "Wiederherstellungsprobe: ${RESTORED_COUNTS:-fehlgeschlagen} statt $live"; fi

  say "5. Lokale Website"
  local page; page="$(curl -fsS -m 30 http://localhost:3000/ 2>/dev/null || true)"
  if [ -z "$page" ]; then grenze "Website läuft nicht (zweites Terminal: npm run dev) – nicht geprüft"
  else
    case "$page" in
      *"Bot aktiv"*) ok "Website zeigt: Bot aktiv (mit letztem erfolgreichem Abruf)" ;;
      *"Daten veraltet"*|*"Letzter Abruf fehlgeschlagen"*|*"noch kein erfolgreicher Abruf"*) ok "Website zeigt den Bot mit Warnhinweis (Details auf der Startseite)" ;;
      *"Bot nicht erreichbar"*|*"Kein Bot verbunden"*) ko "Website erreicht den Bot nicht – npm run dev nach ./bot-lokal.sh einrichten neu starten" ;;
      *) ko "Website antwortet, Bot-Zustand nicht erkennbar" ;;
    esac
  fi

  say ""
  say "Ergebnis: $pass bestanden, $fail fehlgeschlagen, $limit Grenze(n)."
  say "Hinweis: Der Bot arbeitet nur, solange dieser Mac wach und online ist. Die öffentliche Website erreicht dieses Archiv nicht."
  [ "$fail" -eq 0 ]
}

wachhalten() {
  command -v caffeinate >/dev/null 2>&1 || die "caffeinate gibt es nur auf macOS."
  say "Der Mac bleibt wach, solange dieses Fenster offen ist (Strg+C beendet)."
  say "Hinweis: Mit zugeklapptem Deckel schläft ein MacBook trotzdem, außer am Netzteil mit externem Bildschirm."
  caffeinate -i -s
}

case "${1:-}" in
  einrichten) einrichten ;;
  start) start ;;
  stop) need_docker; compose stop "${SERVICES[@]}"; say "Angehalten. Das Meldungsarchiv bleibt in der Datenbank erhalten." ;;
  status) status ;;
  logs) need_docker; compose logs -f --tail 100 scheduler api ;;
  sichern) sichern ;;
  jetzt-abrufen) jetzt_abrufen ;;
  pruefen) pruefen ;;
  sicherung-pruefen) sicherung_pruefen "${2:-}" ;;
  wiederherstellen) wiederherstellen "${2:-}" ;;
  wachhalten) wachhalten ;;
  *) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
