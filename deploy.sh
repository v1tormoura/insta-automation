#!/bin/bash
# Deploy do Nexora no servidor: atualiza o código e reconstrói o que mudou.
# O docker compose só recria os serviços cuja imagem ou configuração mudou.
set -euo pipefail
cd "$(dirname "$0")"

echo "📥 Baixando alterações..."
git pull --ff-only

echo "🏗️  Construindo e subindo (mongo, redis, api, worker, web)..."
docker compose up -d --build --remove-orphans

echo "🩺 Conferindo a API..."
for i in $(seq 1 30); do
  if docker compose exec -T api wget -qO- http://127.0.0.1:4000/api/health/ready >/dev/null 2>&1; then
    docker compose exec -T api wget -qO- http://127.0.0.1:4000/api/health/ready; echo
    break
  fi
  sleep 2
done

docker image prune -f >/dev/null
docker compose ps
echo "✅ Deploy concluído."
