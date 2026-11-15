@echo off
chcp 65001 >nul
title Subir ContaCloud MX a GitHub
cd /d "%~dp0"

echo ============================================================
echo   PREPARANDO Y SUBIENDO CONTACLOUD MX A GITHUB
echo ============================================================
echo.

REM 1. Verificar si Git ya está en las rutas estándar de Windows
where git >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Program Files\Git\cmd\git.exe" (
        set "PATH=%PATH%;C:\Program Files\Git\cmd"
    ) else if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" (
        set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Git\cmd"
    )
)

REM 2. Si no está instalado, instalarlo automáticamente con winget
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [1/4] Git no esta instalado en esta computadora. Instalando Git automaticamente...
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    if exist "C:\Program Files\Git\cmd\git.exe" (
        set "PATH=%PATH%;C:\Program Files\Git\cmd"
    ) else if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" (
        set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Git\cmd"
    )
)

where git >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] No se encontro Git. Por favor descarguelo e instalelo desde:
    echo https://git-scm.com/download/win
    pause
    exit /b 1
)

echo [OK] Git detectado correctamente.
echo.

REM 3. Configurar identidad de Git si no existe (necesario para hacer commit)
git config user.name >nul 2>nul
if %errorlevel% neq 0 (
    git config --global user.name "Salvador Garcia Salas"
)
git config user.email >nul 2>nul
if %errorlevel% neq 0 (
    git config --global user.email "salvadorgarcia54-wq@users.noreply.github.com"
)

echo [2/4] Consolidando base de datos local y agregando cambios de Iterumx...
if exist "backend\.venv\Scripts\python.exe" (
    "backend\.venv\Scripts\python.exe" -c "import sqlite3; c=sqlite3.connect('backend/contacloud.db'); c.execute('PRAGMA wal_checkpoint(FULL)'); c.close()" 2>nul
)
if exist "backend\contacloud.db" (
    copy /Y "backend\contacloud.db" "contacloud.db" >nul 2>nul
)
git init
git add -A
git commit -m "Actualizacion Iterumx lista para produccion"
git branch -M main

echo.
echo [3/4] Conectando con https://github.com/salvadorgarcia54-wq/contacloud-mx.git ...
git remote remove origin >nul 2>nul
git remote add origin https://github.com/salvadorgarcia54-wq/contacloud-mx.git

echo.
echo [4/4] Subiendo nueva version a GitHub...
git push -u origin main --force

echo.
echo ============================================================
echo   PROCESO FINALIZADO
echo ============================================================
pause
