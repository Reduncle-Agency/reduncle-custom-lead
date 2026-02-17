@echo off
echo ========================================
echo   SUBIR PROYECTO A GITHUB
echo ========================================
echo.

REM Verificar que Git está instalado
where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Git no esta instalado
    echo Por favor instala Git desde: https://git-scm.com/
    pause
    exit /b 1
)

echo [1/5] Inicializando Git...
if not exist .git (
    git init
)

echo [2/5] Configurando repositorio remoto...
git remote remove origin 2>nul
git remote add origin https://github.com/Reduncle-Agency/REDUNCLE-PAGE-LEADS.git

echo [3/5] Anadiendo archivos...
git add index.html app.js README.md .gitignore deploy.ps1 setup-github-pages.ps1 DEPLOY.md SUBIR-A-GITHUB.bat renderizar.bat renderizar.ps1 VER-LOCAL.md
git add Meshy_AI_Red_Formula_1_0217154143_texture.glb
echo.
echo ADVERTENCIA: El archivo GLB puede ser grande y tardar en subirse
echo.

echo [4/5] Creando commit...
git commit -m "Add: Visualizador 3D de coche F1 con movimiento circular"

echo [5/5] Subiendo a GitHub...
git branch -M main
git push -u origin main --force

echo.
echo ========================================
echo   COMPLETADO!
echo ========================================
echo.
echo Proximos pasos:
echo 1. Ve a: https://github.com/Reduncle-Agency/REDUNCLE-PAGE-LEADS/settings/pages
echo 2. Selecciona 'Deploy from a branch'
echo 3. Branch: main, Folder: / (root)
echo 4. Guarda y espera 1-2 minutos
echo 5. Tu sitio estara en: https://reduncle-agency.github.io/REDUNCLE-PAGE-LEADS/
echo.
pause
