@echo off
:: Avvia l'agent e il countdown senza finestre. Da richiamare in uno script che parte con la modalità Xbox,
:: per esempio:  call "C:\AI\remote-app-controller\boot\avvia-tutto.bat"
:: Si può chiamare più volte: l'agent non parte due volte e il countdown decide una sola volta per accensione.
set "BOOT=%~dp0"
start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%BOOT%start-agent.ps1"
start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%BOOT%countdown.ps1"
