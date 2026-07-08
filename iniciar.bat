@echo off
title InstaFlow - Iniciando...

echo Iniciando ngrok...
start "ngrok" cmd /k "ngrok http --url=robbing-vagueness-whisking.ngrok-free.dev 3000"

timeout /t 2 /nobreak >nul

echo Iniciando backend...
start "Backend" cmd /k "cd /d D:\insta-automation\backend && node src/server.js"

timeout /t 2 /nobreak >nul

echo Iniciando frontend...
start "Frontend" cmd /k "cd /d D:\insta-automation\frontend && npm run dev"

echo.
echo Tudo iniciado!
echo   Frontend: https://localhost:5174
echo   Backend:  http://localhost:3000
echo   Tunnel:   https://robbing-vagueness-whisking.ngrok-free.dev
pause
