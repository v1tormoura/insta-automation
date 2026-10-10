#!/usr/bin/env bash
# Inicia o MediaForge: instala e compila na primeira execução, confere o FFmpeg e sobe o servidor.
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "[MediaForge] Node.js não encontrado (requer 22.13+)."; exit 1; }
[ -d node_modules ] || { echo "[MediaForge] Instalando dependências..."; npm install; }
if [ ! -f web/dist/index.html ] || [ ! -f server/dist/index.js ]; then
  echo "[MediaForge] Compilando..."
  npm run build
fi
npm run doctor
echo "[MediaForge] Iniciando em http://127.0.0.1:${PORT:-5310} (Ctrl+C para encerrar)"
exec npm start
