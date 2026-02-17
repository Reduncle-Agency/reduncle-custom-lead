# Reduncle Custom Lead - Servidor Dinámico

Servidor Node.js que genera páginas web personalizadas por cliente usando IA.

## 🚀 Características

- ✅ Genera URLs únicas por cliente
- ✅ Personalización de contenido con IA (OpenAI)
- ✅ API REST para crear y gestionar clientes
- ✅ Caché de páginas generadas
- ✅ Fallback sin IA si no hay API key

## 📋 Configuración en Render

### 1. Runtime
- **Language**: Node.js
- **Branch**: main

### 2. Build & Deploy
- **Build Command**: `npm install`
- **Start Command**: `npm start`

### 3. Environment Variables
Añade estas variables en Render:

```
OPENAI_API_KEY=sk-tu-api-key-aqui (opcional)
OPENAI_MODEL=gpt-4o-mini (opcional)
PORT=3000 (Render lo configura automáticamente)
```

### 4. Instance Type
- **Free**: Para pruebas
- **Starter ($7/mes)**: Para producción

## 📡 API Endpoints

### Crear nuevo cliente
```bash
POST /api/create-client
Content-Type: application/json

{
  "nombre": "Juan Pérez",
  "empresa": "Mi Empresa",
  "objetivos": "Aumentar ventas...",
  "alcance": "Desarrollo completo...",
  "timeline": "3 meses",
  "equipo": "5 personas",
  "precio": "€10,000"
}
```

**Respuesta:**
```json
{
  "success": true,
  "clientId": "uuid-generado",
  "url": "https://tu-app.onrender.com/client/uuid-generado",
  "message": "Cliente creado exitosamente"
}
```

### Ver página del cliente
```
GET /client/:clientId
```

### Obtener datos del cliente
```
GET /api/client/:clientId
```

## 🔧 Desarrollo Local

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tu API key

# Iniciar servidor
npm start
```

## 📝 Notas

- Si no configuras `OPENAI_API_KEY`, el servidor funcionará con personalización básica (solo reemplazo de texto)
- Las páginas generadas se guardan en `public/clients/` para caché
- En producción, considera usar una base de datos en lugar de Map en memoria
