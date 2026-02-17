@echo off
echo ========================================
echo   RENDERIZAR VISUALIZADOR 3D
echo ========================================
echo.
echo Iniciando servidor local...
echo.
echo El proyecto se abrira en tu navegador
echo Presiona Ctrl+C para detener el servidor
echo.
echo ========================================
echo.

REM Verificar si Python está instalado
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Usando Python...
    echo.
    start http://localhost:8000
    python -m http.server 8000
    goto :end
)

REM Verificar si Node.js está instalado
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Usando Node.js...
    echo.
    start http://localhost:8000
    npx --yes serve -p 8000
    goto :end
)

REM Verificar si PHP está instalado
where php >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Usando PHP...
    echo.
    start http://localhost:8000
    php -S localhost:8000
    goto :end
)

echo ERROR: No se encontro Python, Node.js ni PHP
echo.
echo Por favor instala uno de estos:
echo - Python: https://www.python.org/downloads/
echo - Node.js: https://nodejs.org/
echo - PHP: https://www.php.net/downloads.php
echo.
echo O usa VS Code con la extension "Live Server"
echo.
pause
exit /b 1

:end
pause
