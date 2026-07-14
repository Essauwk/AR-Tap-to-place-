@echo off
title AR Character Servers
chcp 65001 >nul

echo ======================================================
echo Starting AR Character Servers...
echo ======================================================
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 /nobreak >nul

start "AR Server" /MIN cmd /c "cd /d "%~dp0" && node server.mjs"

timeout /t 2 /nobreak >nul

node tunnel.js

echo.
pause
