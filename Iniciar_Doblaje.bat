@echo off
title ChoicerVoicer - Estudio de Doblaje
color 0B

%~d0
cd "%~dp0"

echo =========================================================
echo                  INICIANDO CHOICERVOICER                
echo =========================================================
echo.
echo [INFO] Directorio: %CD%
echo.

:: 1. Verificar si Node.js global existe
where node >nul 2>&1
if %errorlevel% equ 0 goto :USE_GLOBAL_NODE

:: 2. Verificar si el Node portable ya fue descargado previamente
if exist ".runtime\node.exe" goto :USE_PORTABLE_NODE

:: 3. Descarga y descompresiÃ³n de Node.js portable
echo [INFO] No se encontro Node.js instalado en tu sistema.
echo [INFO] Descargando entorno portable oficial (espera un momento)...
echo.

if not exist ".runtime\" mkdir .runtime

curl -L -o .runtime\node.zip https://nodejs.org/dist/v20.17.0/node-v20.17.0-win-x64.zip
if %errorlevel% neq 0 goto :DOWNLOAD_ERROR

echo.
echo [INFO] Descomprimiendo archivos de Node.js...
tar -xf .runtime\node.zip -C .runtime --strip-components=1
if exist ".runtime\node.zip" del /f /q .runtime\node.zip

:USE_PORTABLE_NODE
set "PATH=%CD%\.runtime;%PATH%"
set "NODE_CMD=%CD%\.runtime\node.exe"
set "NPM_CMD=%CD%\.runtime\npm.cmd"
echo [INFO] Utilizando entorno portable de Node.js.
goto :CHECK_DEPENDENCIES

:USE_GLOBAL_NODE
set "NODE_CMD=node"
set "NPM_CMD=npm"
echo [INFO] Utilizando instalacion del sistema de Node.js.

:CHECK_DEPENDENCIES
echo.
:: 4. Instalar dependencias del proyecto si no existe node_modules
if exist "node_modules\" goto :LAUNCH_APPLICATION

echo [INFO] Instalando dependencias de Node.js por primera vez...
echo.
call "%NPM_CMD%" install
if %errorlevel% neq 0 goto :NPM_ERROR
echo.
echo [INFO] Dependencias instaladas con exito.

:LAUNCH_APPLICATION
echo.
echo [INFO] Abriendo aplicacion en http://localhost:3000 ...
echo [INFO] No cierres esta ventana de consola mientras uses el doblaje.
echo.

:: 5. Abrir navegador
start "" "http://localhost:3000"

:: 6. Iniciar servidor Express
"%NODE_CMD%" server.js
goto :END

:DOWNLOAD_ERROR
echo.
echo [ERROR] No se pudo descargar Node.js automaticamente.
echo Comprueba tu conexion a Internet y vuelve a intentarlo.
goto :END

:NPM_ERROR
echo.
echo [ERROR] Ocurrio un fallo al ejecutar 'npm install'.
goto :END

:END
echo.
echo [INFO] Proceso finalizado.
pause