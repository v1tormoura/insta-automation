#!/usr/bin/env bash
# Backup diário do Mongo do Nexora.
#
# ── Por que existe
#
# Auditoria de 20/09/2026: não havia backup nenhum. Contas, tokens cifrados,
# histórico de publicações e métricas viviam num volume só, num servidor só.
# Um `rm` errado, um disco que morre ou um container recriado sem o volume e
# tudo some — sem caminho de volta.
#
# ── O que faz
#
#  1. `mongodump --archive --gzip` de dentro do container (não precisa de
#     cliente no host), gravado em /root/backups/mongo/<data-hora>.archive.gz
#  2. Apaga arquivos com mais de RETENCAO_DIAS (7) — 7 diários cabem em
#     poucos MB; o banco hoje tem ~180 MB em memória, bem menos em disco
#  3. Loga em /root/backups/mongo/backup.log e sai com erro se o dump falhar,
#     para o cron mandar e-mail (se configurado) em vez de falhar calado
#
# ── Instalação (feita em 20/09/2026)
#
#   cp scripts/backup-mongo.sh /root/backups/backup-mongo.sh && chmod +x …
#   crontab -e →  15 3 * * * /root/backups/backup-mongo.sh
#
# ── O que NÃO faz
#
# Não manda para fora do servidor. Backup no mesmo disco protege de erro
# humano e de container perdido, não de o servidor inteiro sumir. Para isso:
# rsync/rclone do diretório para outro lugar (Backblaze B2, S3, outra VPS).
# Uma linha a mais no cron quando houver destino.

set -euo pipefail

COMPOSE=/root/insta-automation/docker-compose.yml
DESTINO=/root/backups/mongo
BANCO=insta-automation
RETENCAO_DIAS=${RETENCAO_DIAS:-7}

mkdir -p "$DESTINO"
ARQ="$DESTINO/$(date +%Y-%m-%d_%H%M).archive.gz"
LOG="$DESTINO/backup.log"

inicio=$(date +%s)
if docker compose -f "$COMPOSE" exec -T mongo mongodump --db "$BANCO" --archive --gzip --quiet > "$ARQ"; then
  tam=$(du -h "$ARQ" | cut -f1)
  echo "$(date '+%F %T') ok   $ARQ ($tam, $(( $(date +%s) - inicio ))s)" >> "$LOG"
else
  rm -f "$ARQ"
  echo "$(date '+%F %T') FALHOU mongodump" >> "$LOG"
  exit 1
fi

# Rotação: só os últimos N dias.
find "$DESTINO" -name '*.archive.gz' -mtime +"$RETENCAO_DIAS" -delete

# Sanidade: o arquivo é um gzip válido e não está vazio.
if ! gzip -t "$ARQ" 2>/dev/null || [ ! -s "$ARQ" ]; then
  echo "$(date '+%F %T') FALHOU arquivo inválido: $ARQ" >> "$LOG"
  exit 1
fi
