# 🔑 Configurar API Key de OpenAI en Render

## Pasos para configurar la API Key

1. **Ve a tu servicio en Render Dashboard**
   - Entra a: https://dashboard.render.com
   - Selecciona tu servicio: `reduncle-custom-lead`

2. **Ve a Environment Variables**
   - En el menú lateral, click en "Environment"
   - O busca "Environment Variables" en la configuración

3. **Añade la API Key**
   - Click en "Add Environment Variable"
   - **Key**: `OPENAI_API_KEY`
   - **Value**: `[TU_API_KEY_AQUI]` (pega tu API key de OpenAI)
   - Click en "Save Changes"
   
   ⚠️ **IMPORTANTE**: No compartas tu API key públicamente. Guárdala solo en las variables de entorno de Render.

4. **Opcional: Configurar modelo**
   - **Key**: `OPENAI_MODEL`
   - **Value**: `gpt-4o-mini` (o el modelo que prefieras)

5. **Redeploy**
   - Render redeployará automáticamente cuando guardes las variables
   - O puedes hacer "Manual Deploy" si quieres forzarlo

## ✅ Verificar que funciona

Una vez configurado, puedes probar el endpoint:

```bash
POST https://reduncle-custom-lead.onrender.com/api/create-client
Content-Type: application/json

{
  "prompt": "Personaliza esta página para un cliente de tecnología...",
  "nombre": "Juan Pérez",
  "empresa": "Tech Solutions",
  "objetivos": "Aumentar ventas online",
  "alcance": "Desarrollo completo",
  "timeline": "3 meses",
  "equipo": "5 desarrolladores",
  "precio": "€15,000"
}
```

## 🔒 Seguridad

⚠️ **IMPORTANTE**: La API key está en este documento para referencia, pero en producción deberías:
- Usar variables de entorno (ya configurado)
- No exponer la key en el código
- Rotar la key periódicamente si es necesario
