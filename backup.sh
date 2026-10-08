#!/usr/bin/env bash
# Backup do Nexora: o banco (Supabase, via DATABASE_URL do .env) e as mídias
# (volume uploads). Guarda os últimos MANTER de cada em ./backups e escreve
# backups/ultimo.json, que o painel lê (Sistema → Backups).
#   ./backup.sh            → faz agora
# Automático todo dia: ./instalar-backup-automatico.sh
set -euo pipefail
cd "$(dirname "$0")"

MANTER=${MANTER:-7}
DESTINO=backups
mkdir -p "$DESTINO"
QUANDO=$(date +%F_%H%M)
LOG=""
falhou() { echo "❌ $1"; printf '{"quando":"%s","ok":false,"erro":"%s"}\n' "$(date -Is)" "$1" > "$DESTINO/ultimo.json"; exit 1; }

# ── Banco ──────────────────────────────────────────────────────────────────
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
[ -n "$DATABASE_URL" ] || falhou "DATABASE_URL não está no .env"
BANCO="$DESTINO/banco-$QUANDO.sql.gz"
# pg_dump 17 lê servidores 13–17; formato texto comprimido, restaurável com psql.
# Sem o SET transaction_timeout (só o Postgres 17 conhece): restaura em qualquer versão.
docker run --rm --network host -e PGCONNECT_TIMEOUT=30 postgres:17-alpine \
  pg_dump --no-owner --no-privileges --schema=public "$DATABASE_URL" \
  | sed '/^SET transaction_timeout/d' | gzip -9 > "$BANCO.tmp" \
  || falhou "pg_dump falhou (confira a DATABASE_URL e a rede)"
[ "$(gzip -dc "$BANCO.tmp" | head -c 4096 | wc -c)" -gt 100 ] || falhou "dump do banco veio vazio"
mv "$BANCO.tmp" "$BANCO"

# ── Mídias (volume do container app) ───────────────────────────────────────
APP=$(docker compose ps -q app)
[ -n "$APP" ] || falhou "o container app não está rodando"
MIDIAS="$DESTINO/midias-$QUANDO.tgz"
# processed/, tmp/ e preparos/ (Variações de Mídia, expiram em 24 h) são refeitos
# ou temporários — fora do backup para ele não inchar.
docker run --rm --volumes-from "$APP" -v "$PWD/$DESTINO:/saida" alpine \
  tar czf "/saida/$(basename "$MIDIAS").tmp" -C /app/uploads --exclude=./processed --exclude=./tmp --exclude=./preparos . \
  || falhou "não deu para empacotar as mídias"
mv "$MIDIAS.tmp" "$MIDIAS"

# ── Rotação: só os MANTER mais novos de cada ───────────────────────────────
for tipo in banco midias; do
  find "$DESTINO" -maxdepth 1 -name "$tipo-*" ! -name '*.tmp' -printf '%T@ %p\n' \
    | sort -rn | tail -n +$((MANTER + 1)) | cut -d' ' -f2- | xargs -r rm -f
done

TAM_B=$(stat -c %s "$BANCO"); TAM_M=$(stat -c %s "$MIDIAS")
printf '{"quando":"%s","ok":true,"banco":"%s","bancoBytes":%s,"midias":"%s","midiasBytes":%s,"manter":%s}\n' \
  "$(date -Is)" "$(basename "$BANCO")" "$TAM_B" "$(basename "$MIDIAS")" "$TAM_M" "$MANTER" > "$DESTINO/ultimo.json"
echo "✅ Backup: $(basename "$BANCO") ($((TAM_B/1024)) KB) e $(basename "$MIDIAS") ($((TAM_M/1024/1024)) MB). Mantidos os últimos $MANTER."
