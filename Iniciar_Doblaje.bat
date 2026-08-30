@echo off
setlocal enabledelayedexpansion
title ChoicerVoicer - Lanzador Automatico
color 0B

echo =========================================================
echo                  INICIANDO CHOICERVOICER                
echo =========================================================
echo.

node -v >nul 2>&1
if %errorlevel% equ 0 (
    set "NODE_EXEC=node"
    set "NPM_EXEC=npm"
    goto :VERIFY_DEPENDENCIES
)

if exist ".runtime\node.exe" (
    set "NODE_EXEC=.runtime\node.exe"
    set "NPM_EXEC=.runtime\npm.cmd"
    goto :VERIFY_DEPENDENCIES
)

echo [INFO] No se encontro Node.js en tu sistema.
echo [INFO] Descargando entorno portable oficial de Node.js (espera unos segundos)...
echo.

if not exist ".runtime\" mkdir .runtime

curl -L -o .runtime\node.zip https://nodejs.org/dist/v20.17.0/node-v20.17.0-win-x64.zip

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] No se pudo descargar Node.js automaticamente. 
    echo Revisa tu conexion a Internet.
    pause
    exit /b
)

echo.
echo [INFO] Descomprimiendo entorno...
tar -xf .runtime\node.zip -C .runtime --strip-components=1
del .runtime\node.zip

set "NODE_EXEC=.runtime\node.exe"
set "NPM_EXEC=.runtime\npm.cmd"
echo [INFO] Entorno portable configurado correctamente.
echo.

:VERIFY_DEPENDENCIES
if not exist "node_modules\" (
    echo [INFO] Instalando librerias del proyecto (fluent-ffmpeg, express, open, etc.)...
    echo.
    call "%NPM_EXEC%" install
    echo.
    echo [INFO] Librerias instaladas con exito.
)

echo [INFO] Iniciando servidor ChoicerVoicer...
echo [INFO] Tu navegador se abrira automaticamente en breve.
echo.

"%NODE_EXEC%" server.js

pause