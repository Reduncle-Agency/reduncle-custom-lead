# 🚀 Configuración en Render

## Pasos para desplegar

### 1. En Render Dashboard

**Tipo de Servicio:**
- Selecciona **"Web Service"** (NO Static Site)

### 2. Configuración Básica

**Name:**
```
reduncle-custom-lead
```

**Region:**
```
Oregon (US West) - o la que prefieras
```

**Branch:**
```
main
```

**Root Directory:**
```
(dejar vacío)
```

### 3. Build & Deploy

**Build Command:**
```
npm install
```

**Start Command:**
```
npm start
```

### 4. Environment Variables

Añade estas variables en la sección "Environment Variables":

| Key | Value | Required |
|-----|-------|----------|
| `OPENAI_API_KEY` | `sk-tu-api-key-aqui` | ❌ Opcional |
| `OPENAI_MODEL` | `gpt-4o-mini` | ❌ Opcional |
| `PORT` | `3000` | ✅ Auto (Render lo configura) |

**Nota:** Si no añades `OPENAI_API_KEY`, el servidor funcionará con personalización básica (solo reemplazo de texto).

### 5. Instance Type

- **Free**: Para pruebas y desarrollo
- **Starter ($7/mes)**: Recomendado para producción

### 6. Deploy

Click en **"Deploy Web Service"**

---

## 📡 Cómo usar la API

### Crear un nuevo cliente

```bash
POST https://tu-app.onrender.com/api/create-client
Content-Type: application/json

{
  "nombre": "Juan Pérez",
  "empresa": "Mi Empresa S.L.",
  "objetivos": "Aumentar ventas online en un 50%",
  "alcance": "Desarrollo de e-commerce completo",
  "timeline": "3 meses",
  "equipo": "5 desarrolladores senior",
  "precio": "€15,000"
}
```

**Respuesta:**
```json
{
  "success": true,
  "clientId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "https://tu-app.onrender.com/client/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "message": "Cliente creado exitosamente"
}
```

### Ver la página del cliente

Simplemente abre la URL que recibiste:
```
https://tu-app.onrender.com/client/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

## 🔄 Próximos pasos

1. ✅ Crear endpoint para recibir datos del formulario (cuando esté listo)
2. ✅ Integrar con base de datos (PostgreSQL en Render)
3. ✅ Añadir autenticación si es necesario
4. ✅ Implementar caché más robusto
