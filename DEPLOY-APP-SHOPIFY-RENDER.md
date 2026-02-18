# 🚀 Desplegar App de Shopify en Render

## ⚠️ PROBLEMA ACTUAL
Render está desplegando el `server.js` (servidor Express) en lugar de la app de Shopify React Router.

## ✅ SOLUCIÓN: Cambiar configuración en Render

### Pasos en Render Dashboard:

1. **Ve a tu servicio en Render:**
   - https://dashboard.render.com
   - Selecciona el servicio `reduncle-custom-lead`

2. **Ve a Settings → Build & Deploy**

3. **Cambia estas configuraciones:**

   **Root Directory:**
   ```
   app-shopify/reduncle-custom-lead
   ```

   **Build Command:**
   ```
   npm install && npm run build
   ```

   **Start Command:**
   ```
   npm start
   ```

4. **Environment Variables (agregar si no están):**
   ```
   NODE_ENV=production
   SHOPIFY_API_KEY=tu-api-key
   SHOPIFY_API_SECRET=tu-api-secret
   DATABASE_URL=tu-database-url (si usas Prisma)
   ```

5. **Click en "Save Changes"**

6. **Manual Deploy:**
   - Click en "Manual Deploy" → "Deploy latest commit"
   - Esto iniciará un nuevo deploy con la configuración correcta

## ⏱️ Tiempo de deploy
- Build: ~5-10 minutos
- Total: ~10-15 minutos

## ✅ Verificar que funciona
Una vez desplegado, la app de Shopify debería:
- Mostrar las pestañas de navegación correctamente
- Mostrar la página principal con "Reduncle Custom Lead"
- Funcionar en: https://reduncle-custom-lead.onrender.com/app
