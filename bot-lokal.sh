#!/usr/bin/env bash
# Bot und Datenbank lokal auf dem Mac betreiben - ohne Server, ohne laufende Kosten.
#
#   ./bot-lokal.sh einrichten   einmalig: Konfiguration mit Zufallspasswoertern anlegen (ueberschreibt nichts)
#   ./bot-lokal.sh start        Datenbank, Bot-API und Scheduler starten (im Hintergrund)
#   ./bot-lokal.sh status       Zustand und letzter erfolgreicher Abruf
#   ./bot-lokal.sh logs         laufende Protokolle ansehen (Strg+C beendet nur die Anzeige)
#   ./bot-lokal.sh stop         anhalten - das Meldungsarchiv bleibt erhalten
#   ./bot-lokal.sh sichern      Datenbank-Sicherung nach ./backups-lokal/
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
  [ -f "$BOT_ENV" ] || cp services/quant/.env.example "$BOT_ENV"

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

start() {
  need_docker
  [ -f .env ] && [ -f "$BOT_ENV" ] || die "Zuerst ./bot-lokal.sh einrichten ausführen."
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
  compose exec -T postgres pg_dump -U quant -d quant -Fc > "$file"
  say "Gesichert: $file"
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
  wachhalten) wachhalten ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
