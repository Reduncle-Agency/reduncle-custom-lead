# Script para configurar GitHub Pages automáticamente
# Este script usa la API de GitHub para configurar Pages

Write-Host "⚙️  Configurando GitHub Pages..." -ForegroundColor Green

$repo = "Reduncle-Agency/REDUNCLE-PAGE-LEADS"
$token = Read-Host "Ingresa tu GitHub Personal Access Token (o presiona Enter para configurarlo manualmente)"

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host ""
    Write-Host "📋 Configuración manual:" -ForegroundColor Yellow
    Write-Host "1. Ve a: https://github.com/$repo/settings/pages" -ForegroundColor White
    Write-Host "2. En 'Source', selecciona 'Deploy from a branch'" -ForegroundColor White
    Write-Host "3. Selecciona la rama 'main' y la carpeta '/ (root)'" -ForegroundColor White
    Write-Host "4. Haz clic en 'Save'" -ForegroundColor White
    Write-Host "5. Espera 1-2 minutos y tu sitio estará en:" -ForegroundColor White
    Write-Host "   https://reduncle-agency.github.io/REDUNCLE-PAGE-LEADS/" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "💡 Para crear un token:" -ForegroundColor Cyan
    Write-Host "   https://github.com/settings/tokens" -ForegroundColor White
    Write-Host "   Necesitas el permiso: repo" -ForegroundColor White
    exit
}

# Configurar GitHub Pages usando la API
$headers = @{
    "Authorization" = "token $token"
    "Accept" = "application/vnd.github.v3+json"
}

$body = @{
    source = @{
        branch = "main"
        path = "/"
    }
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/pages" -Method PUT -Headers $headers -Body $body -ContentType "application/json"
    Write-Host "✅ GitHub Pages configurado exitosamente!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🌐 Tu sitio estará disponible en:" -ForegroundColor Cyan
    Write-Host "   https://reduncle-agency.github.io/REDUNCLE-PAGE-LEADS/" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "⏳ Espera 1-2 minutos para que se active..." -ForegroundColor Yellow
} catch {
    Write-Host "❌ Error al configurar GitHub Pages:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Intenta configurarlo manualmente desde:" -ForegroundColor Yellow
    Write-Host "   https://github.com/$repo/settings/pages" -ForegroundColor White
}
