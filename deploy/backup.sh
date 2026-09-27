#!/bin/sh
# Taegliches, komprimiertes pg_dump (Custom-Format) mit Aufbewahrung. Laeuft im backup-Container.
set -eu
: "${BACKUP_RETENTION_DAYS:=14}"
while true; do
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  if pg_dump --format=custom --compress=6 --file="/backups/quant-$ts.dump.partial"; then
    mv "/backups/quant-$ts.dump.partial" "/backups/quant-$ts.dump"
    echo "{\"event\":\"backup_ok\",\"file\":\"quant-$ts.dump\"}"
  else
    rm -f "/backups/quant-$ts.dump.partial"
    echo "{\"event\":\"backup_failed\"}"
  fi
  find /backups -name 'quant-*.dump' -mtime +"$BACKUP_RETENTION_DAYS" -delete
  sleep 86400
done
