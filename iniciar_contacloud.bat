@echo off
chcp 65001 >nul
title ContaCloud MX - Iniciando Sistema Contable...
echo ========================================================
echo   ContaCloud MX - Sistema Contable
echo   Verificando e iniciando servidores...
echo ========================================================

REM 1. Verificar si el Backend (puerto 8000) ya esta corriendo
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
if %ERRORLEVEL% NEQ 0 (
    echo [1/2] Iniciando servidor Backend FastAPI en puerto 8000...
    start "ContaCloud Backend" /MIN cmd /c "cd /d C:\Users\MAQRFDCSVDR01\.gemini\antigravity\scratch\contacloud-mx\backend && C:\Users\MAQRFDCSVDR01\.gemini\antigravity\scratch\contacloud-mx\backend\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"
) else (
    echo [1/2] Servidor Backend ya se encuentra activo.
)

REM 2. Verificar si el Frontend (puerto 5173) ya esta corriendo
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
if %ERRORLEVEL% NEQ 0 (
    echo [2/2] Iniciando servidor Frontend Vite en puerto 5173...
    start "ContaCloud Frontend" /MIN cmd /c "cd /d C:\Users\MAQRFDCSVDR01\.gemini\antigravity\scratch\contacloud-mx\frontend && npm run dev -- --host 127.0.0.1 --port 5173"
    echo Esperando a que la interfaz este lista...
    timeout /t 4 /nobreak >nul
) else (
    echo [2/2] Servidor Frontend ya se encuentra activo.
)

echo Abriendo ContaCloud MX en el navegador...
start "" "http://127.0.0.1:5173"
exit
