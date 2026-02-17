# 🚀 Guía de Despliegue a GitHub

## 📦 Subir archivos a GitHub

### Opción 1: Script Automático (Recomendado)

1. Abre PowerShell en la carpeta del proyecto
2. Ejecuta:
```powershell
.\deploy.ps1
```

### Opción 2: Comandos Manuales

```bash
# 1. Inicializar Git (si no está inicializado)
git init

# 2. Añadir el repositorio remoto
git remote add origin https://github.com/Reduncle-Agency/REDUNCLE-PAGE-LEADS.git

# 3. Añadir archivos
git add index.html app.js README.md .gitignore

# 4. Hacer commit
git commit -m "Add: Visualizador 3D de coche F1"

# 5. Subir a GitHub
git branch -M main
git push -u origin main
```

## 🌐 Configurar GitHub Pages

### Opción 1: Script Automático

1. Ejecuta:
```powershell
.\setup-github-pages.ps1
```

2. Ingresa tu GitHub Personal Access Token cuando se solicite
   - Para crear un token: https://github.com/settings/tokens
   - Necesitas el permiso: `repo`

### Opción 2: Configuración Manual

1. Ve a: https://github.com/Reduncle-Agency/REDUNCLE-PAGE-LEADS/settings/pages

2. En la sección **"Source"**:
   - Selecciona **"Deploy from a branch"**
   - Branch: **`main`**
   - Folder: **`/ (root)`**

3. Haz clic en **"Save"**

4. Espera 1-2 minutos

5. Tu sitio estará disponible en:
   ```
   https://reduncle-agency.github.io/REDUNCLE-PAGE-LEADS/
   ```

## ✅ Verificar que funciona

1. Abre la URL de GitHub Pages
2. Deberías ver el visualizador 3D del coche
3. El coche debería circular cuando haces scroll

## 🔧 Solución de problemas

### Si los archivos no se suben:
- Verifica que tienes permisos en el repositorio
- Asegúrate de estar autenticado en Git:
  ```bash
  git config --global user.name "Tu Nombre"
  git config --global user.email "tu@email.com"
  ```

### Si GitHub Pages no funciona:
- Verifica que la rama `main` existe
- Asegúrate de que `index.html` está en la raíz del repositorio
- Revisa los logs en Settings > Pages

### Si el modelo 3D no carga:
- Verifica que la URL del CDN de Shopify está correcta en `app.js`
- Abre la consola del navegador (F12) para ver errores

## 📝 Notas

- El archivo `.glb` no se sube porque el código usa la URL del CDN de Shopify
- Los cambios pueden tardar unos minutos en aparecer en GitHub Pages
- Puedes forzar una actualización haciendo un nuevo commit
