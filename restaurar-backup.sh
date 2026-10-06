#!/usr/bin/env bash
# Restaura um backup feito pelo ./backup.sh.
#   ./restaurar-backup.sh banco  backups/banco-2026-10-06_0315.sql.gz
#   ./restaurar-backup.sh midias backups/midias-2026-10-06_0315.tgz
# O banco é restaurado POR CIMA do atual (as tabelas são recriadas). Faça um
# ./backup.sh antes, se o banco atual ainda tiver algo que importe.
set -euo pipefail
cd "$(dirname "$0")"
TIPO=${1:-}; ARQ=${2:-}
[ -f "$ARQ" ] || { echo "Uso: $0 banco|midias <arquivo>"; exit 1; }
read -r -p "Restaurar $TIPO de $ARQ por cima do atual? Digite SIM: " ok
[ "$ok" = "SIM" ] || { echo "Cancelado."; exit 1; }

case "$TIPO" in
  banco)
    DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
    docker compose stop app
    { echo "drop schema public cascade; create schema public;"; gzip -dc "$ARQ" | sed -e '/^SET transaction_timeout/d' -e 's/^CREATE SCHEMA public;/CREATE SCHEMA IF NOT EXISTS public;/'; } | \
      docker run --rm -i --network host postgres:17-alpine psql -v ON_ERROR_STOP=1 -q "$DATABASE_URL"
    docker compose start app
    ;;
  midias)
    APP=$(docker compose ps -q app)
    docker run --rm --volumes-from "$APP" -v "$PWD/$(dirname "$ARQ"):/entrada:ro" alpine \
      tar xzf "/entrada/$(basename "$ARQ")" -C /app/uploads
    ;;
  *) echo "Tipo: banco ou midias"; exit 1 ;;
esac
echo "✅ Restaurado."
