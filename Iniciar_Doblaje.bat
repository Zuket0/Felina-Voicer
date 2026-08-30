@echo off
title ChoicerVoicer - Estudio de Doblaje
color 0B

:: 1. Ir a la unidad y carpeta donde esta el archivo .bat
%~d0
cd "%~dp0"

echo =========================================================
echo                  INICIANDO CHOICERVOICER                
echo =========================================================
echo.
echo [INFO] Carpeta: %CD%
echo.

:: 2. Instalar dependencias si no existe node_modules
if not exist "node_modules\" (
    echo [INFO] Instalando dependencias de Node.js por primera vez...
    echo.
    call npm install
    echo.
    echo [INFO] Instalacion terminada.
)

:: 3. Abrir la direccion en el navegador
echo [INFO] Abriendo aplicacion en http://localhost:3000 ...
start "" "http://localhost:3000"

:: 4. Iniciar el servidor (mantiene el CMD activo)
echo [INFO] Iniciando servidor ChoicerVoicer...
echo [INFO] No cierres esta ventana mientras uses el programa.
echo.

node server.js

:: Si por alguna razon el servidor se detiene, la consola no se cerrara
echo.
echo [INFO] El servidor se ha detenido.
pause