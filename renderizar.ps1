# Script para renderizar el visualizador 3D localmente
Write-Host "🚀 Iniciando servidor local..." -ForegroundColor Green
Write-Host ""

# Verificar que index.html existe
if (-not (Test-Path "index.html")) {
    Write-Host "❌ No se encontró index.html" -ForegroundColor Red
    exit 1
}

# Intentar usar Python
if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host "✅ Usando Python para el servidor" -ForegroundColor Green
    Write-Host ""
    Write-Host "🌐 Abriendo navegador en: http://localhost:8000" -ForegroundColor Cyan
    Write-Host "⏹️  Presiona Ctrl+C para detener el servidor" -ForegroundColor Yellow
    Write-Host ""
    Start-Process "http://localhost:8000"
    python -m http.server 8000
    exit
}

# Intentar usar Node.js con npx
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "✅ Usando Node.js para el servidor" -ForegroundColor Green
    Write-Host ""
    Write-Host "🌐 Abriendo navegador en: http://localhost:8000" -ForegroundColor Cyan
    Write-Host "⏹️  Presiona Ctrl+C para detener el servidor" -ForegroundColor Yellow
    Write-Host ""
    Start-Process "http://localhost:8000"
    npx --yes serve -p 8000
    exit
}

# Intentar usar PHP
if (Get-Command php -ErrorAction SilentlyContinue) {
    Write-Host "✅ Usando PHP para el servidor" -ForegroundColor Green
    Write-Host ""
    Write-Host "🌐 Abriendo navegador en: http://localhost:8000" -ForegroundColor Cyan
    Write-Host "⏹️  Presiona Ctrl+C para detener el servidor" -ForegroundColor Yellow
    Write-Host ""
    Start-Process "http://localhost:8000"
    php -S localhost:8000
    exit
}

# Si no hay ningún servidor disponible
Write-Host "❌ No se encontró Python, Node.js ni PHP" -ForegroundColor Red
Write-Host ""
Write-Host "💡 Opciones:" -ForegroundColor Yellow
Write-Host "1. Instala Python: https://www.python.org/downloads/" -ForegroundColor White
Write-Host "2. Instala Node.js: https://nodejs.org/" -ForegroundColor White
Write-Host "3. Usa VS Code con la extensión 'Live Server'" -ForegroundColor White
Write-Host ""
