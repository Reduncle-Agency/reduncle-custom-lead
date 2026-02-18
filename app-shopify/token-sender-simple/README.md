# Token Sender Simple - OAuth Manual

App mínima para obtener access_token permanente de Shopify usando OAuth manual.

## Configuración en Shopify Dev Dashboard

1. Ve a: https://partners.shopify.com
2. Selecciona tu app
3. Ve a "App setup" → "App URL"
4. Configura:
   - **App URL**: `https://reduncle-custom-lead.onrender.com`
   - **Allowed redirection URL(s)**: 
     ```
     https://reduncle-custom-lead.onrender.com/callback
     ```

## Variables de Entorno en Render

En Render Dashboard → Environment Variables, agrega:

```
CLIENT_ID=tu-client-id
CLIENT_SECRET=tu-client-secret
HOST=https://reduncle-custom-lead.onrender.com
PORT=3000
```

## Desplegar en Render

1. **Tipo de servicio:** Web Service
2. **Root Directory:** `app-shopify/token-sender-simple`
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. **Environment Variables:** Agregar las variables de arriba

## Uso

1. Abre en navegador:
   ```
   https://reduncle-custom-lead.onrender.com/auth?shop=tu-tienda.myshopify.com
   ```

2. Autoriza la app en Shopify

3. El token se imprimirá en los logs de Render

4. Revisa los logs en Render Dashboard para ver el token
