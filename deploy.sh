#!/bin/bash
set -e

echo "=== InstaFlow Deploy ==="

echo "Puxando atualizações do Git..."
git pull origin main

echo "Reconstruindo containers..."
docker compose down
docker compose build --no-cache
docker compose up -d

echo ""
echo "Deploy concluído!"
docker compose ps
