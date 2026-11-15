@echo off
title Iterumx - Plataforma Contable y Fiscal
cd /d "%~dp0"

REM 1. Verificar si el puerto 8000 (Backend) ya está activo; si no, iniciarlo de inmediato
netstat -ano | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
    cd /d "%~dp0\backend"
    start "Iterumx Backend" /min cmd /c "python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
)

REM 2. Verificar si el puerto 5173 (Frontend Vite) ya está activo; si no, iniciarlo
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% neq 0 (
    cd /d "%~dp0\frontend"
    start "Iterumx Frontend" /min cmd /c "npm run dev"
    timeout /t 3 /nobreak >nul
)

REM 3. Crear / actualizar el acceso directo con el icono oficial de Iterumx en el Escritorio
cd /d "%~dp0"
python crear_icono_escritorio.py >nul 2>&1

REM 4. Abrir Iterumx en el navegador predeterminado
start "" "http://localhost:5173"
