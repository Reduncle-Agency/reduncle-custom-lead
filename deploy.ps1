# Script para subir el proyecto a GitHub
# Ejecuta este script desde PowerShell en la carpeta del proyecto

Write-Host "🚀 Iniciando despliegue a GitHub..." -ForegroundColor Green

# Verificar que Git está instalado
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Git no está instalado. Por favor instálalo primero." -ForegroundColor Red
    exit 1
}

# Verificar que estamos en la carpeta correcta
if (-not (Test-Path "index.html")) {
    Write-Host "❌ No se encontró index.html. Asegúrate de estar en la carpeta correcta." -ForegroundColor Red
    exit 1
}

# Inicializar Git si no está inicializado
if (-not (Test-Path ".git")) {
    Write-Host "📦 Inicializando repositorio Git..." -ForegroundColor Yellow
    git init
}

# Configurar el repositorio remoto
Write-Host "🔗 Configurando repositorio remoto..." -ForegroundColor Yellow
git remote remove origin 2>$null
git remote add origin https://github.com/Reduncle-Agency/REDUNCLE-PAGE-LEADS.git

# Añadir archivos
Write-Host "📝 Añadiendo archivos..." -ForegroundColor Yellow
git add index.html
git add app.js
git add README.md
git add .gitignore
git add deploy.ps1
git add setup-github-pages.ps1
git add renderizar.bat
git add renderizar.ps1
git add VER-LOCAL.md
git add DEPLOY.md
git add SUBIR-A-GITHUB.bat

# Añadir archivo GLB
Write-Host "📦 Añadiendo archivo GLB (puede ser grande)..." -ForegroundColor Yellow
if (Test-Path "Meshy_AI_Red_Formula_1_0217154143_texture.glb") {
    git add Meshy_AI_Red_Formula_1_0217154143_texture.glb
    Write-Host "✅ Archivo GLB añadido" -ForegroundColor Green
} else {
    Write-Host "⚠️  Archivo GLB no encontrado" -ForegroundColor Yellow
}

# Hacer commit
Write-Host "💾 Creando commit..." -ForegroundColor Yellow
$commitMessage = "Add: Visualizador 3D de coche F1 con movimiento circular"
git commit -m $commitMessage

# Subir a GitHub
Write-Host "⬆️  Subiendo a GitHub..." -ForegroundColor Yellow
git branch -M main
git push -u origin main --force

Write-Host ""
Write-Host "✅ ¡Archivos subidos exitosamente!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Próximos pasos:" -ForegroundColor Cyan
Write-Host "1. Ve a: https://github.com/Reduncle-Agency/REDUNCLE-PAGE-LEADS/settings/pages" -ForegroundColor White
Write-Host "2. En 'Source', selecciona 'Deploy from a branch'" -ForegroundColor White
Write-Host "3. Selecciona la rama 'main' y la carpeta '/ (root)'" -ForegroundColor White
Write-Host "4. Haz clic en 'Save'" -ForegroundColor White
Write-Host "5. Espera unos minutos y tu sitio estará en:" -ForegroundColor White
Write-Host "   https://reduncle-agency.github.io/REDUNCLE-PAGE-LEADS/" -ForegroundColor Yellow
Write-Host ""
Write-Host "💡 O ejecuta: .\setup-github-pages.ps1 para configurarlo automáticamente" -ForegroundColor Cyan
