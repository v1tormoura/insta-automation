#!/usr/bin/env bash
# Atualiza o servidor com o que está no GitHub.
#   ./deploy.sh            → branch atual
#   ./deploy.sh main       → troca para a branch e atualiza
set -euo pipefail
cd "$(dirname "$0")"

if [ -n "${1:-}" ]; then git checkout "$1"; fi
git pull --ff-only

docker compose up -d --build
docker image prune -f >/dev/null

echo
docker compose ps
echo
PORTA=$(grep -E "^APP_PORT=" .env 2>/dev/null | cut -d= -f2)
echo "Saúde: $(curl -fsS http://127.0.0.1:${PORTA:-3000}/healthz || echo 'API ainda subindo — veja: docker compose logs -f app')"
