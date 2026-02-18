# Token Sender Simple

App mínima para obtener el token de Shopify y enviarlo al proxy.

## Cómo usar

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Configurar variables de entorno:**
   ```
   PORT=3000
   PROXY_URL=https://reduncle-custom-lead.onrender.com
   ```

3. **Iniciar:**
   ```bash
   npm start
   ```

4. **Enviar token desde Shopify:**
   - Cuando tengas el token de Shopify, haz POST a `/receive-token`
   - Body: `{ "shop": "tu-tienda.myshopify.com", "accessToken": "tu-token", "scope": "..." }`

## Endpoints

- `POST /receive-token` - Recibe token y lo envía al proxy
- `GET /health` - Estado del servicio
