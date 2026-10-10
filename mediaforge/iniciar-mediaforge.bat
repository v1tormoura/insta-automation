@echo off
setlocal
title MediaForge
cd /d "%~dp0"

where node >nul 2>nul || (echo [MediaForge] Node.js nao encontrado. Instale o Node 22 LTS: https://nodejs.org & pause & exit /b 1)

if not exist node_modules (
  echo [MediaForge] Instalando dependencias...
  call npm install || (pause & exit /b 1)
)
if not exist web\dist\index.html (
  echo [MediaForge] Compilando...
  call npm run build || (pause & exit /b 1)
)
if not exist server\dist\index.js (
  call npm run build || (pause & exit /b 1)
)

echo [MediaForge] Verificando FFmpeg...
call npm run doctor || (echo. & echo Corrija os itens acima e execute novamente. & pause & exit /b 1)

echo [MediaForge] Iniciando em http://127.0.0.1:5310  (Ctrl+C para encerrar)
start "" "http://127.0.0.1:5310"
call npm start
pause
