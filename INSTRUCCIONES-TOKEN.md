# 🔑 Cómo Obtener el Token Permanente

## ⚠️ IMPORTANTE

El enlace de instalación de custom app (`/oauth/install_custom_app`) **NO ejecuta nuestro código OAuth**. 

Ese enlace instala la app directamente en Shopify y te muestra el token en el admin, pero **NO lo envía a nuestro proxy**.

## ✅ SOLUCIÓN: Visitar Manualmente

**Después de instalar la custom app**, visita este enlace:

```
https://reduncle-custom-lead.onrender.com/auth?shop=red-uncle-agency.myshopify.com
```

## 📋 Pasos Completos

1. **Instala la custom app** (ya lo hiciste)
2. **Visita:** `https://reduncle-custom-lead.onrender.com/auth?shop=red-uncle-agency.myshopify.com`
3. **Autoriza** la app en Shopify
4. **El token se enviará automáticamente al proxy**
5. **Revisa los logs de Render** para ver el token
6. **Verifica:** `https://reduncle-custom-lead.onrender.com/api/shopify/token/red-uncle-agency.myshopify.com`

## 🔍 Logs que Verás

```
📥 CALLBACK RECIBIDO
🔄 Intercambiando code por token...
✅ ACCESS TOKEN PERMANENTE OBTENIDO: [token]
📤 Enviando token al proxy...
✅✅✅ Token enviado al proxy exitosamente ✅✅✅
```

## 🎯 Para Hacerlo Automático

Si quieres que sea automático al instalar, necesitas:

1. **Crear una app pública** en Shopify Partners Dashboard
2. **Configurar App URL:** `https://reduncle-custom-lead.onrender.com/auth`
3. **Usar el enlace de instalación de la app pública** (no el de custom app)

Pero la forma más rápida ahora es **visitar manualmente** el endpoint `/auth`.
