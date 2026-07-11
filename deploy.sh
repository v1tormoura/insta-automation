#!/bin/bash
# Deploy rápido — só reconstrói o que mudou
set -e
cd /root/insta-automation

echo "📥 Baixando alterações..."
git pull origin docs/replace-readme

# Detecta o que mudou desde o commit anterior
CHANGED=$(git diff HEAD~1 --name-only 2>/dev/null || echo "all")

BACKEND_CHANGED=false
FRONTEND_CHANGED=false
PKG_CHANGED=false

echo "$CHANGED" | grep -q "^backend/src/"      && BACKEND_CHANGED=true
echo "$CHANGED" | grep -q "^frontend/src/"     && FRONTEND_CHANGED=true
echo "$CHANGED" | grep -q "package.*\.json"    && PKG_CHANGED=true
echo "$CHANGED" | grep -q "^backend/Dockerfile\|^docker-compose" && PKG_CHANGED=true

if [ "$PKG_CHANGED" = true ]; then
  echo "📦 Dependências ou Dockerfile mudaram — rebuild completo..."
  docker compose up --build -d
elif [ "$BACKEND_CHANGED" = true ] && [ "$FRONTEND_CHANGED" = true ]; then
  echo "⚡ Backend + Frontend mudaram"
  docker compose restart backend worker
  docker compose up --build -d frontend
elif [ "$BACKEND_CHANGED" = true ]; then
  echo "⚡ Só backend mudou — reiniciando (sem rebuild)..."
  docker compose restart backend worker
elif [ "$FRONTEND_CHANGED" = true ]; then
  echo "🎨 Só frontend mudou — rebuild frontend..."
  docker compose up --build -d frontend
else
  echo "⚡ Sem mudanças de código — reiniciando backend..."
  docker compose restart backend worker
fi

echo ""
echo "✅ Deploy concluído!"
docker compose ps
